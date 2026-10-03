export const MAX_TEMP_CHAT_MESSAGES = 32;

export type Agent1AssistantTurnStatus =
  | "working"
  | "thinking"
  | "streaming"
  | "completed"
  | "incomplete"
  | "error";

export type ChatReaction = "like" | "dislike";

export type ChatLayoutTestCase = "short" | "biology" | "math" | "table" | "scroll" | "stream";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface ChatTurn {
  id: string;
  user: ChatMessage;
  assistantAttempt: number;
  assistant: ChatMessage | null;
  assistantStatus: Agent1AssistantTurnStatus | null;
  errorMessage: string | null;
}

export type Agent1ChatStreamEvent =
  | { type: "started" }
  | { type: "phase"; phase: "working" | "thinking" }
  | { type: "text_delta"; text: string }
  | { type: "completed" };

export interface ChatComposerProps {
  turns: readonly ChatTurn[];
  onSend: (text: string) => string | null;
  onCancel: () => void;
  onRegenerate: (turnId: string) => void;
  onNewChat: () => void;
  onSelectDevelopmentRecent: (testCase: ChatLayoutTestCase) => void;
  newChatKey: number;
  activeTurnId: string | null;
  submissionError: string | null;
  layoutDiagnosticsEnabled?: boolean;
}
