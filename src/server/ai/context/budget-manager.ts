import {
  AI_CONTEXT_POLICY_MAX_BUDGET_TOKENS,
  AI_CONTEXT_POLICY_MAX_RECENT_TURNS,
} from "../policy/context-policy-contracts";
import {
  AI_MEMORY_CONFIDENCE_SCALE,
  AI_MEMORY_MAX_TEXT_BYTES,
  type AIContextMemory,
} from "../memory/contracts";
import {
  AI_CONTEXT_PRECEDENCE_ENVELOPE,
  type AIContextBudget,
  type AIContextBudgetManagerInput,
  type AIContextBudgetManagerResult,
  type AIContextDecision,
  type AIContextInstructionLayer,
} from "./contracts";
import { AIContextError } from "./errors";
import { AIPolicyError } from "../policy/errors";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SUBJECT_KEY_PATTERN = /^[a-z0-9-]{1,80}$/u;
const ESTIMATOR_KEY_PATTERN = /^[A-Za-z0-9._-]{1,120}$/u;
const MAX_ESTIMATED_TOKENS = 10_000_000;
const MAX_SUMMARY_BYTES = 128 * 1024;
const MAX_SOURCE_ID_LENGTH = 200;

export class ContextBudgetManager {
  build(input: AIContextBudgetManagerInput): AIContextBudgetManagerResult {
    this.validateInput(input);
    const envelopeTokens = this.estimate(input.estimator, AI_CONTEXT_PRECEDENCE_ENVELOPE);
    const globalTokens = this.estimate(input.estimator, input.globalPolicy.instructions);
    const subjectTokens = this.estimate(input.estimator, input.subjectPolicy.instructions);
    const currentTokens = this.estimate(input.estimator, input.currentMessage.content);
    const policyTokens = envelopeTokens + globalTokens + subjectTokens;
    if (policyTokens > input.contextPolicy.policyBudgetTokens) {
      throw new AIContextError("AI_CONTEXT_POLICY_BUDGET_EXCEEDED", "The mandatory policy layers exceed the Context Policy budget.", { policyTokens, policyBudgetTokens: input.contextPolicy.policyBudgetTokens });
    }
    const mandatoryTokens = policyTokens + currentTokens;
    if (mandatoryTokens > input.contextPolicy.hardInputBudgetTokens) {
      throw new AIContextError("AI_CONTEXT_HARD_LIMIT_EXCEEDED", "The mandatory Context exceeds the hard input budget.", { mandatoryTokens, hardInputBudgetTokens: input.contextPolicy.hardInputBudgetTokens });
    }

    const decisions: AIContextDecision[] = [
      { kind: "PRECEDENCE_ENVELOPE", sourceId: "code:global-precedence-v1", sourceRevision: 1, ordinal: null, estimatedTokens: envelopeTokens, decision: "INCLUDED", decisionReason: null },
      { kind: "GLOBAL_POLICY", sourceId: input.globalPolicy.policyId, sourceRevision: input.globalPolicy.revision, ordinal: null, estimatedTokens: globalTokens, decision: "INCLUDED", decisionReason: null },
      { kind: "SUBJECT_POLICY", sourceId: input.subjectPolicy.policyId, sourceRevision: input.subjectPolicy.revision, ordinal: null, estimatedTokens: subjectTokens, decision: "INCLUDED", decisionReason: null },
    ];
    let optionalInputTokens = 0;
    let selectedSummary: AIContextBudgetManagerInput["summary"];
    if (input.summary) {
      const summaryTokens = this.estimate(input.estimator, input.summary.text);
      const summaryReason = summaryTokens > input.contextPolicy.summaryBudgetTokens
        ? "SUMMARY_BUDGET_EXCEEDED"
        : mandatoryTokens + summaryTokens > input.contextPolicy.softInputBudgetTokens
          ? "SOFT_INPUT_BUDGET_EXCEEDED"
          : null;
      decisions.push({
        kind: "CONVERSATION_SUMMARY",
        sourceId: input.summary.summaryId,
        sourceRevision: input.summary.revision,
        ordinal: input.summary.coversThroughOrdinal,
        estimatedTokens: summaryTokens,
        decision: summaryReason ? "OMITTED" : "INCLUDED",
        decisionReason: summaryReason,
      });
      if (!summaryReason) {
        selectedSummary = input.summary;
        optionalInputTokens += summaryTokens;
      }
    }

    const selectedMemories: AIContextMemory[] = [];
    let memoryTokens = 0;
    const memories = [...(input.memories ?? [])].sort(compareMemories);
    for (const memory of memories) {
      const estimatedTokens = this.estimate(input.estimator, memory.text);
      const memoryBudgetRemaining = input.contextPolicy.memoryBudgetTokens - memoryTokens;
      const memoryReason = estimatedTokens > memoryBudgetRemaining
        ? "MEMORY_BUDGET_EXCEEDED"
        : mandatoryTokens + optionalInputTokens + estimatedTokens > input.contextPolicy.softInputBudgetTokens
          ? "SOFT_INPUT_BUDGET_EXCEEDED"
          : null;
      decisions.push({
        kind: "MEMORY",
        sourceId: memory.memoryId,
        sourceRevision: memory.revision,
        ordinal: null,
        estimatedTokens,
        decision: memoryReason ? "OMITTED" : "INCLUDED",
        decisionReason: memoryReason,
      });
      if (!memoryReason) {
        selectedMemories.push(memory);
        memoryTokens += estimatedTokens;
        optionalInputTokens += estimatedTokens;
      }
    }

    const remainingOptional = Math.max(input.contextPolicy.softInputBudgetTokens - mandatoryTokens - optionalInputTokens, 0);
    // Failed/cancelled Assistant output is retained in M4 for audit, but it
    // is not eligible to become trusted working context for a later turn.
    const contextEligibleMessages = input.previousMessages.filter((message) => !message.isPartial);
    const units = groupTurnUnits(contextEligibleMessages);
    const selectedUnits: AIContextMessageUnit[] = [];
    let recentTokens = 0;
    for (let index = units.length - 1; index >= 0 && selectedUnits.length < input.contextPolicy.maxRecentTurns; index -= 1) {
      const unit = units[index]!;
      const unitTokens = unit.messages.reduce((total, message) => total + this.estimate(input.estimator, message.content), 0);
      const categoryRemaining = input.contextPolicy.recentTurnsBudgetTokens - recentTokens;
      const canInclude = unitTokens <= categoryRemaining && unitTokens <= remainingOptional - recentTokens;
      if (!canInclude) {
        for (const message of unit.messages) decisions.push(this.messageDecision(message, this.estimate(input.estimator, message.content), "OMITTED", unitTokens > categoryRemaining ? "RECENT_TURNS_BUDGET_EXCEEDED" : "SOFT_INPUT_BUDGET_EXCEEDED"));
        break;
      }
      selectedUnits.unshift(unit);
      recentTokens += unitTokens;
      for (const message of unit.messages) decisions.push(this.messageDecision(message, this.estimate(input.estimator, message.content), "INCLUDED", null));
    }
    const recentMessages = selectedUnits.flatMap((unit) => unit.messages);
    optionalInputTokens += recentTokens;
    decisions.push({ kind: "CURRENT_MESSAGE", sourceId: input.currentMessage.id, sourceRevision: null, ordinal: input.currentMessage.ordinal, estimatedTokens: currentTokens, decision: "INCLUDED", decisionReason: null });
    const budget: AIContextBudget = {
      softInputBudgetTokens: input.contextPolicy.softInputBudgetTokens,
      hardInputBudgetTokens: input.contextPolicy.hardInputBudgetTokens,
      outputReserveTokens: input.contextPolicy.outputReserveTokens,
      policyBudgetTokens: input.contextPolicy.policyBudgetTokens,
      summaryBudgetTokens: input.contextPolicy.summaryBudgetTokens,
      memoryTokens,
      recentTurnsBudgetTokens: input.contextPolicy.recentTurnsBudgetTokens,
      memoryBudgetTokens: input.contextPolicy.memoryBudgetTokens,
      evidenceBudgetTokens: input.contextPolicy.evidenceBudgetTokens,
      maxRecentTurns: input.contextPolicy.maxRecentTurns,
      mandatoryInputTokens: mandatoryTokens,
      optionalInputTokens,
      totalInputTokens: mandatoryTokens + optionalInputTokens,
    };
    const instructionLayers: [AIContextInstructionLayer, AIContextInstructionLayer] = [
      { authority: "GLOBAL", policyId: input.globalPolicy.policyId, revision: input.globalPolicy.revision, text: input.globalPolicy.instructions, estimatedTokens: globalTokens },
      { authority: "SUBJECT", policyId: input.subjectPolicy.policyId, revision: input.subjectPolicy.revision, text: input.subjectPolicy.instructions, estimatedTokens: subjectTokens },
    ];
    return { precedenceEnvelope: AI_CONTEXT_PRECEDENCE_ENVELOPE, instructionLayers, ...(selectedSummary ? { summary: selectedSummary } : {}), memories: selectedMemories, recentMessages, currentMessage: input.currentMessage, budget, decisions };
  }

  private validateInput(input: AIContextBudgetManagerInput): void {
    if (!UUID_PATTERN.test(input.conversationId) || !SUBJECT_KEY_PATTERN.test(input.subjectKey)) throw new AIContextError("AI_CONTEXT_RESPONSE_INVALID", "The Context Conversation identity is invalid.");
    if (input.currentMessage.conversationId !== input.conversationId || input.currentMessage.role !== "USER" || !Number.isSafeInteger(input.currentMessage.ordinal) || input.currentMessage.ordinal < 1) throw new AIContextError("AI_CONTEXT_RESPONSE_INVALID", "The current Context message is invalid.");
    if (!input.estimator || typeof input.estimator !== "object" || typeof input.estimator.estimatorKey !== "string" || !ESTIMATOR_KEY_PATTERN.test(input.estimator.estimatorKey) || typeof input.estimator.estimate !== "function") throw new AIContextError("AI_CONTEXT_ESTIMATOR_INVALID", "The Context token estimator identity is invalid.");
    const policy = input.contextPolicy;
    const componentBudgets = [policy.policyBudgetTokens, policy.summaryBudgetTokens, policy.recentTurnsBudgetTokens, policy.memoryBudgetTokens, policy.evidenceBudgetTokens];
    if (!Number.isSafeInteger(policy.softInputBudgetTokens) || policy.softInputBudgetTokens <= 0 || policy.softInputBudgetTokens > AI_CONTEXT_POLICY_MAX_BUDGET_TOKENS || !Number.isSafeInteger(policy.hardInputBudgetTokens) || policy.hardInputBudgetTokens < policy.softInputBudgetTokens || policy.hardInputBudgetTokens > AI_CONTEXT_POLICY_MAX_BUDGET_TOKENS || !Number.isSafeInteger(policy.outputReserveTokens) || policy.outputReserveTokens <= 0 || policy.outputReserveTokens > AI_CONTEXT_POLICY_MAX_BUDGET_TOKENS || componentBudgets.some((budget) => !Number.isSafeInteger(budget) || budget < 0 || budget > policy.hardInputBudgetTokens) || !Number.isSafeInteger(policy.maxRecentTurns) || policy.maxRecentTurns < 1 || policy.maxRecentTurns > AI_CONTEXT_POLICY_MAX_RECENT_TURNS) throw new AIContextError("AI_CONTEXT_POLICY_INVALID", "The Context Policy budget is invalid.");
    if (input.globalPolicy.scope !== "GLOBAL" || input.globalPolicy.subjectKey !== null || !input.globalPolicy.enabled) throw new AIPolicyError("AI_POLICY_INVALID", "The Global Instruction Policy is invalid for Context.");
    if (input.subjectPolicy.scope !== "SUBJECT" || input.subjectPolicy.subjectKey !== input.subjectKey) throw new AIPolicyError("AI_POLICY_SUBJECT_MISMATCH", "The Subject Instruction Policy does not match the Conversation subject.");
    if (!input.subjectPolicy.enabled) throw new AIPolicyError("AI_POLICY_DISABLED", "The Subject Instruction Policy is disabled.");
    if (!input.contextPolicy.enabled) throw new AIContextError("AI_CONTEXT_POLICY_DISABLED", "The Context Policy is disabled.");
    for (const message of input.previousMessages) {
      if (message.conversationId !== input.conversationId || message.ordinal >= input.currentMessage.ordinal || message.id === input.currentMessage.id) throw new AIContextError("AI_CONTEXT_RESPONSE_INVALID", "Conversation history contains the current or an unrelated message.");
    }
    if (input.summary) {
      if (!UUID_PATTERN.test(input.summary.conversationId) || input.summary.conversationId !== input.conversationId || typeof input.summary.subjectKey !== "string" || input.summary.subjectKey !== input.subjectKey || !Number.isSafeInteger(input.summary.revision) || input.summary.revision < 1 || !Number.isSafeInteger(input.summary.coversThroughOrdinal) || input.summary.coversThroughOrdinal < 0 || input.summary.coversThroughOrdinal >= input.currentMessage.ordinal || typeof input.summary.summaryId !== "string" || !input.summary.summaryId.trim() || input.summary.summaryId.length > MAX_SOURCE_ID_LENGTH || typeof input.summary.text !== "string" || !input.summary.text.trim() || Buffer.byteLength(input.summary.text, "utf8") > MAX_SUMMARY_BYTES) {
        throw new AIContextError("AI_CONTEXT_SUMMARY_INVALID", "The supplied Conversation Summary is invalid.");
      }
      if (input.previousMessages.some((message) => message.ordinal <= input.summary!.coversThroughOrdinal)) throw new AIContextError("AI_CONTEXT_SUMMARY_INVALID", "Conversation history overlaps the supplied Summary.");
    }
    if (input.memories !== undefined && (!Array.isArray(input.memories) || input.memories.length > 100)) throw new AIContextError("AI_CONTEXT_RESPONSE_INVALID", "The Context Memory selection is invalid.");
    for (const memory of input.memories ?? []) {
      if (!UUID_PATTERN.test(memory.memoryId) || memory.scope !== "SUBJECT" || !Number.isSafeInteger(memory.revision) || memory.revision < 1 || memory.subjectKey !== input.subjectKey || !UUID_PATTERN.test(memory.sourceConversationId) || !Number.isSafeInteger(memory.sourceStartOrdinal) || memory.sourceStartOrdinal < 1 || !Number.isSafeInteger(memory.sourceEndOrdinal) || memory.sourceEndOrdinal < memory.sourceStartOrdinal || !Number.isSafeInteger(memory.confidenceUnits) || memory.confidenceUnits < 0 || memory.confidenceUnits > AI_MEMORY_CONFIDENCE_SCALE || typeof memory.text !== "string" || !memory.text.trim() || Buffer.byteLength(memory.text, "utf8") > AI_MEMORY_MAX_TEXT_BYTES || !Number.isSafeInteger(memory.createdAt) || memory.createdAt < 0 || !Number.isSafeInteger(memory.expiresAt) || memory.expiresAt <= memory.createdAt) {
        throw new AIContextError("AI_CONTEXT_RESPONSE_INVALID", "The Context Memory selection contains an invalid item.");
      }
    }
  }

  private estimate(estimator: AIContextBudgetManagerInput["estimator"], text: string): number {
    let value: number;
    try {
      value = estimator.estimate(text);
    } catch (error) {
      throw new AIContextError("AI_CONTEXT_ESTIMATOR_INVALID", "The Context token estimator failed safely.", {}, error);
    }
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_ESTIMATED_TOKENS) throw new AIContextError("AI_CONTEXT_ESTIMATOR_INVALID", "The Context token estimator returned an invalid result.");
    return value;
  }

  private messageDecision(message: AIContextBudgetManagerInput["currentMessage"], estimatedTokens: number, decision: "INCLUDED" | "OMITTED", decisionReason: string | null): AIContextDecision {
    return { kind: "RECENT_MESSAGE", sourceId: message.id, sourceRevision: null, ordinal: message.ordinal, estimatedTokens, decision, decisionReason };
  }
}

interface AIContextMessageUnit { messages: AIContextBudgetManagerInput["currentMessage"][] }

function groupTurnUnits(messages: AIContextBudgetManagerInput["currentMessage"][]): AIContextMessageUnit[] {
  const units: AIContextMessageUnit[] = [];
  let current: AIContextMessageUnit | null = null;
  for (const message of [...messages].sort((left, right) => left.ordinal - right.ordinal)) {
    if (message.role === "USER") {
      if (current) units.push(current);
      current = { messages: [message] };
    } else if (current) {
      current.messages.push(message);
    } else {
      units.push({ messages: [message] });
    }
  }
  if (current) units.push(current);
  return units;
}

function compareMemories(left: AIContextMemory, right: AIContextMemory): number {
  return right.confidenceUnits - left.confidenceUnits || right.createdAt - left.createdAt || left.memoryId.localeCompare(right.memoryId);
}
