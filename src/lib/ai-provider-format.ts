export const AI_PROVIDER_API_FORMATS = [
  "OPENAI_CHAT_COMPLETIONS",
  "OPENAI_RESPONSES",
  "ANTHROPIC_MESSAGES",
] as const;

export type AIProviderApiFormat = (typeof AI_PROVIDER_API_FORMATS)[number];

export const AI_PROVIDER_API_FORMAT_LABELS: Record<AIProviderApiFormat, string> = {
  OPENAI_CHAT_COMPLETIONS: "OpenAI-compatible · Chat Completions",
  OPENAI_RESPONSES: "OpenAI-compatible · Responses",
  ANTHROPIC_MESSAGES: "Anthropic · Messages",
};

export const AI_PROVIDER_API_FORMAT_PATHS: Record<AIProviderApiFormat, string> = {
  OPENAI_CHAT_COMPLETIONS: "chat/completions",
  OPENAI_RESPONSES: "responses",
  ANTHROPIC_MESSAGES: "v1/messages",
};
