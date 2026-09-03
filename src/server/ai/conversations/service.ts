import { v7 as uuidv7 } from "uuid";

import type { ContentDatabase } from "../../content/database";
import { assertActiveStudentPrincipal } from "./principal";
import type {
  AIBeginTurnInput,
  AIBeginTurnResult,
  AIConversation,
  AIConversationChunkAppendResult,
  AIConversationFinishReason,
  AIConversationListQuery,
  AIConversationMessage,
  AIConversationMessageQuery,
  AIConversationResponse,
  AIConversationResponseChunk,
  AIConversationResponseResult,
  AIConversationSubjectCatalog,
  AIStudentPrincipal,
} from "./contracts";
import {
  AI_CONVERSATION_MAX_RESPONSE_BYTES,
  type AIConversationSafeErrorCode,
} from "./contracts";
import { AIConversationError } from "./errors";
import { SQLiteAIConversationRepository } from "./sqlite-repository";
import { SQLiteAIConversationSubjectCatalog } from "./subject-catalog";
import {
  byteLength,
  createConversationRequestFingerprint,
  hashConversationText,
  normalizeConversationId,
  normalizeConversationPageLimit,
  normalizeConversationSubjectKey,
  normalizeCursor,
  normalizeFinishReason,
  normalizeIdempotencyKey,
  normalizeMessagePage,
  normalizeSafeResponseErrorCode,
  validateResponseChunkText,
  validateResponseOutputBytes,
  validateUserMessageContent,
} from "./validation";

export interface AIConversationServiceDependencies {
  repository?: SQLiteAIConversationRepository;
  subjects?: AIConversationSubjectCatalog;
  clock?: () => number;
  idFactory?: () => string;
}

export class AIConversationService {
  private readonly repository: SQLiteAIConversationRepository;
  private readonly subjects: AIConversationSubjectCatalog;
  private readonly clock: () => number;
  private readonly idFactory: () => string;

  constructor(
    private readonly database: ContentDatabase,
    dependencies: AIConversationServiceDependencies = {},
  ) {
    this.repository = dependencies.repository ?? new SQLiteAIConversationRepository(database);
    this.subjects = dependencies.subjects ?? new SQLiteAIConversationSubjectCatalog(database);
    this.clock = dependencies.clock ?? Date.now;
    this.idFactory = dependencies.idFactory ?? uuidv7;
  }

  createConversation(principal: AIStudentPrincipal, subjectKey: string): AIConversation {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    const now = this.safeNow();
    return this.database.client.transaction(() => this.createConversationInTransaction(activePrincipal, {
      conversationId: this.idFactory(),
      subjectKey,
      createdAt: now,
    }))();
  }

  /**
   * Creates a Conversation without opening a nested transaction. Callers must
   * use this only inside their own transaction when they need to bind another
   * durable owner atomically. The same principal/subject validation as the
   * normal creation path is always applied.
   */
  createConversationInTransaction(
    principal: AIStudentPrincipal,
    input: { conversationId: string; subjectKey: string; createdAt: number },
  ): AIConversation {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    const subject = this.requireSubject(input.subjectKey);
    const conversationId = normalizeConversationId(input.conversationId);
    if (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
      throw new AIConversationError("AI_CONVERSATION_INVALID", "The Conversation timestamp is invalid.");
    }
    return this.repository.insertConversation({
      id: conversationId,
      principalRef: activePrincipal.principalRef,
      subjectKey: subject.subjectKey,
      createdAt: input.createdAt,
    });
  }

  beginTurn(principal: AIStudentPrincipal, input: AIBeginTurnInput): AIBeginTurnResult {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    const conversationId = normalizeConversationId(input.conversationId);
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    const userContent = validateUserMessageContent(input.userContent);
    const now = this.safeNow();
    return this.database.client.transaction(() => {
      const conversation = this.requireOwnedActiveConversation(activePrincipal.principalRef, conversationId);
      const requestFingerprint = createConversationRequestFingerprint({
        conversationId,
        subjectKey: conversation.subjectKey,
        userContent,
      });
      const historicalResponse = this.repository.getResponseByIdempotencyIncludingDeleted(activePrincipal.principalRef, idempotencyKey);
      if (historicalResponse) {
        if (historicalResponse.conversationId !== conversationId || historicalResponse.requestFingerprint === null || historicalResponse.requestFingerprint !== requestFingerprint) {
          throw new AIConversationError("AI_CONVERSATION_IDEMPOTENCY_CONFLICT", "The Conversation idempotency key is bound to a different request.");
        }
        const userMessage = historicalResponse.requestMessageId ? this.repository.getMessage(historicalResponse.requestMessageId) : null;
        if (!userMessage) throw new AIConversationError("AI_CONVERSATION_INVALID", "The idempotent Conversation request is incomplete.");
        return { replayed: true, conversation, userMessage, response: historicalResponse };
      }

      const responses = this.repository.listResponsesForConversation(conversationId, activePrincipal.principalRef);
      if (responses.some((response) => response.status === "PENDING" || response.status === "STREAMING")) {
        throw new AIConversationError("AI_CONVERSATION_BUSY", "The Conversation already has an active response.");
      }
      const userMessage = this.repository.insertMessage({
        id: this.idFactory(),
        conversationId,
        ordinal: this.repository.nextMessageOrdinal(conversationId),
        role: "USER",
        content: userContent,
        isPartial: false,
        createdAt: now,
      });
      const response = this.repository.insertResponse({
        id: this.idFactory(),
        conversationId,
        principalRef: activePrincipal.principalRef,
        idempotencyKey,
        requestFingerprint,
        requestMessageId: userMessage.id,
        createdAt: now,
      });
      const updatedConversation = this.repository.touchConversation(conversationId, activePrincipal.principalRef, now);
      return { replayed: false, conversation: updatedConversation, userMessage, response };
    }).immediate();
  }

  getConversation(principal: AIStudentPrincipal, conversationId: string): AIConversation {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    const conversation = this.repository.getConversation(activePrincipal.principalRef, normalizeConversationId(conversationId));
    if (!conversation) throw new AIConversationError("AI_CONVERSATION_NOT_FOUND", "The Conversation was not found.");
    return conversation;
  }

  listConversations(principal: AIStudentPrincipal, input: AIConversationListQuery = {}): AIConversation[] {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    const subjectKey = input.subjectKey === undefined ? undefined : this.requireSubject(input.subjectKey).subjectKey;
    return this.repository.listActiveConversations({
      principalRef: activePrincipal.principalRef,
      subjectKey,
      cursor: normalizeCursor(input.cursor),
      limit: normalizeConversationPageLimit(input.limit),
    });
  }

  listMessages(principal: AIStudentPrincipal, conversationId: string, input: AIConversationMessageQuery = {}): AIConversationMessage[] {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    const normalizedConversationId = normalizeConversationId(conversationId);
    const page = normalizeMessagePage(input);
    this.requireOwnedActiveConversation(activePrincipal.principalRef, normalizedConversationId);
    return this.repository.listMessages({
      principalRef: activePrincipal.principalRef,
      conversationId: normalizedConversationId,
      ...page,
    });
  }

  getResponse(principal: AIStudentPrincipal, responseId: string): AIConversationResponse {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    const response = this.repository.getResponse(activePrincipal.principalRef, normalizeConversationId(responseId));
    if (!response) throw new AIConversationError("AI_CONVERSATION_NOT_FOUND", "The Conversation response was not found.");
    return response;
  }

  listResponseChunks(principal: AIStudentPrincipal, responseId: string): AIConversationResponseChunk[] {
    const response = this.getResponse(principal, responseId);
    return this.repository.listChunks(response.id);
  }

  startResponse(principal: AIStudentPrincipal, responseId: string): AIConversationResponse {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    const normalizedResponseId = normalizeConversationId(responseId);
    const now = this.safeNow();
    return this.database.client.transaction(() => {
      const response = this.requireOwnedActiveResponse(activePrincipal.principalRef, normalizedResponseId);
      if (response.status === "STREAMING") return response;
      if (response.status !== "PENDING") this.throwTerminal(response);
      const updated = this.repository.updateResponse({
        responseId: response.id,
        conversationId: response.conversationId,
        principalRef: activePrincipal.principalRef,
        expectedStatuses: ["PENDING"],
        patch: { status: "STREAMING", startedAt: now, updatedAt: now },
      });
      if (!updated) throw new AIConversationError("AI_CONVERSATION_RESPONSE_INVALID", "The Conversation response changed before it could start.");
      this.repository.touchConversation(response.conversationId, activePrincipal.principalRef, now);
      return updated;
    }).immediate();
  }

  appendResponseChunk(
    principal: AIStudentPrincipal,
    responseId: string,
    sequence: number,
    text: string,
  ): AIConversationChunkAppendResult {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    const normalizedResponseId = normalizeConversationId(responseId);
    const normalizedSequence = this.requireSequence(sequence);
    const normalizedText = validateResponseChunkText(text);
    const textHash = hashConversationText(normalizedText);
    const byteLengthValue = byteLength(normalizedText);
    const now = this.safeNow();
    return this.database.client.transaction(() => {
      const response = this.requireOwnedActiveResponse(activePrincipal.principalRef, normalizedResponseId);
      if (response.status !== "STREAMING") {
        if (response.status === "PENDING") throw new AIConversationError("AI_CONVERSATION_RESPONSE_INVALID", "The response must be started before appending chunks.");
        this.throwTerminal(response);
      }
      if (normalizedSequence < response.nextChunkSequence) {
        const existing = this.repository.getChunk(response.id, normalizedSequence);
        if (existing && existing.textHash === textHash && existing.text === normalizedText && existing.byteLength === byteLengthValue) {
          const current = this.requireOwnedActiveResponse(activePrincipal.principalRef, normalizedResponseId);
          return { response: current, chunk: existing, replayed: true };
        }
        throw new AIConversationError("AI_CONVERSATION_STREAM_CONFLICT", "The response chunk sequence is already bound to different content.");
      }
      if (normalizedSequence !== response.nextChunkSequence) {
        throw new AIConversationError("AI_CONVERSATION_STREAM_CONFLICT", "Response chunks must be appended in order.");
      }
      const nextOutputBytes = response.outputBytes + byteLengthValue;
      validateResponseOutputBytes(nextOutputBytes);
      const chunk = this.repository.insertChunk({
        responseId: response.id,
        sequence: normalizedSequence,
        text: normalizedText,
        textHash,
        byteLength: byteLengthValue,
        createdAt: now,
      });
      const updated = this.repository.updateResponse({
        responseId: response.id,
        conversationId: response.conversationId,
        principalRef: activePrincipal.principalRef,
        expectedStatuses: ["STREAMING"],
        expectedNextChunkSequence: response.nextChunkSequence,
        patch: { nextChunkSequence: response.nextChunkSequence + 1, outputBytes: nextOutputBytes, updatedAt: now },
      });
      if (!updated) throw new AIConversationError("AI_CONVERSATION_STREAM_CONFLICT", "The response changed before the chunk could be appended.");
      this.repository.touchConversation(response.conversationId, activePrincipal.principalRef, now);
      return { response: updated, chunk, replayed: false };
    }).immediate();
  }

  completeResponse(
    principal: AIStudentPrincipal,
    responseId: string,
    finishReason: AIConversationFinishReason,
  ): AIConversationResponseResult {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    const normalizedResponseId = normalizeConversationId(responseId);
    const normalizedFinishReason = this.requireSuccessfulFinishReason(finishReason);
    const now = this.safeNow();
    return this.database.client.transaction(() => {
      const response = this.requireOwnedActiveResponse(activePrincipal.principalRef, normalizedResponseId);
      if (response.status === "COMPLETED") return this.responseResult(response);
      if (response.status !== "STREAMING") {
        if (response.status === "PENDING") throw new AIConversationError("AI_CONVERSATION_RESPONSE_INVALID", "The response must be started before completion.");
        this.throwTerminal(response);
      }
      const text = this.combineAndValidateChunks(response);
      const assistantMessage = text.length
        ? this.repository.insertMessage({
            id: this.idFactory(),
            conversationId: response.conversationId,
            ordinal: this.repository.nextMessageOrdinal(response.conversationId),
            role: "ASSISTANT",
            content: text,
            isPartial: false,
            createdAt: now,
          })
        : null;
      const updated = this.repository.updateResponse({
        responseId: response.id,
        conversationId: response.conversationId,
        principalRef: activePrincipal.principalRef,
        expectedStatuses: ["STREAMING"],
        patch: {
          status: "COMPLETED",
          finishReason: normalizedFinishReason,
          completedAt: now,
          assistantMessageId: assistantMessage?.id ?? null,
          updatedAt: now,
        },
      });
      if (!updated) throw new AIConversationError("AI_CONVERSATION_RESPONSE_INVALID", "The response changed before completion.");
      this.repository.deleteChunks(response.id);
      this.repository.touchConversation(response.conversationId, activePrincipal.principalRef, now);
      return { response: updated, assistantMessage };
    }).immediate();
  }

  failResponse(
    principal: AIStudentPrincipal,
    responseId: string,
    safeErrorCode: AIConversationSafeErrorCode = "AI_CONVERSATION_RESPONSE_INVALID",
  ): AIConversationResponseResult {
    return this.terminalizeResponse(principal, responseId, "FAILED", "FAILED", safeErrorCode);
  }

  cancelResponse(principal: AIStudentPrincipal, responseId: string): AIConversationResponseResult {
    return this.terminalizeResponse(principal, responseId, "CANCELLED", "CANCELLED", "AI_CONVERSATION_CANCELLED");
  }

  deleteConversation(principal: AIStudentPrincipal, conversationId: string): AIConversation {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    const normalizedConversationId = normalizeConversationId(conversationId);
    const now = this.safeNow();
    return this.database.client.transaction(() => {
      const conversation = this.repository.getConversation(activePrincipal.principalRef, normalizedConversationId, true);
      if (!conversation) throw new AIConversationError("AI_CONVERSATION_NOT_FOUND", "The Conversation was not found.");
      if (conversation.status === "DELETED") return conversation;
      const responses = this.repository.listResponsesForConversation(normalizedConversationId, activePrincipal.principalRef);
      for (const response of responses) {
        const patch: Parameters<SQLiteAIConversationRepository["updateResponse"]>[0]["patch"] = {
          requestFingerprint: null,
          requestMessageId: null,
          assistantMessageId: null,
          updatedAt: now,
        };
        if (response.status === "PENDING" || response.status === "STREAMING") {
          patch.status = "CANCELLED";
          patch.finishReason = "CANCELLED";
          patch.safeErrorCode = "AI_CONVERSATION_DELETED";
          patch.completedAt = now;
        }
        const updated = this.repository.updateResponse({
          responseId: response.id,
          conversationId: normalizedConversationId,
          principalRef: activePrincipal.principalRef,
          expectedStatuses: [response.status],
          patch,
        });
        if (!updated) throw new AIConversationError("AI_CONVERSATION_INVALID", "The Conversation response could not be deleted safely.");
        this.repository.deleteChunks(response.id);
      }
      this.repository.deleteMessages(normalizedConversationId);
      const tombstone = this.repository.deleteConversationTombstone({
        conversationId: normalizedConversationId,
        principalRef: activePrincipal.principalRef,
        at: now,
      });
      if (!tombstone) throw new AIConversationError("AI_CONVERSATION_INVALID", "The Conversation could not be deleted safely.");
      return tombstone;
    }).immediate();
  }

  private terminalizeResponse(
    principal: AIStudentPrincipal,
    responseId: string,
    status: "FAILED" | "CANCELLED",
    finishReason: "FAILED" | "CANCELLED",
    safeErrorCode: AIConversationSafeErrorCode,
  ): AIConversationResponseResult {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    const normalizedResponseId = normalizeConversationId(responseId);
    const normalizedErrorCode = normalizeSafeResponseErrorCode(safeErrorCode);
    const now = this.safeNow();
    return this.database.client.transaction(() => {
      const response = this.requireOwnedActiveResponse(activePrincipal.principalRef, normalizedResponseId);
      if (response.status === status) return this.responseResult(response);
      if (response.status !== "PENDING" && response.status !== "STREAMING") this.throwTerminal(response);
      const text = this.combineAndValidateChunks(response);
      const assistantMessage = text.length
        ? this.repository.insertMessage({
            id: this.idFactory(),
            conversationId: response.conversationId,
            ordinal: this.repository.nextMessageOrdinal(response.conversationId),
            role: "ASSISTANT",
            content: text,
            isPartial: true,
            createdAt: now,
          })
        : null;
      const updated = this.repository.updateResponse({
        responseId: response.id,
        conversationId: response.conversationId,
        principalRef: activePrincipal.principalRef,
        expectedStatuses: ["PENDING", "STREAMING"],
        patch: {
          status,
          finishReason,
          safeErrorCode: normalizedErrorCode,
          completedAt: now,
          assistantMessageId: assistantMessage?.id ?? null,
          updatedAt: now,
        },
      });
      if (!updated) throw new AIConversationError("AI_CONVERSATION_RESPONSE_INVALID", "The response changed before it could be terminalized.");
      this.repository.deleteChunks(response.id);
      this.repository.touchConversation(response.conversationId, activePrincipal.principalRef, now);
      return { response: updated, assistantMessage };
    }).immediate();
  }

  private responseResult(response: AIConversationResponse): AIConversationResponseResult {
    return {
      response,
      assistantMessage: response.assistantMessageId ? this.repository.getMessage(response.assistantMessageId) : null,
    };
  }

  private combineAndValidateChunks(response: AIConversationResponse): string {
    const chunks = this.repository.listChunks(response.id);
    if (chunks.length !== response.nextChunkSequence) {
      throw new AIConversationError("AI_CONVERSATION_STREAM_CONFLICT", "The response chunk sequence is incomplete.");
    }
    let totalBytes = 0;
    let combined = "";
    chunks.forEach((chunk, index) => {
      if (chunk.sequence !== index || hashConversationText(chunk.text) !== chunk.textHash || byteLength(chunk.text) !== chunk.byteLength) {
        throw new AIConversationError("AI_CONVERSATION_STREAM_CONFLICT", "The response chunk stream is invalid.");
      }
      totalBytes += chunk.byteLength;
      combined += chunk.text;
    });
    validateResponseOutputBytes(totalBytes);
    if (totalBytes !== response.outputBytes || byteLength(combined) > AI_CONVERSATION_MAX_RESPONSE_BYTES) {
      throw new AIConversationError("AI_CONVERSATION_STREAM_CONFLICT", "The response output size is inconsistent.");
    }
    return combined;
  }

  private requireOwnedActiveConversation(principalRef: string, conversationId: string): AIConversation {
    const conversation = this.repository.getConversation(principalRef, conversationId);
    if (!conversation) throw new AIConversationError("AI_CONVERSATION_NOT_FOUND", "The Conversation was not found.");
    return conversation;
  }

  private requireOwnedActiveResponse(principalRef: string, responseId: string): AIConversationResponse {
    const response = this.repository.getResponse(principalRef, responseId);
    if (!response) throw new AIConversationError("AI_CONVERSATION_NOT_FOUND", "The Conversation response was not found.");
    return response;
  }

  private requireSubject(subjectKey: string) {
    const normalizedSubjectKey = normalizeConversationSubjectKey(subjectKey);
    const subject = this.subjects.getSubject(normalizedSubjectKey);
    if (!subject) throw new AIConversationError("AI_CONVERSATION_SUBJECT_INVALID", "The Conversation subject is not available.");
    return subject;
  }

  private requireSequence(sequence: number): number {
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > 100_000_000) throw new AIConversationError("AI_CONVERSATION_STREAM_CONFLICT", "Response chunk sequence is invalid.");
    return sequence;
  }

  private requireSuccessfulFinishReason(value: AIConversationFinishReason): Exclude<AIConversationFinishReason, "FAILED" | "CANCELLED"> {
    const normalized = normalizeFinishReason(value);
    if (normalized === "FAILED" || normalized === "CANCELLED") throw new AIConversationError("AI_CONVERSATION_RESPONSE_INVALID", "The successful response finish reason is invalid.");
    return normalized;
  }

  private throwTerminal(response: AIConversationResponse): never {
    throw new AIConversationError("AI_CONVERSATION_RESPONSE_TERMINAL", "The Conversation response is already terminal.", { status: response.status });
  }

  private safeNow(): number {
    const value = this.clock();
    if (!Number.isSafeInteger(value) || value < 0) throw new AIConversationError("AI_CONVERSATION_INVALID", "Conversation time is invalid.");
    return value;
  }
}
