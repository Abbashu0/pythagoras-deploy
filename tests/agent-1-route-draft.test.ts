import assert from "node:assert/strict";
import test from "node:test";
import { promoteFallback, reorderFallbacks } from "../src/components/admin/ai/agent-1-route-draft";

test("fallback draft ordering moves rather than swaps, without mutating saved input", () => {
  const saved = Object.freeze(["a", "b", "c"]);
  assert.deepEqual(reorderFallbacks(saved, 0, 2), ["b", "c", "a"]);
  assert.deepEqual(reorderFallbacks(saved, 2, 0), ["c", "a", "b"]);
  assert.deepEqual(saved, ["a", "b", "c"]);
  assert.deepEqual(reorderFallbacks(saved, -1, 0), saved);
  assert.deepEqual(reorderFallbacks(saved, 0, 3), saved);
});
test("promotion swaps primary with chosen backup and preserves order and uniqueness", () => {
  const saved = Object.freeze(["a", "b", "c"]);
  assert.deepEqual(promoteFallback("primary", saved, 1), { primary: "b", fallbacks: ["a", "primary", "c"] });
  assert.deepEqual(promoteFallback(null, saved, 1), { primary: "b", fallbacks: ["a", "c"] });
  assert.deepEqual(promoteFallback("primary", saved, 4), { primary: "primary", fallbacks: ["a", "b", "c"] });
  assert.deepEqual(saved, ["a", "b", "c"]);
});
