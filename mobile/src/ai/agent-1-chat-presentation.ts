import type { ChatTurn } from "./chat-types";

export type Agent1ChatRenderRow =
  | {
      type: "user-message";
      key: string;
      turnId: string;
      message: ChatTurn["user"];
    }
  | {
      type: "assistant-message";
      key: string;
      turn: ChatTurn;
    };

/** Projects the domain turn into independently measured, stable presentation rows. */
export function projectAgent1ChatRows(
  turns: readonly ChatTurn[],
): Agent1ChatRenderRow[] {
  return turns.flatMap((turn) => [
    {
      type: "user-message" as const,
      key: `turn:${turn.id}:user`,
      turnId: turn.id,
      message: turn.user,
    },
    {
      type: "assistant-message" as const,
      key: `turn:${turn.id}:assistant:${turn.assistantAttempt}`,
      turn,
    },
  ]);
}
