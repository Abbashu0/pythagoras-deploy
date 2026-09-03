import { and, asc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../../admin-auth/contracts";
import type { ContentDatabase } from "../../content/database";
import {
  aiEvalCaseRevisions,
  aiEvalCases,
  aiEvalSuiteCaseRefs,
  aiEvalSuiteRevisions,
  aiEvalSuites,
  type AIEvalCaseRevisionRow,
  type AIEvalSuiteRevisionRow,
} from "../../content/schema";
import {
  type AIEvalCase,
  type AIEvalCaseContent,
  type AIEvalCaseRevision,
  type AIEvalSuite,
  type AIEvalSuiteContent,
  type AIEvalSuiteRevision,
  type AIEvalSuiteRepository,
  type AIEvalCaseRepository,
} from "./contracts";
import { AIEvalError } from "./errors";
import { normalizeAIEvalCaseContent, normalizeAIEvalSuiteContent } from "./validation";

export class SQLiteAIEvalCaseRepository implements AIEvalCaseRepository {
  constructor(private readonly database: ContentDatabase) {}

  getById(id: string): AIEvalCase | null {
    const row = this.database.db.select().from(aiEvalCases).where(eq(aiEvalCases.id, id)).get();
    if (!row) return null;
    const revision = this.getRevision(id, row.currentRevision);
    if (!revision) throw new AIEvalError("AI_EVAL_INVALID", "The current Eval Case revision is missing.");
    return { ...revision, id: row.id, currentRevision: row.currentRevision, currentRevisionId: revision.revisionId, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
  }

  getByKey(key: string): AIEvalCase | null {
    const row = this.database.db.select({ id: aiEvalCases.id }).from(aiEvalCases).where(eq(aiEvalCases.key, key)).get();
    return row ? this.getById(row.id) : null;
  }

  getRevision(id: string, revision: number): AIEvalCaseRevision | null {
    const row = this.database.db.select().from(aiEvalCaseRevisions).where(and(eq(aiEvalCaseRevisions.caseId, id), eq(aiEvalCaseRevisions.revision, revision))).get();
    if (!row) return null;
    const identity = this.database.db.select({ key: aiEvalCases.key }).from(aiEvalCases).where(eq(aiEvalCases.id, id)).get();
    if (!identity) throw new AIEvalError("AI_EVAL_INVALID", "The Eval Case identity is missing.");
    return caseRevisionFromRow(row, identity.key);
  }

  list(): AIEvalCase[] {
    return this.database.db.select().from(aiEvalCases).orderBy(asc(aiEvalCases.key)).all()
      .map((row) => this.getById(row.id))
      .filter((value): value is AIEvalCase => value !== null);
  }

  create(input: { id: string; content: AIEvalCaseContent; actor: AdminActor; now: number }): AIEvalCaseRevision {
    const content = normalizeAIEvalCaseContent(input.content);
    try {
      return this.runAtomic(() => {
        this.database.db.insert(aiEvalCases).values({ id: input.id, key: content.key, subjectKey: content.subjectKey, currentRevision: 1, createdAt: input.now, updatedAt: input.now, createdBy: input.actor.actorUserId, updatedBy: input.actor.actorUserId }).run();
        this.insertRevision(input.id, 1, content, input.actor, input.now);
        const revision = this.getRevision(input.id, 1);
        if (!revision) throw new AIEvalError("AI_EVAL_INVALID", "The Eval Case revision could not be read.");
        return revision;
      });
    } catch (error) {
      if (error instanceof AIEvalError) throw error;
      throw new AIEvalError("AI_EVAL_CONFLICT", "The Eval Case could not be created.", {}, error);
    }
  }

  appendRevision(input: { id: string; expectedRevision: number; content: AIEvalCaseContent; actor: AdminActor; now: number }): AIEvalCaseRevision {
    const current = this.database.db.select({ currentRevision: aiEvalCases.currentRevision, key: aiEvalCases.key, subjectKey: aiEvalCases.subjectKey }).from(aiEvalCases).where(eq(aiEvalCases.id, input.id)).get();
    if (!current) throw new AIEvalError("AI_EVAL_NOT_FOUND", "The Eval Case was not found.");
    if (current.currentRevision !== input.expectedRevision) throw new AIEvalError("AI_EVAL_CONFLICT", "The Eval Case changed before publication.");
    const content = normalizeAIEvalCaseContent(input.content);
    if (content.key !== current.key || content.subjectKey !== current.subjectKey) throw new AIEvalError("AI_EVAL_CONFLICT", "Eval Case key and subject are immutable after creation.");
    const nextRevision = input.expectedRevision + 1;
    try {
      return this.runAtomic(() => {
        this.insertRevision(input.id, nextRevision, content, input.actor, input.now);
        const updated = this.database.db.update(aiEvalCases).set({ currentRevision: nextRevision, updatedAt: input.now, updatedBy: input.actor.actorUserId }).where(and(eq(aiEvalCases.id, input.id), eq(aiEvalCases.currentRevision, input.expectedRevision))).returning({ currentRevision: aiEvalCases.currentRevision }).get();
        if (!updated) throw new AIEvalError("AI_EVAL_CONFLICT", "The Eval Case changed before publication.");
        const revision = this.getRevision(input.id, nextRevision);
        if (!revision) throw new AIEvalError("AI_EVAL_INVALID", "The Eval Case revision could not be read.");
        return revision;
      });
    } catch (error) {
      if (error instanceof AIEvalError) throw error;
      throw new AIEvalError("AI_EVAL_CONFLICT", "The Eval Case revision could not be appended.", {}, error);
    }
  }

  private insertRevision(id: string, revision: number, content: AIEvalCaseContent, actor: AdminActor, now: number): void {
    this.database.db.insert(aiEvalCaseRevisions).values({
      id: uuidv7(), caseId: id, revision, displayName: content.displayName, description: content.description, subjectKey: content.subjectKey, inputText: content.inputText, origin: content.origin, privacyClass: content.privacyClass, deidentificationProof: content.deidentificationProof,
      expectedStatus: content.expectedStatus, allowedFinishReasons: content.allowedFinishReasons, requiredOutputLiterals: content.requiredOutputLiterals, forbiddenOutputLiterals: content.forbiddenOutputLiterals, requiredEvidenceOrigins: content.requiredEvidenceOrigins, forbiddenEvidenceOrigins: content.forbiddenEvidenceOrigins, requiredCitationLabels: content.requiredCitationLabels, minimumEvidenceItemCount: content.minimumEvidenceItemCount, securityLeakageMarkers: content.securityLeakageMarkers, maximumOutputBytes: content.maximumOutputBytes, sourceRevisionReferences: content.sourceRevisionReferences, enabled: content.enabled, createdAt: now, createdBy: actor.actorUserId,
    }).run();
  }

  private runAtomic<T>(operation: () => T): T {
    if (this.database.client.inTransaction) return operation();
    return this.database.client.transaction(operation).immediate();
  }
}

export class SQLiteAIEvalSuiteRepository implements AIEvalSuiteRepository {
  constructor(private readonly database: ContentDatabase) {}

  getById(id: string): AIEvalSuite | null {
    const row = this.database.db.select().from(aiEvalSuites).where(eq(aiEvalSuites.id, id)).get();
    if (!row) return null;
    const revision = this.getRevision(id, row.currentRevision);
    if (!revision) throw new AIEvalError("AI_EVAL_INVALID", "The current Eval Suite revision is missing.");
    return { ...revision, id: row.id, currentRevision: row.currentRevision, currentRevisionId: revision.revisionId, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
  }

  getByKey(key: string): AIEvalSuite | null {
    const row = this.database.db.select({ id: aiEvalSuites.id }).from(aiEvalSuites).where(eq(aiEvalSuites.key, key)).get();
    return row ? this.getById(row.id) : null;
  }

  getRevision(id: string, revision: number): AIEvalSuiteRevision | null {
    const row = this.database.db.select().from(aiEvalSuiteRevisions).where(and(eq(aiEvalSuiteRevisions.suiteId, id), eq(aiEvalSuiteRevisions.revision, revision))).get();
    if (!row) return null;
    if (!row.manifestSealed) throw new AIEvalError("AI_EVAL_INVALID", "The Eval Suite manifest is not sealed.");
    return this.revisionFromRow(row);
  }

  list(): AIEvalSuite[] {
    return this.database.db.select().from(aiEvalSuites).orderBy(asc(aiEvalSuites.key)).all()
      .map((row) => this.getById(row.id))
      .filter((value): value is AIEvalSuite => value !== null);
  }

  create(input: { id: string; content: AIEvalSuiteContent; actor: AdminActor; now: number }): AIEvalSuiteRevision {
    const content = normalizeAIEvalSuiteContent(input.content);
    this.validateManifest(content);
    try {
      return this.runAtomic(() => {
        this.database.db.insert(aiEvalSuites).values({ id: input.id, key: content.key, subjectKey: content.subjectKey, currentRevision: 1, createdAt: input.now, updatedAt: input.now, createdBy: input.actor.actorUserId, updatedBy: input.actor.actorUserId }).run();
        this.insertRevision(input.id, 1, content, input.actor, input.now);
        const revision = this.getRevision(input.id, 1);
        if (!revision) throw new AIEvalError("AI_EVAL_INVALID", "The Eval Suite revision could not be read.");
        return revision;
      });
    } catch (error) {
      if (error instanceof AIEvalError) throw error;
      throw new AIEvalError("AI_EVAL_CONFLICT", "The Eval Suite could not be created.", {}, error);
    }
  }

  appendRevision(input: { id: string; expectedRevision: number; content: AIEvalSuiteContent; actor: AdminActor; now: number }): AIEvalSuiteRevision {
    const current = this.database.db.select({ currentRevision: aiEvalSuites.currentRevision, key: aiEvalSuites.key, subjectKey: aiEvalSuites.subjectKey }).from(aiEvalSuites).where(eq(aiEvalSuites.id, input.id)).get();
    if (!current) throw new AIEvalError("AI_EVAL_NOT_FOUND", "The Eval Suite was not found.");
    if (current.currentRevision !== input.expectedRevision) throw new AIEvalError("AI_EVAL_CONFLICT", "The Eval Suite changed before publication.");
    const content = normalizeAIEvalSuiteContent(input.content);
    if (content.key !== current.key || content.subjectKey !== current.subjectKey) throw new AIEvalError("AI_EVAL_CONFLICT", "Eval Suite key and subject are immutable after creation.");
    this.validateManifest(content);
    const nextRevision = input.expectedRevision + 1;
    try {
      return this.runAtomic(() => {
        this.insertRevision(input.id, nextRevision, content, input.actor, input.now);
        const updated = this.database.db.update(aiEvalSuites).set({ currentRevision: nextRevision, updatedAt: input.now, updatedBy: input.actor.actorUserId }).where(and(eq(aiEvalSuites.id, input.id), eq(aiEvalSuites.currentRevision, input.expectedRevision))).returning({ currentRevision: aiEvalSuites.currentRevision }).get();
        if (!updated) throw new AIEvalError("AI_EVAL_CONFLICT", "The Eval Suite changed before publication.");
        const revision = this.getRevision(input.id, nextRevision);
        if (!revision) throw new AIEvalError("AI_EVAL_INVALID", "The Eval Suite revision could not be read.");
        return revision;
      });
    } catch (error) {
      if (error instanceof AIEvalError) throw error;
      throw new AIEvalError("AI_EVAL_CONFLICT", "The Eval Suite revision could not be appended.", {}, error);
    }
  }

  private insertRevision(id: string, revision: number, content: AIEvalSuiteContent, actor: AdminActor, now: number): void {
    const revisionId = uuidv7();
    this.database.db.insert(aiEvalSuiteRevisions).values({ id: revisionId, suiteId: id, revision, displayName: content.displayName, enabled: content.enabled, requiredDimensions: content.requiredDimensions, graderConfigs: content.graderConfigs, gateConfig: content.gateConfig, permittedRegressionDeltas: content.permittedRegressionDeltas, baselineMode: content.baselineMode, supplementaryJudgeConfig: content.supplementaryJudgeConfig, manifestSealed: false, createdAt: now, createdBy: actor.actorUserId }).run();
    for (const ref of content.caseManifest) this.database.db.insert(aiEvalSuiteCaseRefs).values({ suiteRevisionId: revisionId, ordinal: ref.ordinal, caseId: ref.caseId, caseRevision: ref.caseRevision }).run();
    this.database.db.update(aiEvalSuiteRevisions).set({ manifestSealed: true }).where(and(eq(aiEvalSuiteRevisions.id, revisionId), eq(aiEvalSuiteRevisions.manifestSealed, false))).run();
  }

  validateManifest(content: AIEvalSuiteContent): void {
    for (const ref of content.caseManifest) {
      const caseIdentity = this.database.db.select({ subjectKey: aiEvalCases.subjectKey }).from(aiEvalCases).where(eq(aiEvalCases.id, ref.caseId)).get();
      const caseRevision = this.database.db.select({ subjectKey: aiEvalCaseRevisions.subjectKey, enabled: aiEvalCaseRevisions.enabled }).from(aiEvalCaseRevisions).where(and(eq(aiEvalCaseRevisions.caseId, ref.caseId), eq(aiEvalCaseRevisions.revision, ref.caseRevision))).get();
      if (!caseIdentity || !caseRevision || caseIdentity.subjectKey !== content.subjectKey || caseRevision.subjectKey !== content.subjectKey || !caseRevision.enabled) throw new AIEvalError("AI_EVAL_CASE_REVISION_MISMATCH", "The Eval Suite manifest contains an unavailable or cross-subject Case revision.");
    }
  }

  private revisionFromRow(row: AIEvalSuiteRevisionRow): AIEvalSuiteRevision {
    const suite = this.database.db.select({ key: aiEvalSuites.key, subjectKey: aiEvalSuites.subjectKey }).from(aiEvalSuites).where(eq(aiEvalSuites.id, row.suiteId)).get();
    if (!suite) throw new AIEvalError("AI_EVAL_INVALID", "The Eval Suite identity is missing.");
    const refs = this.database.db.select().from(aiEvalSuiteCaseRefs).where(eq(aiEvalSuiteCaseRefs.suiteRevisionId, row.id)).orderBy(asc(aiEvalSuiteCaseRefs.ordinal)).all().map((ref) => ({ ordinal: ref.ordinal, caseId: ref.caseId, caseRevision: ref.caseRevision }));
    return { suiteId: row.suiteId, revisionId: row.id, revision: row.revision, key: suite.key, subjectKey: suite.subjectKey, displayName: row.displayName, enabled: row.enabled, caseManifest: refs, requiredDimensions: row.requiredDimensions, graderConfigs: row.graderConfigs, gateConfig: row.gateConfig, permittedRegressionDeltas: row.permittedRegressionDeltas, baselineMode: row.baselineMode, supplementaryJudgeConfig: row.supplementaryJudgeConfig, createdAt: row.createdAt, createdBy: row.createdBy };
  }

  private runAtomic<T>(operation: () => T): T {
    if (this.database.client.inTransaction) return operation();
    return this.database.client.transaction(operation).immediate();
  }
}

function caseRevisionFromRow(row: AIEvalCaseRevisionRow, key: string): AIEvalCaseRevision {
  return { caseId: row.caseId, revisionId: row.id, revision: row.revision, key, displayName: row.displayName, description: row.description, subjectKey: row.subjectKey, inputText: row.inputText, origin: row.origin, privacyClass: row.privacyClass, deidentificationProof: row.deidentificationProof, expectedStatus: row.expectedStatus, allowedFinishReasons: row.allowedFinishReasons as AIEvalCaseContent["allowedFinishReasons"], requiredOutputLiterals: row.requiredOutputLiterals, forbiddenOutputLiterals: row.forbiddenOutputLiterals, requiredEvidenceOrigins: row.requiredEvidenceOrigins, forbiddenEvidenceOrigins: row.forbiddenEvidenceOrigins, requiredCitationLabels: row.requiredCitationLabels, minimumEvidenceItemCount: row.minimumEvidenceItemCount, securityLeakageMarkers: row.securityLeakageMarkers, maximumOutputBytes: row.maximumOutputBytes, sourceRevisionReferences: row.sourceRevisionReferences, enabled: row.enabled, createdAt: row.createdAt, createdBy: row.createdBy };
}
