import assert from "node:assert/strict";
import test from "node:test";

import { resolveModelBrand } from "../src/components/admin/ai/model-brand";

test("resolves common Model families from providerModelId", () => {
  const cases = {
    "deepseek/deepseek-v4.1-flash:free": "deepseek",
    "openai/gpt-oss-120b": "openai",
    "anthropic/claude-sonnet-4-6": "anthropic",
    "google/gemini-3.1-pro": "gemini",
    "qwen/qwen3.8-27b": "qwen",
    "z-ai/glm-4.5": "zhipu",
    "meta/muse-spark-1.3-contributor": "meta",
    "muse-spark-1.3-contributor": "meta",
    "meta-llama/llama-3.3-70b": "llama",
    "mistralai/mistral-small": "mistral",
    "nvidia/nemotron-3-ultra-550b-a55b": "nvidia",
    "nemotron-3-ultra-550b-a55b": "nvidia",
    "x-ai/grok-4": "grok",
    "cohere/command-r": "cohere",
    "opencode/big-pickle": "opencode",
    "big-pickle": "opencode",
  } as const;

  for (const [providerModelId, expected] of Object.entries(cases)) {
    assert.equal(resolveModelBrand(providerModelId), expected, providerModelId);
  }
});

test("uses an explicit display-name hint only when the ID is otherwise ambiguous", () => {
  assert.equal(resolveModelBrand("custom-model", { displayName: "Qwen Coder" }), "qwen");
  assert.equal(resolveModelBrand("openrouter/free", { displayName: "auto" }), "generic");
});

test("keeps unknown and ambiguous routing aliases generic", () => {
  assert.equal(resolveModelBrand("internal/production-model-v2"), "generic");
  assert.equal(resolveModelBrand("openrouter/free"), "generic");
  assert.equal(resolveModelBrand("custom-internal-model-v2"), "generic");
});
