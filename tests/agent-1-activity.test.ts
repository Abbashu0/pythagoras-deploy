import assert from "node:assert/strict";
import test from "node:test";
import { Agent1ActivityStore } from "../src/server/ai/agent-1-runtime/activity-store";
import type { AIProviderAttemptTrace, NormalizedProviderUsage } from "../src/server/ai/gateway/contracts";

function attempt(id: string, index = 0, completedAt: number | null = null): AIProviderAttemptTrace {
  return { gatewayRequestId: "server-request", capability: "GENERATION", attemptIndex: index,
    modelConfigId: id, modelConfigRevision: 1, providerConfigId: "provider", providerConfigRevision: 1,
    adapterKey: "OPENAI_CHAT_COMPLETIONS", providerModelId: "model", startedAt: 1000,
    completedAt, latencyMs: completedAt === null ? null : 10, status: "FAILED", providerInvoked: true };
}
function usage(input: number | null, output: number | null): NormalizedProviderUsage {
  return { inputTokens: input, outputTokens: output, reasoningTokens: null,
    cacheHitInputTokens: null, cacheMissInputTokens: null };
}

test("live activity distinguishes no usage report from zero tokens and tracks concurrent models", () => {
  const store = new Agent1ActivityStore(() => 1000);
  store.begin("a"); store.begin("b");
  store.observeAttempt("a", attempt("primary")); store.observeAttempt("b", attempt("primary"));
  store.phase("a", "responding");
  const snapshot = store.snapshot();
  assert.equal(snapshot.stats.activeRequests, 2);
  assert.equal(snapshot.activeModels[0].count, 2);
  assert.equal(snapshot.activeModels[0].phase, "responding");
  assert.equal(snapshot.stats.inputTokens, null);
  assert.equal(snapshot.stats.outputTokens, null);
  assert.equal(snapshot.points[0].outputTokens, null);
  assert.equal(snapshot.points[0].concurrentRequests, 2);
  assert.equal(JSON.stringify(snapshot).includes("server-request"), false);
});

test("cumulative USAGE and repeated terminal usage are counted exactly once", () => {
  let now = 1000;
  const store = new Agent1ActivityStore(() => now);
  store.begin("a"); store.observeAttempt("a", attempt("primary"));
  store.usage("a", usage(100, 10));
  now = 6000;
  store.usage("a", usage(100, 15)); store.usage("a", usage(100, 15));
  store.finish("a", "completed");
  const snapshot = store.snapshot();
  assert.equal(snapshot.stats.inputTokens, 100);
  assert.equal(snapshot.stats.outputTokens, 15);
  assert.equal(snapshot.stats.reasoningTokens, null);
  assert.equal(snapshot.stats.averageLatencyMs, 5000);
  assert.equal(snapshot.points.reduce((sum, point) => sum + (point.outputTokens ?? 0), 0), 15);
  assert.equal(snapshot.recent[0].outputTokens, 15);
  assert.equal(snapshot.stats.activeRequests, 0);
});

test("fallback observation follows the exact attempted model rather than the configured primary", () => {
  const store = new Agent1ActivityStore(() => 1000);
  store.begin("a"); store.observeAttempt("a", attempt("primary"));
  store.observeAttempt("a", attempt("primary", 0, 1100));
  assert.deepEqual(store.snapshot().activeModels, []);
  store.observeAttempt("a", attempt("fallback", 1));
  store.observeAttempt("a", attempt("fallback", 1));
  assert.equal(store.snapshot().activeModels[0].modelConfigId, "fallback");
  assert.equal(store.snapshot().stats.fallbackAttempts, 1);
  store.finish("a", "failed");
  assert.equal(store.snapshot().recent[0].modelConfigId, "fallback");
  assert.equal(store.snapshot().recent[0].attempts, 2);
});

test("partial usage remains unknown for unreported fields and cancellations clear activity", () => {
  const store = new Agent1ActivityStore(() => 1000);
  store.begin("a"); store.usage("a", usage(20, null)); store.finish("a", "cancelled");
  const snapshot = store.snapshot();
  assert.equal(snapshot.stats.inputTokens, 20);
  assert.equal(snapshot.stats.outputTokens, null);
  assert.equal(snapshot.recent[0].outputTokens, null);
  assert.equal(snapshot.stats.cancelledRequests, 1);
  assert.equal(snapshot.stats.activeRequests, 0);
});

test("observation history stays bounded and expired requests are not reported as user cancellations", () => {
  let now = 1000;
  const store = new Agent1ActivityStore(() => now);
  for (let i = 0; i < 20; i++) { store.begin(String(i)); store.finish(String(i), "completed"); now++; }
  store.begin("stale"); now += 61 * 60_000;
  const snapshot = store.snapshot();
  assert.equal(snapshot.recent.length, 12);
  assert.equal(snapshot.recent[0].outcome, "expired");
  assert.equal(snapshot.stats.cancelledRequests, 0);
  assert.equal(snapshot.stats.activeRequests, 0);
  assert.ok(snapshot.points.length <= 720);
});
