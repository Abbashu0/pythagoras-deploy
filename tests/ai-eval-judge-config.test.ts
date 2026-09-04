import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import { createCanonicalContentRepository } from "../src/server/canonical-content";
import { createChangeManagementService } from "../src/server/change-management";
import { ChangeManagementError } from "../src/server/change-management/errors";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";
import { SQLiteAIModelConfigRepository } from "../src/server/ai/model-registry";
import { SQLiteAIProviderConfigRepository } from "../src/server/ai/configuration";
import { SQLiteAIBudgetPolicyRepository } from "../src/server/ai/budget";
import { SQLiteAIRateLimitPolicyRepository } from "../src/server/ai/rate-limits";
import {
  AI_EVAL_CASE_RESOURCE_TYPE,
  AI_EVAL_JUDGE_CONFIG_RESOURCE_TYPE,
  AI_EVAL_JUDGE_PROTOCOL_KEY,
  AI_EVAL_JUDGE_PROTOCOL_REVISION,
  AI_EVAL_SUITE_RESOURCE_TYPE,
  SQLiteAIEvalCaseRepository,
  SQLiteAIEvalJudgeConfigRepository,
  SQLiteAIEvalSuiteRepository,
  type AIEvalJudgeConfigContent,
  type AIEvalSuiteContent,
} from "../src/server/ai/evals";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const BASE_TIME = 1_905_000_000_000;

interface Fixture {
  root: string;
  database: ContentDatabase;
  owner: AdminActor;
  modelId: string;
  providerId: string;
  budgetPolicyId: string;
  rateLimitPolicyId: string;
  judgeConfigs: SQLiteAIEvalJudgeConfigRepository;
  changes: ReturnType<typeof createChangeManagementService>;
  close(): void;
}

function createFixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-judge-config-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  createCanonicalContentRepository(database).bootstrap();

  const identities = new SQLiteAdminIdentityRepository(database);
  const ownerUser = identities.createInitialOwner({
    id: uuidv7(),
    email: `owner-${uuidv7()}@judge.test`,
    displayName: "Judge Config Owner",
    passwordHash: "fixture",
    createdAt: BASE_TIME,
  });
  const owner: AdminActor = { actorUserId: ownerUser.id, actorRole: "OWNER" };

  const credentialRef = uuidv7();
  database.client
    .prepare("insert into ai_secret_refs (credential_ref, status, secret_version, created_at, updated_at, revision) values (?, 'ACTIVE', 1, ?, ?, 1)")
    .run(credentialRef, BASE_TIME, BASE_TIME);

  const providerId = uuidv7();
  new SQLiteAIProviderConfigRepository(database).create({
    id: providerId,
    content: {
      key: `judge-prov-${providerId.slice(0, 8)}`,
      displayName: "Judge Provider",
      baseUrl: "https://fake.provider.test",
      enabled: true,
      credentialRef,
      retentionPolicy: "ZERO_RETENTION",
      trainingPolicy: "NOT_USED_FOR_TRAINING",
      zdrSupported: true,
      zdrRequired: false,
    },
    actor: owner,
    now: BASE_TIME,
  });

  const modelId = uuidv7();
  new SQLiteAIModelConfigRepository(database).create({
    id: modelId,
    content: {
      key: `judge-mod-${modelId.slice(0, 8)}`,
      displayName: "Judge Generation Model",
      providerConfigId: providerId,
      providerModelId: "judge-model-alpha",
      capability: "GENERATION",
      adapterKey: "fake-generation",
      enabled: true,
      contextWindowTokens: 8192,
      maxOutputTokens: 2048,
      embeddingDimensions: null,
      supportsStreaming: true,
      supportsReasoning: false,
      supportsStructuredOutput: true,
    },
    actor: owner,
    now: BASE_TIME,
  });

  const budgetPolicyId = uuidv7();
  new SQLiteAIBudgetPolicyRepository(database).create({
    id: budgetPolicyId,
    content: {
      key: `judge-bgt-${budgetPolicyId.slice(0, 8)}`,
      displayName: "EVALS Judge Budget",
      currency: "USD",
      costCenter: "EVALS",
      hardCapNano: 100_000_000,
      enabled: true,
    },
    actor: owner,
    now: BASE_TIME,
  });

  const rateLimitPolicyId = uuidv7();
  new SQLiteAIRateLimitPolicyRepository(database).create({
    id: rateLimitPolicyId,
    content: {
      key: `judge-rl-${rateLimitPolicyId.slice(0, 8)}`,
      displayName: "EVALS Judge Rate Limit",
      windowMs: 60_000,
      maxRequests: 50,
      maxConcurrentRequests: 10,
      enabled: true,
    },
    actor: owner,
    now: BASE_TIME,
  });

  return {
    root,
    database,
    owner,
    modelId,
    providerId,
    budgetPolicyId,
    rateLimitPolicyId,
    judgeConfigs: new SQLiteAIEvalJudgeConfigRepository(database),
    changes: createChangeManagementService(database),
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function publishJudgeConfig(
  fixture: Fixture,
  id: string,
  content: AIEvalJudgeConfigContent,
  expectedRevision = 0,
): void {
  let draft = fixture.changes.createChangeSet(
    {
      title: "Publish Judge Config",
      initialItem: {
        resourceType: AI_EVAL_JUDGE_CONFIG_RESOURCE_TYPE,
        resourceId: id,
        operation: expectedRevision === 0 ? "CREATE" : "UPDATE",
        expectedRevision,
        desired: content,
      },
    },
    fixture.owner,
  );
  draft = fixture.changes.submit(draft.changeSet.id, draft.changeSet.revision, fixture.owner);
  draft = fixture.changes.approve(draft.changeSet.id, draft.changeSet.revision, fixture.owner);
  fixture.changes.publish(draft.changeSet.id, draft.changeSet.revision, fixture.owner);
}

test("governed Judge Config publishes revision 1 and appends revision 2 immutably", () => {
  const f = createFixture();
  try {
    const configId = uuidv7();
    const key = `eval-judge-${configId.slice(0, 8)}`;
    const content1: AIEvalJudgeConfigContent = {
      key,
      subjectKey: "biology",
      displayName: "Biology Supplementary Judge v1",
      enabled: true,
      modelConfigId: f.modelId,
      modelConfigRevision: 1,
      providerConfigId: f.providerId,
      providerConfigRevision: 1,
      budgetPolicyId: f.budgetPolicyId,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: f.rateLimitPolicyId,
      rateLimitPolicyRevision: 1,
      protocolKey: AI_EVAL_JUDGE_PROTOCOL_KEY,
      protocolRevision: AI_EVAL_JUDGE_PROTOCOL_REVISION,
      timeoutMs: 20_000,
      maxOutputTokens: 1024,
    };

    publishJudgeConfig(f, configId, content1, 0);

    const config = f.judgeConfigs.getById(configId);
    assert.ok(config);
    assert.equal(config.currentRevision, 1);
    assert.equal(config.key, key);

    const rev1 = f.judgeConfigs.getRevision(configId, 1);
    assert.ok(rev1);
    assert.equal(rev1.displayName, "Biology Supplementary Judge v1");
    assert.equal(rev1.maxOutputTokens, 1024);

    // Append revision 2
    const content2: AIEvalJudgeConfigContent = {
      ...content1,
      displayName: "Biology Supplementary Judge v2",
      maxOutputTokens: 2048,
    };

    publishJudgeConfig(f, configId, content2, 1);

    const configAfter = f.judgeConfigs.getById(configId);
    assert.ok(configAfter);
    assert.equal(configAfter.currentRevision, 2);

    const rev2 = f.judgeConfigs.getRevision(configId, 2);
    assert.ok(rev2);
    assert.equal(rev2.displayName, "Biology Supplementary Judge v2");
    assert.equal(rev2.maxOutputTokens, 2048);

    // Revision 1 remains unchanged
    const rev1After = f.judgeConfigs.getRevision(configId, 1);
    assert.deepEqual(rev1After, rev1);
  } finally {
    f.close();
  }
});

test("Judge Config rejects uncanonical subjects", () => {
  const f = createFixture();
  try {
    const configId = uuidv7();
    const content: AIEvalJudgeConfigContent = {
      key: `eval-judge-${configId.slice(0, 8)}`,
      subjectKey: "astrology",
      displayName: "Invalid Subject Judge",
      enabled: true,
      modelConfigId: f.modelId,
      modelConfigRevision: 1,
      providerConfigId: f.providerId,
      providerConfigRevision: 1,
      budgetPolicyId: f.budgetPolicyId,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: f.rateLimitPolicyId,
      rateLimitPolicyRevision: 1,
      protocolKey: AI_EVAL_JUDGE_PROTOCOL_KEY,
      protocolRevision: AI_EVAL_JUDGE_PROTOCOL_REVISION,
      timeoutMs: 15_000,
      maxOutputTokens: 1024,
    };

    assert.throws(
      () => publishJudgeConfig(f, configId, content, 0),
      (err) => err instanceof ChangeManagementError && err.code === "CHANGE_VALIDATION_FAILED",
    );
  } finally {
    f.close();
  }
});

test("Judge Config rejects non-EVALS budget policy", () => {
  const f = createFixture();
  try {
    const studentBudgetId = uuidv7();
    new SQLiteAIBudgetPolicyRepository(f.database).create({
      id: studentBudgetId,
      content: {
        key: `student-bgt-${studentBudgetId.slice(0, 8)}`,
        displayName: "Student Budget",
        currency: "USD",
        costCenter: "STUDENT_GENERATION",
        hardCapNano: 50_000_000,
        enabled: true,
      },
      actor: f.owner,
      now: BASE_TIME,
    });

    const configId = uuidv7();
    const content: AIEvalJudgeConfigContent = {
      key: `eval-judge-${configId.slice(0, 8)}`,
      subjectKey: "biology",
      displayName: "Invalid Budget Judge",
      enabled: true,
      modelConfigId: f.modelId,
      modelConfigRevision: 1,
      providerConfigId: f.providerId,
      providerConfigRevision: 1,
      budgetPolicyId: studentBudgetId,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: f.rateLimitPolicyId,
      rateLimitPolicyRevision: 1,
      protocolKey: AI_EVAL_JUDGE_PROTOCOL_KEY,
      protocolRevision: AI_EVAL_JUDGE_PROTOCOL_REVISION,
      timeoutMs: 15_000,
      maxOutputTokens: 1024,
    };

    assert.throws(
      () => publishJudgeConfig(f, configId, content, 0),
      (err) => err instanceof ChangeManagementError && err.code === "CHANGE_VALIDATION_FAILED",
    );
  } finally {
    f.close();
  }
});

test("Judge Config rejects unsupported protocol key or revision", () => {
  const f = createFixture();
  try {
    const configId = uuidv7();
    const content = {
      key: `eval-judge-${configId.slice(0, 8)}`,
      subjectKey: "biology",
      displayName: "Invalid Protocol Judge",
      enabled: true,
      modelConfigId: f.modelId,
      modelConfigRevision: 1,
      providerConfigId: f.providerId,
      providerConfigRevision: 1,
      budgetPolicyId: f.budgetPolicyId,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: f.rateLimitPolicyId,
      rateLimitPolicyRevision: 1,
      protocolKey: "arbitrary-evaluator-v9",
      protocolRevision: 99,
      timeoutMs: 15_000,
      maxOutputTokens: 1024,
    } as unknown as AIEvalJudgeConfigContent;

    assert.throws(
      () => publishJudgeConfig(f, configId, content, 0),
      (err) => err instanceof ChangeManagementError && err.code === "CHANGE_VALIDATION_FAILED",
    );
  } finally {
    f.close();
  }
});

test("SQLite triggers prevent direct UPDATE or DELETE on Judge Config tables", () => {
  const f = createFixture();
  try {
    const configId = uuidv7();
    const key = `eval-judge-${configId.slice(0, 8)}`;
    const content: AIEvalJudgeConfigContent = {
      key,
      subjectKey: "biology",
      displayName: "Biology Supplementary Judge",
      enabled: true,
      modelConfigId: f.modelId,
      modelConfigRevision: 1,
      providerConfigId: f.providerId,
      providerConfigRevision: 1,
      budgetPolicyId: f.budgetPolicyId,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: f.rateLimitPolicyId,
      rateLimitPolicyRevision: 1,
      protocolKey: AI_EVAL_JUDGE_PROTOCOL_KEY,
      protocolRevision: AI_EVAL_JUDGE_PROTOCOL_REVISION,
      timeoutMs: 15_000,
      maxOutputTokens: 1024,
    };

    publishJudgeConfig(f, configId, content, 0);

    // Direct UPDATE on ai_eval_judge_configs is forbidden
    assert.throws(() => {
      f.database.client.prepare("update ai_eval_judge_configs set key='changed' where id=?").run(configId);
    }, /immutable|revisions must advance|require a new revision/i);

    // Direct UPDATE on ai_eval_judge_config_revisions is forbidden
    assert.throws(() => {
      f.database.client.prepare("update ai_eval_judge_config_revisions set display_name='changed' where judge_config_id=?").run(configId);
    }, /immutable|no_update|append-only|cannot be updated/i);

    // Direct DELETE on ai_eval_judge_config_revisions is forbidden
    assert.throws(() => {
      f.database.client.prepare("delete from ai_eval_judge_config_revisions where judge_config_id=?").run(configId);
    }, /append-only|no_delete|cannot be deleted/i);
  } finally {
    f.close();
  }
});

test("Suite validation enforces supplementaryJudgeConfig rules and forbids Judge-only SECURITY", () => {
  const f = createFixture();
  try {
    const caseId = uuidv7();
    let draftCase = f.changes.createChangeSet(
      {
        title: "Publish Case",
        initialItem: {
          resourceType: AI_EVAL_CASE_RESOURCE_TYPE,
          resourceId: caseId,
          operation: "CREATE",
          expectedRevision: 0,
          desired: {
            key: `case-${caseId.slice(0, 8)}`,
            subjectKey: "biology",
            displayName: "Case for Suite Validation",
            description: null,
            inputText: "Question text",
            origin: "SYNTHETIC",
            privacyClass: "SYNTHETIC_PUBLIC_SAFE",
            deidentificationProof: null,
            expectedStatus: "COMPLETED",
            allowedFinishReasons: ["STOP"],
            requiredOutputLiterals: [],
            forbiddenOutputLiterals: [],
            requiredEvidenceOrigins: [],
            forbiddenEvidenceOrigins: [],
            requiredCitationLabels: [],
            minimumEvidenceItemCount: 0,
            securityLeakageMarkers: [],
            maximumOutputBytes: 1024,
            sourceRevisionReferences: [],
            enabled: true,
          },
        },
      },
      f.owner,
    );
    draftCase = f.changes.submit(draftCase.changeSet.id, draftCase.changeSet.revision, f.owner);
    draftCase = f.changes.approve(draftCase.changeSet.id, draftCase.changeSet.revision, f.owner);
    f.changes.publish(draftCase.changeSet.id, draftCase.changeSet.revision, f.owner);

    // 1. Suite cannot satisfy SECURITY through JUDGE_REQUIRED
    const suiteId1 = uuidv7();
    const suiteContent1: AIEvalSuiteContent = {
      key: `suite-${suiteId1.slice(0, 8)}`,
      subjectKey: "biology",
      displayName: "Security as Judge Forbidden",
      enabled: true,
      caseManifest: [{ caseId, caseRevision: 1, ordinal: 1 }],
      requiredDimensions: [{ dimension: "SECURITY", mode: "JUDGE_REQUIRED" }],
      graderConfigs: [],
      gateConfig: { minimumScores: [], maximumCostNano: null, maximumLatencyMs: null, requireSecurityPass: true },
      permittedRegressionDeltas: [],
      baselineMode: "OPTIONAL",
      supplementaryJudgeConfig: { referenceKey: "any-key", revision: 1 },
    };

    assert.throws(
      () => {
        f.changes.createChangeSet(
          {
            title: "Publish Invalid Security Suite",
            initialItem: {
              resourceType: AI_EVAL_SUITE_RESOURCE_TYPE,
              resourceId: suiteId1,
              operation: "CREATE",
              expectedRevision: 0,
              desired: suiteContent1,
            },
          },
          f.owner,
        );
      },
      (err) => err instanceof ChangeManagementError && err.code === "CHANGE_VALIDATION_FAILED",
    );

    // 2. Suite with JUDGE_REQUIRED dimensions requires non-null supplementaryJudgeConfig
    const suiteId2 = uuidv7();
    const suiteContent2: AIEvalSuiteContent = {
      key: `suite-${suiteId2.slice(0, 8)}`,
      subjectKey: "biology",
      displayName: "Missing Judge Config Suite",
      enabled: true,
      caseManifest: [{ caseId, caseRevision: 1, ordinal: 1 }],
      requiredDimensions: [{ dimension: "ARABIC_QUALITY", mode: "JUDGE_REQUIRED" }],
      graderConfigs: [],
      gateConfig: { minimumScores: [], maximumCostNano: null, maximumLatencyMs: null, requireSecurityPass: true },
      permittedRegressionDeltas: [],
      baselineMode: "OPTIONAL",
      supplementaryJudgeConfig: null,
    };

    assert.throws(
      () => {
        f.changes.createChangeSet(
          {
            title: "Publish Missing Judge Config Suite",
            initialItem: {
              resourceType: AI_EVAL_SUITE_RESOURCE_TYPE,
              resourceId: suiteId2,
              operation: "CREATE",
              expectedRevision: 0,
              desired: suiteContent2,
            },
          },
          f.owner,
        );
      },
      (err) => err instanceof ChangeManagementError && err.code === "CHANGE_VALIDATION_FAILED",
    );

    // 3. Suite with ZERO JUDGE_REQUIRED dimensions requires null supplementaryJudgeConfig
    const suiteId3 = uuidv7();
    const suiteContent3: AIEvalSuiteContent = {
      key: `suite-${suiteId3.slice(0, 8)}`,
      subjectKey: "biology",
      displayName: "Zero Judge Required Suite",
      enabled: true,
      caseManifest: [{ caseId, caseRevision: 1, ordinal: 1 }],
      requiredDimensions: [{ dimension: "CORRECTNESS", mode: "DETERMINISTICALLY_GRADED" }],
      graderConfigs: [{ graderKey: "status-match-v1", graderRevision: 1, dimension: "CORRECTNESS", required: true }],
      gateConfig: { minimumScores: [], maximumCostNano: null, maximumLatencyMs: null, requireSecurityPass: true },
      permittedRegressionDeltas: [],
      baselineMode: "OPTIONAL",
      supplementaryJudgeConfig: { referenceKey: "unneeded-key", revision: 1 },
    };

    assert.throws(
      () => {
        f.changes.createChangeSet(
          {
            title: "Publish Unneeded Judge Config Suite",
            initialItem: {
              resourceType: AI_EVAL_SUITE_RESOURCE_TYPE,
              resourceId: suiteId3,
              operation: "CREATE",
              expectedRevision: 0,
              desired: suiteContent3,
            },
          },
          f.owner,
        );
      },
      (err) => err instanceof ChangeManagementError && err.code === "CHANGE_VALIDATION_FAILED",
    );
  } finally {
    f.close();
  }
});
