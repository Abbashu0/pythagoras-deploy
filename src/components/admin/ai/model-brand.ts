export type ModelBrand =
  | "deepseek"
  | "openai"
  | "anthropic"
  | "gemini"
  | "qwen"
  | "zhipu"
  | "meta"
  | "llama"
  | "mistral"
  | "nvidia"
  | "grok"
  | "cohere"
  | "opencode"
  | "generic";

export function resolveModelBrand(
  providerModelId: string,
  hints: { displayName?: string } = {},
): ModelBrand {
  return (
    resolveIdentifier(providerModelId) ??
    resolveIdentifier(hints.displayName ?? "") ??
    "generic"
  );
}

function resolveIdentifier(value: string): Exclude<ModelBrand, "generic"> | null {
  const normalized = value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[_:]/gu, "-")
    .replace(/[^a-z0-9/-]+/gu, "-");
  if (!normalized) return null;

  const tokens = normalized.split(/[\/-]+/u).filter(Boolean);
  const has = (...values: string[]) =>
    tokens.some((token) => values.includes(token));

  if (has("deepseek")) return "deepseek";
  if (has("openai", "gpt")) return "openai";
  if (has("anthropic", "claude")) return "anthropic";
  if (has("google", "gemini")) return "gemini";
  if (has("qwen")) return "qwen";
  if (
    has("zhipu", "zai", "glm") ||
    /(?:^|[-/])z-ai(?:[-/]|$)/u.test(normalized)
  ) {
    return "zhipu";
  }
  if (has("llama")) return "llama";
  if (has("meta") || /(?:^|[-/])muse-spark(?:[-/]|$)/u.test(normalized)) {
    return "meta";
  }
  if (has("mistralai", "mistral")) return "mistral";
  if (has("nvidia", "nemotron")) return "nvidia";
  if (has("xai", "grok") || /(?:^|[-/])x-ai(?:[-/]|$)/u.test(normalized)) {
    return "grok";
  }
  if (has("cohere")) return "cohere";
  if (has("opencode")) return "opencode";
  if (normalized === "big-pickle" || normalized.endsWith("/big-pickle")) {
    return "opencode";
  }
  return null;
}
