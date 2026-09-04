import { SQLiteAIConversationRepository } from "../conversations";
import type { AIMemoryExecution, AIMemoryExecutionSource, AIMemoryExecutionSourceMessage } from "./execution-contracts";
import { AIMemoryExecutionError } from "./execution-errors";

/** Reads the exact live M4 source; no source copy is placed in durable M10B metadata. */
export class AIMemoryExecutionSourceReader {
  constructor(private readonly conversations: SQLiteAIConversationRepository) {}

  getSource(execution: Pick<AIMemoryExecution, "principalRef" | "subjectKey" | "conversationId" | "responseId" | "requestMessageId" | "assistantMessageId">): AIMemoryExecutionSource {
    const conversation = this.conversations.getConversation(execution.principalRef, execution.conversationId);
    const response = conversation ? this.conversations.getResponse(execution.principalRef, execution.responseId) : null;
    const requestMessage = this.conversations.getMessage(execution.requestMessageId);
    const assistantMessage = this.conversations.getMessage(execution.assistantMessageId);
    if (!conversation || conversation.status !== "ACTIVE" || conversation.subjectKey !== execution.subjectKey || !response || response.status !== "COMPLETED" || response.conversationId !== conversation.id || response.principalRef !== execution.principalRef || response.requestMessageId !== execution.requestMessageId || response.assistantMessageId !== execution.assistantMessageId || !requestMessage || !assistantMessage || requestMessage.conversationId !== conversation.id || assistantMessage.conversationId !== conversation.id || requestMessage.role !== "USER" || assistantMessage.role !== "ASSISTANT" || requestMessage.isPartial || assistantMessage.isPartial || assistantMessage.ordinal !== requestMessage.ordinal + 1 || !response.finishReason || ["FAILED", "CANCELLED"].includes(response.finishReason)) {
      throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_INPUT_LOST", "The completed Conversation source is no longer available for Memory execution.");
    }
    return { response, requestMessage, assistantMessage };
  }

  listMessages(input: { principalRef: string; conversationId: string; fromOrdinal: number; toOrdinal: number }): AIMemoryExecutionSourceMessage[] {
    if (!Number.isSafeInteger(input.fromOrdinal) || !Number.isSafeInteger(input.toOrdinal) || input.fromOrdinal < 1 || input.toOrdinal < input.fromOrdinal) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_SOURCE_INVALID", "The Memory source range is invalid.");
    const rows = this.conversations.listMessagesBefore({
      principalRef: input.principalRef,
      conversationId: input.conversationId,
      beforeOrdinal: input.toOrdinal + 1,
      afterOrdinal: input.fromOrdinal - 1,
      limit: 10_000,
      excludePartial: true,
    }).sort((left, right) => left.ordinal - right.ordinal);
    if (rows.length !== input.toOrdinal - input.fromOrdinal + 1 || rows.some((message) => message.isPartial)) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_SOURCE_INVALID", "The Memory source range is incomplete.");
    return rows.map((message) => ({ role: message.role, ordinal: message.ordinal, content: message.content }));
  }
}
