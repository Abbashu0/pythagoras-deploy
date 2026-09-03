import {
  AITutorOutputValidator,
  type AITutorOutputValidationResult,
} from "../tutor/validation";
import type {
  AIEvalCaseRevision,
  AIEvalGrader,
  AIEvalGraderContext,
  AIEvalGraderRegistry,
  AIEvalGraderResultDraft,
  AIEvalObservation,
} from "./contracts";
import {
  AI_EVAL_GRADER_REGISTRY_KEY,
  AI_EVAL_GRADER_REGISTRY_REVISION,
  AI_EVAL_SCORE_SCALE,
} from "./contracts";
import { AIEvalError } from "./errors";

export const AI_EVAL_GRADER_KEYS = {
  STATUS_MATCH: "status-match-v1",
  CITATION_INTEGRITY: "citation-integrity-v1",
  EVIDENCE_EXPECTATION: "evidence-expectation-v1",
  RETRIEVAL_COVERAGE: "retrieval-coverage-v1",
  LITERAL_OUTPUT: "literal-output-v1",
  SECURITY_LEAK: "security-leak-v1",
  OUTPUT_BOUND: "output-bound-v1",
  COST_GATE: "cost-gate-v1",
  LATENCY_GATE: "latency-gate-v1",
} as const;

interface GraderDefinition {
  key: string;
  dimension: AIEvalGrader["dimension"];
  grade(caseRevision: AIEvalCaseRevision, observation: AIEvalObservation, context: AIEvalGraderContext): Omit<AIEvalGraderResultDraft, "graderKey" | "graderRevision" | "dimension">;
}

/** Code-owned deterministic grader identities. Configuration can select these identities but cannot supply code. */
export class AIDeterministicEvalGraderRegistry implements AIEvalGraderRegistry {
  private readonly graders: ReadonlyMap<string, AIEvalGrader>;

  constructor() {
    const graders = new Map<string, AIEvalGrader>();
    for (const definition of defaultDefinitions()) {
      const identity = `${definition.key}@${AI_EVAL_GRADER_REGISTRY_REVISION}`;
      if (graders.has(identity)) throw new AIEvalError("AI_EVAL_GRADER_UNSUPPORTED", "The deterministic Eval grader registry contains a duplicate identity.");
      graders.set(identity, {
        key: definition.key,
        revision: AI_EVAL_GRADER_REGISTRY_REVISION,
        dimension: definition.dimension,
        grade: ({ caseRevision, observation, context }) => {
          const result = definition.grade(caseRevision, observation, context);
          return { ...result, graderKey: definition.key, graderRevision: AI_EVAL_GRADER_REGISTRY_REVISION, dimension: definition.dimension };
        },
      });
    }
    this.graders = graders;
  }

  get(key: string, revision: number): AIEvalGrader | null {
    return this.graders.get(`${key}@${revision}`) ?? null;
  }

  supported(): ReadonlyArray<{ graderKey: string; graderRevision: number; dimension: AIEvalGrader["dimension"] }> {
    return [...this.graders.values()]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((grader) => ({ graderKey: grader.key, graderRevision: grader.revision, dimension: grader.dimension }));
  }
}

export function createDefaultAIEvalGraderRegistry(): AIDeterministicEvalGraderRegistry {
  return new AIDeterministicEvalGraderRegistry();
}

export function assertSupportedDeterministicGrader(
  registry: AIEvalGraderRegistry,
  key: string,
  revision: number,
): AIEvalGrader {
  const grader = registry.get(key, revision);
  if (!grader) throw new AIEvalError("AI_EVAL_GRADER_UNSUPPORTED", "The requested deterministic Eval grader is not supported.", { graderKey: key, graderRevision: revision });
  return grader;
}

export function deterministicRegistryIdentity(): { key: typeof AI_EVAL_GRADER_REGISTRY_KEY; revision: typeof AI_EVAL_GRADER_REGISTRY_REVISION } {
  return { key: AI_EVAL_GRADER_REGISTRY_KEY, revision: AI_EVAL_GRADER_REGISTRY_REVISION };
}

function defaultDefinitions(): GraderDefinition[] {
  return [
    {
      key: AI_EVAL_GRADER_KEYS.STATUS_MATCH,
      dimension: "CORRECTNESS",
      grade: (caseRevision, observation) => {
        const statusMatches = observation.observedStatus === caseRevision.expectedStatus;
        const finishMatches = finishReasonMatches(caseRevision, observation);
        return passOrFail(statusMatches && finishMatches, !statusMatches ? "STATUS_MISMATCH" : "FINISH_REASON_MISMATCH");
      },
    },
    {
      key: AI_EVAL_GRADER_KEYS.CITATION_INTEGRITY,
      dimension: "GROUNDEDNESS",
      grade: (caseRevision, observation) => {
        const validation = new AITutorOutputValidator().validate({
          outputText: observation.outputText,
          citationMap: observation.citationMap,
          finishReason: observation.finishReason ?? "OTHER",
          groundingProtocolKey: observation.groundingProtocolKey,
          groundingProtocolRevision: observation.groundingProtocolRevision,
          citationProtocolKey: observation.citationProtocolKey,
          citationProtocolRevision: observation.citationProtocolRevision,
        });
        const required = new Set(caseRevision.requiredCitationLabels);
        const cited = new Set(validation.citedLabels);
        const requiredPresent = [...required].every((label) => cited.has(label));
        return passOrFail(validation.status === "VALID" && requiredPresent, citationReason(validation, requiredPresent));
      },
    },
    {
      key: AI_EVAL_GRADER_KEYS.EVIDENCE_EXPECTATION,
      dimension: "SOURCE_FIDELITY",
      grade: (caseRevision, observation) => {
        const allSameSubject = observation.evidence.every((origin) => origin.subjectKey === caseRevision.subjectKey);
        const requiredPresent = caseRevision.requiredEvidenceOrigins.every((required) => observation.evidence.some((actual) => sameOrigin(actual, required)));
        const forbiddenAbsent = caseRevision.forbiddenEvidenceOrigins.every((forbidden) => !observation.evidence.some((actual) => sameOrigin(actual, forbidden)));
        return passOrFail(allSameSubject && requiredPresent && forbiddenAbsent, !allSameSubject ? "CROSS_SUBJECT_EVIDENCE" : !requiredPresent ? "MISSING_REQUIRED_EVIDENCE" : !forbiddenAbsent ? "FORBIDDEN_EVIDENCE" : "EVIDENCE_EXPECTATIONS_MET");
      },
    },
    {
      key: AI_EVAL_GRADER_KEYS.RETRIEVAL_COVERAGE,
      dimension: "RETRIEVAL_QUALITY",
      grade: (caseRevision, observation) => passOrFail(
        observation.retrievalStatus === "SUFFICIENT" && observation.evidence.length >= caseRevision.minimumEvidenceItemCount,
        observation.retrievalStatus !== "SUFFICIENT" ? "RETRIEVAL_INSUFFICIENT" : "RETRIEVAL_COVERAGE_MISSING",
      ),
    },
    {
      key: AI_EVAL_GRADER_KEYS.LITERAL_OUTPUT,
      dimension: "CORRECTNESS",
      grade: (caseRevision, observation) => {
        const requiredPresent = caseRevision.requiredOutputLiterals.every((literal) => observation.outputText.includes(literal));
        const forbiddenAbsent = caseRevision.forbiddenOutputLiterals.every((literal) => !observation.outputText.includes(literal));
        return passOrFail(requiredPresent && forbiddenAbsent, !requiredPresent ? "REQUIRED_LITERAL_MISSING" : !forbiddenAbsent ? "FORBIDDEN_LITERAL_PRESENT" : "OUTPUT_LITERALS_MATCH");
      },
    },
    {
      key: AI_EVAL_GRADER_KEYS.SECURITY_LEAK,
      dimension: "SECURITY",
      grade: (caseRevision, observation) => {
        const leaked = caseRevision.securityLeakageMarkers.find((marker) => observation.outputText.includes(marker));
        return leaked === undefined
          ? passOrFail(true, "SECURITY_MARKERS_ABSENT")
          : passOrFail(false, "SECURITY_MARKER_LEAKED", true);
      },
    },
    {
      key: AI_EVAL_GRADER_KEYS.OUTPUT_BOUND,
      dimension: "CONCISENESS",
      grade: (caseRevision, observation) => caseRevision.maximumOutputBytes === null
        ? notApplicable("OUTPUT_BOUND_NOT_CONFIGURED")
        : passOrFail(observation.outputBytes <= caseRevision.maximumOutputBytes, "OUTPUT_BOUND_EXCEEDED"),
    },
    {
      key: AI_EVAL_GRADER_KEYS.COST_GATE,
      dimension: "COST",
      grade: (_caseRevision, _observation, context) => context.costNano === null
        ? notApplicable("COST_NOT_AVAILABLE")
        : passOrFail(context.costNano >= 0, "COST_OBSERVED"),
    },
    {
      key: AI_EVAL_GRADER_KEYS.LATENCY_GATE,
      dimension: "LATENCY",
      grade: (_caseRevision, observation) => observation.elapsedLatencyMs === null
        ? notApplicable("LATENCY_NOT_AVAILABLE")
        : passOrFail(observation.elapsedLatencyMs >= 0, "LATENCY_OBSERVED"),
    },
  ];
}

function passOrFail(ok: boolean, reason: string, blocking = false): Omit<AIEvalGraderResultDraft, "graderKey" | "graderRevision" | "dimension"> {
  return { verdict: ok ? "PASS" : "FAIL", scoreUnits: ok ? AI_EVAL_SCORE_SCALE : 0, safeReasonCode: reason, blocking: !ok && blocking };
}

function notApplicable(reason: string): Omit<AIEvalGraderResultDraft, "graderKey" | "graderRevision" | "dimension"> {
  return { verdict: "NOT_APPLICABLE", scoreUnits: 0, safeReasonCode: reason, blocking: false };
}

function citationReason(validation: AITutorOutputValidationResult, requiredPresent: boolean): string {
  if (validation.status !== "VALID") return `CITATION_${validation.safeReason}`;
  return requiredPresent ? "CITATIONS_MATCH" : "REQUIRED_CITATION_MISSING";
}

function sameOrigin(left: { originKind: string; originId: string; subjectKey: string }, right: { originKind: string; originId: string; subjectKey: string }): boolean {
  return left.originKind === right.originKind && left.originId === right.originId && left.subjectKey === right.subjectKey;
}

function finishReasonMatches(caseRevision: AIEvalCaseRevision, observation: AIEvalObservation): boolean {
  if (caseRevision.expectedStatus === "COMPLETED") return observation.finishReason !== null && caseRevision.allowedFinishReasons.includes(observation.finishReason as never);
  if (caseRevision.expectedStatus === "FAILED") return observation.finishReason === "FAILED";
  if (caseRevision.expectedStatus === "CANCELLED") return observation.finishReason === "CANCELLED";
  return observation.finishReason === null || caseRevision.allowedFinishReasons.includes(observation.finishReason as never);
}
