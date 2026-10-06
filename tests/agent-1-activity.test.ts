import assert from "node:assert/strict";
import test from "node:test";
import { Agent1ActivityStore } from "../src/server/ai/agent-1-runtime/activity-store";
import { failureCategory } from "../src/server/ai/agent-1-runtime/activity-store";
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

test("first-text latency records one nonempty text event, not thinking or repeated deltas", () => {
  let now = 1000;
  const store = new Agent1ActivityStore(() => now);
  store.begin("a"); store.observeAttempt("a", attempt("primary"));
  now = 2000; store.phase("a", "thinking");
  assert.equal(store.snapshot({ window: "5m" }).stats.averageFirstTextMs, null);
  now = 3000; store.firstText("a");
  now = 5000; store.firstText("a"); store.finish("a", "completed");
  const snapshot = store.snapshot({ window: "5m" });
  assert.equal(snapshot.recent[0].firstTextMs, 2000);
  assert.equal(snapshot.stats.averageFirstTextMs, 2000);
  assert.equal(snapshot.modelPerformance[0].averageFirstTextMs, 2000);
  assert.equal(snapshot.stats.averageLatencyMs, 4000);
});

test("fallback chain exposes sanitized reasons and actual transitions, which expire without fake motion", () => {
  let now = 1000;
  const store = new Agent1ActivityStore(() => now);
  store.begin("private-request-id"); store.observeAttempt("private-request-id", attempt("primary"));
  now = 2000; store.observeAttempt("private-request-id", { ...attempt("primary", 0, now), errorCode: "RATE_LIMITED", providerRequestId: "private-upstream" });
  now = 2100; store.observeAttempt("private-request-id", attempt("fallback", 1));
  assert.deepEqual(store.snapshot({ window: "5m" }).transitions[0], {
    fromModelConfigId: "primary", toModelConfigId: "fallback", startedAt: now, reason: "rate-limit", active: true,
  });
  now = 3000; store.firstText("private-request-id");
  store.observeAttempt("private-request-id", { ...attempt("fallback", 1, now), status: "SUCCEEDED" });
  store.finish("private-request-id", "completed");
  const snapshot = store.snapshot({ window: "5m" });
  assert.equal(snapshot.recent[0].chain[0].reason, "rate-limit");
  assert.equal(snapshot.recent[0].chain[1].status, "succeeded");
  assert.equal(snapshot.recent[0].reason, null);
  assert.equal(snapshot.stats.failedRequests, 0);
  assert.equal(snapshot.transitions[0].active, false);
  assert.equal(JSON.stringify(snapshot).includes("private-"), false);
  snapshot.recent[0].chain[0].reason = "unknown";
  assert.equal(store.snapshot().recent[0].chain[0].reason, "rate-limit");
  now += 11_000;
  assert.deepEqual(store.snapshot({ window: "5m" }).transitions, []);
});

test("a shared window and model filter scope terminal metrics, usage and recent records consistently", () => {
  let now = 1000;
  const store = new Agent1ActivityStore(() => now);
  store.begin("old"); store.observeAttempt("old", attempt("primary"));
  store.usage("old", usage(100, 200)); store.finish("old", "completed");
  now = 120_000;
  store.begin("new"); store.observeAttempt("new", attempt("fallback"));
  store.usage("new", usage(10, 20)); store.usage("new", usage(10, 20));
  now += 1000; store.firstText("new"); store.finish("new", "completed");
  const short = store.snapshot({ window: "1m" });
  assert.equal(short.stats.completedRequests, 1);
  assert.equal(short.stats.outputTokens, 20);
  assert.equal(short.recent.length, 1);
  assert.equal(short.points.reduce((sum, point) => sum + (point.outputTokens ?? 0), 0), short.stats.outputTokens);
  const primary = store.snapshot({ window: "5m", modelConfigId: "primary" });
  assert.equal(primary.stats.outputTokens, 200);
  assert.equal(primary.stats.completedRequests, 1);
  assert.equal(primary.recent[0].modelConfigId, "primary");
  const empty = store.snapshot({ window: "1m", modelConfigId: "primary" });
  assert.equal(empty.stats.outputTokens, null);
  assert.equal(empty.stats.completedRequests, 0);
  assert.deepEqual(empty.recent, []);
});

test("per-model concurrency closes after finish and excludes another provider's usage", () => {
  let now = 1000;
  const store = new Agent1ActivityStore(() => now);
  store.begin("a"); store.observeAttempt("a", attempt("primary"));
  store.begin("b"); store.observeAttempt("b", attempt("fallback"));
  store.usage("a", usage(10, 100)); store.usage("b", usage(20, 200));
  now = 6000; store.finish("a", "completed");
  now = 11_000;
  const scoped = store.snapshot({ window: "5m", modelConfigId: "primary" });
  assert.equal(scoped.stats.activeRequests, 0);
  assert.equal(scoped.points.at(-1)!.concurrentRequests, 0);
  assert.equal(scoped.stats.outputTokens, 100);
  assert.equal(store.snapshot({ window: "5m" }).stats.activeRequests, 1);
});

test("p95 requires twenty successful actual durations and never mixes in failures or cancellation", () => {
  let now = 1000;
  const store = new Agent1ActivityStore(() => now);
  for (let i = 1; i <= 20; i++) {
    store.begin(String(i)); store.observeAttempt(String(i), attempt("primary"));
    now += i * 100; store.finish(String(i), "completed");
    if (i === 19) assert.equal(store.snapshot({ window: "5m" }).stats.p95LatencyMs, null);
  }
  store.begin("failed"); now += 10_000; store.finish("failed", "failed", "timeout");
  store.begin("cancelled"); now += 10_000; store.finish("cancelled", "cancelled");
  const snapshot = store.snapshot({ window: "5m" });
  assert.equal(snapshot.stats.latencySamples, 20);
  assert.equal(snapshot.stats.p95LatencyMs, 1900);
  assert.equal(snapshot.recent[0].outcome, "cancelled");
  assert.equal(snapshot.recent[1].reason, "timeout");
});

test("unknown usage remains null, input-only reporting is not mislabeled as no report", () => {
  const store = new Agent1ActivityStore(() => 1000);
  store.begin("a"); store.usage("a", usage(10, null)); store.finish("a", "completed");
  const scoped = store.snapshot({ window: "5m" });
  assert.equal(scoped.stats.missingUsageRequests, 0);
  assert.equal(scoped.stats.outputTokens, null);
  assert.equal(scoped.recent[0].usageReported, true);
  assert.equal(failureCategory("AUTHENTICATION"), "authentication");
  assert.equal(failureCategory("BAD_RESPONSE"), "bad-response");
  assert.equal(failureCategory("UNAVAILABLE"), "unavailable");
  assert.equal(failureCategory("PRIVATE RAW PROVIDER BODY"), "unknown");
});

test("bounded history reports truncation honestly and retained metrics do not claim the whole session", () => {
  const store = new Agent1ActivityStore(() => 1000);
  for (let i = 0; i < 10_002; i++) { store.begin(String(i)); store.finish(String(i), "completed"); }
  const scoped = store.snapshot({ window: "1h" });
  assert.equal(scoped.scope.historyLimited, true);
  assert.equal(scoped.stats.completedRequests, 10_000);
  assert.equal(scoped.recent.length, 12);
  assert.equal(store.snapshot().stats.completedRequests, 10_002);
});

test("diagnostic filtering happens before the twelve-row limit and does not filter headline metrics", () => {
  let now = 1000;
  const store = new Agent1ActivityStore(() => now);
  store.begin("failed"); store.finish("failed", "failed", "authentication");
  now++;
  store.begin("recovered"); store.observeAttempt("recovered", attempt("primary"));
  store.observeAttempt("recovered", { ...attempt("primary", 0, now), errorCode: "TIMEOUT" });
  store.observeAttempt("recovered", attempt("fallback", 1)); store.finish("recovered", "completed");
  for (let i = 0; i < 15; i++) { now++; store.begin(String(i)); store.finish(String(i), "completed"); }
  const failed = store.snapshot({ window: "5m", resultFilter: "authentication" });
  assert.equal(failed.recent.length, 1);
  assert.equal(failed.recent[0].reason, "authentication");
  assert.equal(failed.stats.completedRequests, 16);
  assert.equal(failed.stats.failedRequests, 1);
  const recovered = store.snapshot({ window: "5m", resultFilter: "timeout" });
  assert.equal(recovered.recent[0].outcome, "completed");
  assert.equal(recovered.recent[0].chain[0].reason, "timeout");
  assert.equal(store.snapshot({ window: "5m", resultFilter: "fallback" }).recent.length, 1);
});
