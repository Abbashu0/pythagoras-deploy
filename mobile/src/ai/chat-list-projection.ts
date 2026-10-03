import type { ChatMessage, ChatTurn } from './chat-types';

export interface Agent1UserRenderRow {
  id: string;
  kind: 'user';
  turnId: string;
  message: ChatMessage;
}

export interface Agent1AssistantRenderRow {
  id: string;
  kind: 'assistant';
  turnId: string;
  assistantAttempt: number;
  message: ChatMessage | null;
  turn: ChatTurn;
}

export type Agent1ChatRenderRow = Agent1UserRenderRow | Agent1AssistantRenderRow;

/** Projects one domain turn into stable user/assistant list items without changing history semantics. */
export function projectAgent1ChatTurns(
  turns: readonly ChatTurn[],
): Agent1ChatRenderRow[] {
  const rows: Agent1ChatRenderRow[] = [];
  for (const turn of turns) {
    rows.push({
      id: `user:${turn.user.id}`,
      kind: 'user',
      turnId: turn.id,
      message: turn.user,
    });
    rows.push({
      id: `assistant:${turn.id}:${turn.assistantAttempt}`,
      kind: 'assistant',
      turnId: turn.id,
      assistantAttempt: turn.assistantAttempt,
      message: turn.assistant,
      turn,
    });
  }
  return rows;
}
