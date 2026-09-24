export const MAX_TEMP_CHAT_MESSAGES = 32;

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface ChatComposerProps {
  messages: readonly ChatMessage[];
  onSend: (text: string) => Promise<boolean>;
  sending?: boolean;
  errorMessage?: string | null;
}
