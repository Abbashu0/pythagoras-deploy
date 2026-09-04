import { and, eq } from "drizzle-orm";

import type { AdminActor } from "../../admin-auth/contracts";
import type { ChangeOperation, ChangePresentation, ChangeResourceAdapter, ChangeSnapshot, ResourceState } from "../../change-management/contracts";
import { ChangeManagementError } from "../../change-management/errors";
import { deriveChangedPaths, validateChangeSnapshot } from "../../change-management/snapshot";
import type { ContentDatabase } from "../../content/database";
import { canonicalMaterials } from "../../content/schema";
import { SQLiteAIBudgetPolicyRepository } from "../budget";
import { SQLiteAIProviderConfigRepository } from "../configuration";
import { SQLiteAIModelConfigRepository } from "../model-registry";
import { SQLiteAIRateLimitPolicyRepository } from "../rate-limits";
import { AIEvalError } from "./errors";
import {
  AI_EVAL_CASE_RESOURCE_TYPE,
  AI_EVAL_JUDGE_PROTOCOL_KEY,
  AI_EVAL_JUDGE_PROTOCOL_REVISION,
  AI_EVAL_SUITE_RESOURCE_TYPE,
  type AIEvalCase,
  type AIEvalCaseContent,
  type AIEvalSuite,
  type AIEvalSuiteContent,
} from "./contracts";
import { createDefaultAIEvalGraderRegistry } from "./graders";
import { SQLiteAIEvalCaseRepository, SQLiteAIEvalSuiteRepository } from "./configuration";
import { SQLiteAIEvalJudgeConfigRepository } from "./judge-config";
import { normalizeAIEvalCaseContent, normalizeAIEvalSuiteContent } from "./validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class AIEvalCaseChangeAdapter implements ChangeResourceAdapter {
  readonly resourceType = AI_EVAL_CASE_RESOURCE_TYPE;
  readonly areaLabel = "AI / Eval Case";
  readonly mergeStrategy = "THREE_WAY" as const;

  loadCurrent(database: ContentDatabase, resourceId: string): ResourceState {
    assertUuid(resourceId);
    const value = new SQLiteAIEvalCaseRepository(database).getById(resourceId);
    if (!value) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Eval Case was not found.");
    return { resourceId, revision: value.currentRevision, snapshot: caseSnapshot(value) };
  }

  captureProposal(database: ContentDatabase, resourceId: string, desired: unknown, operation: ChangeOperation = "UPDATE") {
    assertUuid(resourceId);
    const repository = new SQLiteAIEvalCaseRepository(database);
    const current = operation === "CREATE" ? emptyState(repository.getById(resourceId), resourceId) : this.loadCurrent(database, resourceId);
    try {
      const content = normalizeAIEvalCaseContent(desired);
      assertCanonicalSubject(database, content.subjectKey);
      if (operation === "UPDATE" && (current.snapshot.key !== content.key || current.snapshot.subjectKey !== content.subjectKey)) throw new AIEvalError("AI_EVAL_CONFLICT", "Eval Case key and subject are immutable after creation.");
      const proposedSnapshot = caseSnapshot(content);
      validateChangeSnapshot(proposedSnapshot);
      const changedPaths = deriveChangedPaths(current.snapshot, proposedSnapshot);
      if (changedPaths.length === 0) throw new AIEvalError("AI_EVAL_INVALID", "The Eval Case proposal does not change any fields.");
      return { current, proposedSnapshot, changedPaths };
    } catch (error) {
      throw mapEvalError(error);
    }
  }

  validateSnapshot(snapshot: ChangeSnapshot): void {
    try { validateChangeSnapshot(snapshot); normalizeAIEvalCaseContent(snapshot); } catch (error) { throw mapEvalError(error); }
  }

  describe(resourceId: string, before: ChangeSnapshot, proposed: ChangeSnapshot, operation: ChangeOperation = "UPDATE"): ChangePresentation {
    const after = normalizeAIEvalCaseContent(proposed);
    const previous = operation === "CREATE" && Object.keys(before).length === 0 ? null : normalizeAIEvalCaseContent(before);
    if (previous && (previous.key !== after.key || previous.subjectKey !== after.subjectKey)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Eval Case key and subject are immutable after creation.");
    const changedPaths = deriveChangedPaths(previous ? caseSnapshot(previous) : {}, caseSnapshot(after));
    return presentation(after.displayName, operation === "CREATE" ? "New governed Eval Case" : `Eval Case · ${resourceId}`, changedPaths, previous ? caseSnapshot(previous) : null, caseSnapshot(after));
  }

  apply(database: ContentDatabase, resourceId: string, value: ChangeSnapshot, expectedRevision: number, actor: AdminActor, operation: ChangeOperation = "UPDATE"): ResourceState {
    requireOwner(actor);
    assertUuid(resourceId);
    try {
      const content = normalizeAIEvalCaseContent(value);
      assertCanonicalSubject(database, content.subjectKey);
      const repository = new SQLiteAIEvalCaseRepository(database);
      const current = operation === "UPDATE" ? repository.getById(resourceId) : null;
      if (operation === "UPDATE" && (!current || current.key !== content.key || current.subjectKey !== content.subjectKey)) throw new AIEvalError("AI_EVAL_CONFLICT", "Eval Case identity does not match the published resource.");
      const revision = operation === "CREATE" ? repository.create({ id: resourceId, content, actor, now: Date.now() }) : repository.appendRevision({ id: resourceId, expectedRevision, content, actor, now: Date.now() });
      const published = repository.getById(resourceId);
      if (!published) throw new AIEvalError("AI_EVAL_INVALID", "The published Eval Case could not be read.");
      return { resourceId, revision: revision.revision, snapshot: caseSnapshot(published) };
    } catch (error) { throw mapEvalError(error); }
  }

  validatePublication(database: ContentDatabase): void {
    for (const value of new SQLiteAIEvalCaseRepository(database).list()) assertCanonicalSubject(database, value.subjectKey);
  }
}

export class AIEvalSuiteChangeAdapter implements ChangeResourceAdapter {
  readonly resourceType = AI_EVAL_SUITE_RESOURCE_TYPE;
  readonly areaLabel = "AI / Eval Suite";
  readonly mergeStrategy = "THREE_WAY" as const;
  private readonly graders = createDefaultAIEvalGraderRegistry();

  loadCurrent(database: ContentDatabase, resourceId: string): ResourceState {
    assertUuid(resourceId);
    const value = new SQLiteAIEvalSuiteRepository(database).getById(resourceId);
    if (!value) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Eval Suite was not found.");
    return { resourceId, revision: value.currentRevision, snapshot: suiteSnapshot(value) };
  }

  captureProposal(database: ContentDatabase, resourceId: string, desired: unknown, operation: ChangeOperation = "UPDATE") {
    assertUuid(resourceId);
    const repository = new SQLiteAIEvalSuiteRepository(database);
    const current = operation === "CREATE" ? emptyState(repository.getById(resourceId), resourceId) : this.loadCurrent(database, resourceId);
    try {
      const content = normalizeAIEvalSuiteContent(desired);
      validateSuiteProposal(database, content, this.graders, repository);
      if (operation === "UPDATE" && (current.snapshot.key !== content.key || current.snapshot.subjectKey !== content.subjectKey)) throw new AIEvalError("AI_EVAL_CONFLICT", "Eval Suite key and subject are immutable after creation.");
      const proposedSnapshot = suiteSnapshot(content);
      validateChangeSnapshot(proposedSnapshot);
      const changedPaths = deriveChangedPaths(current.snapshot, proposedSnapshot);
      if (changedPaths.length === 0) throw new AIEvalError("AI_EVAL_INVALID", "The Eval Suite proposal does not change any fields.");
      return { current, proposedSnapshot, changedPaths };
    } catch (error) { throw mapEvalError(error); }
  }

  validateSnapshot(snapshot: ChangeSnapshot): void {
    try { validateChangeSnapshot(snapshot); normalizeAIEvalSuiteContent(snapshot); } catch (error) { throw mapEvalError(error); }
  }

  describe(resourceId: string, before: ChangeSnapshot, proposed: ChangeSnapshot, operation: ChangeOperation = "UPDATE"): ChangePresentation {
    const after = normalizeAIEvalSuiteContent(proposed);
    const previous = operation === "CREATE" && Object.keys(before).length === 0 ? null : normalizeAIEvalSuiteContent(before);
    if (previous && (previous.key !== after.key || previous.subjectKey !== after.subjectKey)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Eval Suite key and subject are immutable after creation.");
    const changedPaths = deriveChangedPaths(previous ? suiteSnapshot(previous) : {}, suiteSnapshot(after));
    return presentation(after.displayName, operation === "CREATE" ? "New governed Eval Suite" : `Eval Suite · ${resourceId}`, changedPaths, previous ? suiteSnapshot(previous) : null, suiteSnapshot(after));
  }

  apply(database: ContentDatabase, resourceId: string, value: ChangeSnapshot, expectedRevision: number, actor: AdminActor, operation: ChangeOperation = "UPDATE"): ResourceState {
    requireOwner(actor);
    assertUuid(resourceId);
    try {
      const content = normalizeAIEvalSuiteContent(value);
      const repository = new SQLiteAIEvalSuiteRepository(database);
      validateSuiteProposal(database, content, this.graders, repository);
      const current = operation === "UPDATE" ? repository.getById(resourceId) : null;
      if (operation === "UPDATE" && (!current || current.key !== content.key || current.subjectKey !== content.subjectKey)) throw new AIEvalError("AI_EVAL_CONFLICT", "Eval Suite identity does not match the published resource.");
      const revision = operation === "CREATE" ? repository.create({ id: resourceId, content, actor, now: Date.now() }) : repository.appendRevision({ id: resourceId, expectedRevision, content, actor, now: Date.now() });
      const published = repository.getById(resourceId);
      if (!published) throw new AIEvalError("AI_EVAL_INVALID", "The published Eval Suite could not be read.");
      return { resourceId, revision: revision.revision, snapshot: suiteSnapshot(published) };
    } catch (error) { throw mapEvalError(error); }
  }

  validatePublication(database: ContentDatabase): void {
    const repository = new SQLiteAIEvalSuiteRepository(database);
    for (const value of repository.list()) validateSuiteProposal(database, suiteContent(value), this.graders, repository);
  }
}

function validateSuiteProposal(database: ContentDatabase, content: AIEvalSuiteContent, graders: ReturnType<typeof createDefaultAIEvalGraderRegistry>, repository: SQLiteAIEvalSuiteRepository): void {
  assertCanonicalSubject(database, content.subjectKey);
  for (const config of content.graderConfigs) {
    const grader = graders.get(config.graderKey, config.graderRevision);
    if (!grader || grader.dimension !== config.dimension) throw new AIEvalError("AI_EVAL_GRADER_UNSUPPORTED", "The Eval Suite references an unsupported deterministic grader.");
  }
  repository.validateManifest(content);
  if (content.supplementaryJudgeConfig) {
    assertSupplementaryJudgeConfig(database, content.subjectKey, content.supplementaryJudgeConfig);
  }
}

function assertSupplementaryJudgeConfig(database: ContentDatabase, subjectKey: string, config: { referenceKey: string; revision: number }): void {
  const judgeRepo = new SQLiteAIEvalJudgeConfigRepository(database);
  const judgeRevision = judgeRepo.getRevisionByKey(config.referenceKey, config.revision);
  if (!judgeRevision || !judgeRevision.enabled) {
    throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_INVALID", "The Eval Suite supplementary Judge Config revision does not exist or is disabled.");
  }
  if (judgeRevision.subjectKey !== subjectKey) {
    throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_INVALID", "The Eval Suite supplementary Judge Config subject does not match the Suite subject.");
  }
  if (judgeRevision.protocolKey !== AI_EVAL_JUDGE_PROTOCOL_KEY || judgeRevision.protocolRevision !== AI_EVAL_JUDGE_PROTOCOL_REVISION) {
    throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_INVALID", "The Eval Suite supplementary Judge Config uses an unsupported protocol.");
  }
  const model = new SQLiteAIModelConfigRepository(database).getById(judgeRevision.modelConfigId);
  if (!model || model.revision !== judgeRevision.modelConfigRevision || !model.enabled || model.capability !== "GENERATION" || model.providerConfigId !== judgeRevision.providerConfigId) {
    throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_INVALID", "The Eval Suite supplementary Judge Generation model is invalid or disabled.");
  }
  const provider = new SQLiteAIProviderConfigRepository(database).getById(judgeRevision.providerConfigId);
  if (!provider || provider.revision !== judgeRevision.providerConfigRevision || !provider.enabled) {
    throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_INVALID", "The Eval Suite supplementary Judge Provider is invalid or disabled.");
  }
  const budget = new SQLiteAIBudgetPolicyRepository(database).getRevision(judgeRevision.budgetPolicyId, judgeRevision.budgetPolicyRevision);
  if (!budget || !budget.enabled || budget.costCenter !== "EVALS") {
    throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_INVALID", "The Eval Suite supplementary Judge Budget Policy is invalid or not enabled for EVALS.");
  }
  const rateLimit = new SQLiteAIRateLimitPolicyRepository(database).getRevision(judgeRevision.rateLimitPolicyId, judgeRevision.rateLimitPolicyRevision);
  if (!rateLimit || !rateLimit.enabled) {
    throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_INVALID", "The Eval Suite supplementary Judge Rate Limit Policy is invalid or disabled.");
  }
}

function caseSnapshot(content: AIEvalCase | AIEvalCaseContent): ChangeSnapshot {
  return structuredClone({ key: content.key, subjectKey: content.subjectKey, displayName: content.displayName, description: content.description, inputText: content.inputText, origin: content.origin, privacyClass: content.privacyClass, deidentificationProof: content.deidentificationProof, expectedStatus: content.expectedStatus, allowedFinishReasons: content.allowedFinishReasons, requiredOutputLiterals: content.requiredOutputLiterals, forbiddenOutputLiterals: content.forbiddenOutputLiterals, requiredEvidenceOrigins: content.requiredEvidenceOrigins, forbiddenEvidenceOrigins: content.forbiddenEvidenceOrigins, requiredCitationLabels: content.requiredCitationLabels, minimumEvidenceItemCount: content.minimumEvidenceItemCount, securityLeakageMarkers: content.securityLeakageMarkers, maximumOutputBytes: content.maximumOutputBytes, sourceRevisionReferences: content.sourceRevisionReferences, enabled: content.enabled }) as unknown as ChangeSnapshot;
}

function suiteSnapshot(content: AIEvalSuite | AIEvalSuiteContent): ChangeSnapshot {
  return structuredClone({ key: content.key, subjectKey: content.subjectKey, displayName: content.displayName, enabled: content.enabled, caseManifest: content.caseManifest, requiredDimensions: content.requiredDimensions, graderConfigs: content.graderConfigs, gateConfig: content.gateConfig, permittedRegressionDeltas: content.permittedRegressionDeltas, baselineMode: content.baselineMode, supplementaryJudgeConfig: content.supplementaryJudgeConfig }) as unknown as ChangeSnapshot;
}

function suiteContent(value: AIEvalSuite): AIEvalSuiteContent {
  return { key: value.key, subjectKey: value.subjectKey, displayName: value.displayName, enabled: value.enabled, caseManifest: value.caseManifest, requiredDimensions: value.requiredDimensions, graderConfigs: value.graderConfigs, gateConfig: value.gateConfig, permittedRegressionDeltas: value.permittedRegressionDeltas, baselineMode: value.baselineMode, supplementaryJudgeConfig: value.supplementaryJudgeConfig };
}

function assertCanonicalSubject(database: ContentDatabase, subjectKey: string): void {
  if (!database.db.select({ subjectKey: canonicalMaterials.subjectKey }).from(canonicalMaterials).where(eq(canonicalMaterials.subjectKey, subjectKey)).get()) throw new AIEvalError("AI_EVAL_GOVERNANCE_INVALID", "The Eval subject is not canonical.");
}

function emptyState(existing: unknown, resourceId: string): ResourceState {
  if (existing) throw new ChangeManagementError("CHANGE_CONFLICT", "The Eval resource identifier is already in use.");
  return { resourceId, revision: 0, snapshot: {} };
}

function assertUuid(value: unknown): asserts value is string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "The Eval resource identifier must be a stable UUID.");
}

function requireOwner(actor: AdminActor): void {
  if (actor.actorRole !== "OWNER") throw new ChangeManagementError("CHANGE_AUTHORIZATION_FAILED", "Only OWNER may publish Eval definitions.");
}

function presentation(label: string, subtitle: string, changedPaths: string[], before: ChangeSnapshot | null, after: ChangeSnapshot): ChangePresentation {
  return { resourceLabel: label, resourceSubtitle: subtitle, changeSummary: `${changedPaths.length} changed field${changedPaths.length === 1 ? "" : "s"}`, areaLabel: "AI / Evals", fieldDiffs: changedPaths.map((path) => ({ path, label: path, before: before?.[path], after: after[path] })) };
}

function mapEvalError(error: unknown): Error {
  if (error instanceof ChangeManagementError) return error;
  if (error instanceof AIEvalError) return new ChangeManagementError(error.code === "AI_EVAL_CONFLICT" ? "CHANGE_CONFLICT" : error.code === "AI_EVAL_NOT_FOUND" ? "CHANGE_NOT_FOUND" : "CHANGE_VALIDATION_FAILED", error.message, error);
  return error instanceof Error ? new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Eval definition operation failed.", error) : new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Eval definition operation failed.");
}
