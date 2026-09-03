import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_TUTOR_CITATION_PROTOCOL_KEY,
  AI_TUTOR_CITATION_PROTOCOL_REVISION,
  AI_TUTOR_GROUNDING_PROTOCOL_KEY,
  AI_TUTOR_GROUNDING_PROTOCOL_REVISION,
  AITutorOutputValidator,
  type AITutorCitationMapItem,
} from "../src/server/ai/tutor";

const validator = new AITutorOutputValidator();

function citationMap(...ordinals: number[]): AITutorCitationMapItem[] {
  return ordinals.map((ordinal) => ({
    label: `[E${ordinal}]`,
    ordinal,
    chunkId: `chunk-${ordinal}`,
    m7aProjectionRevisionId: `m7a-${ordinal}`,
    m7bEmbeddingProjectionRevisionId: `m7b-${ordinal}`,
    originKind: "KNOWLEDGE_PACKAGE",
    originId: `origin-${ordinal}`,
    questionId: null,
    questionRevision: null,
  }));
}

function input(outputText: string, finishReason: "STOP" | "LENGTH" | "CONTENT_FILTER" | "OTHER" = "STOP", map = citationMap(1, 2)) {
  return {
    outputText,
    citationMap: map,
    finishReason,
    groundingProtocolKey: AI_TUTOR_GROUNDING_PROTOCOL_KEY,
    groundingProtocolRevision: AI_TUTOR_GROUNDING_PROTOCOL_REVISION,
    citationProtocolKey: AI_TUTOR_CITATION_PROTOCOL_KEY,
    citationProtocolRevision: AI_TUTOR_CITATION_PROTOCOL_REVISION,
  } as const;
}

test("M8C validator accepts valid, repeated, and subset citations", () => {
  const multiple = validator.validate(input("الميتوكوندريا [E1] وتفاصيلها [E2]"));
  assert.deepEqual(multiple, { status: "VALID", safeReason: "VALID", citationCount: 2, uniqueCitationCount: 2, citedLabels: ["[E1]", "[E2]"] });
  const repeated = validator.validate(input("شرح [E1] ثم إعادة [E1]"));
  assert.deepEqual(repeated, { status: "VALID", safeReason: "VALID", citationCount: 2, uniqueCitationCount: 1, citedLabels: ["[E1]"] });
  const subset = validator.validate(input("شرح مختصر [E1]"));
  assert.equal(subset.status, "VALID");
});

test("M8C validator rejects unknown and malformed Evidence references", () => {
  for (const outputText of ["إجابة [E99]", "إجابة [E01]", "إجابة [e1]", "إجابة [E1", "إجابة E1]"]) {
    const result = validator.validate(input(outputText));
    assert.equal(result.status, "INVALID", outputText);
    assert.ok(["MALFORMED_CITATION", "UNKNOWN_CITATION"].includes(result.safeReason));
  }
});

test("M8C validator requires non-empty cited output for ordinary finish reasons", () => {
  for (const finishReason of ["STOP", "LENGTH", "OTHER"] as const) {
    assert.equal(validator.validate(input("", finishReason)).safeReason, "EMPTY_OUTPUT");
    assert.equal(validator.validate(input("إجابة بلا مرجع", finishReason)).safeReason, "MISSING_CITATION");
  }
  assert.equal(validator.validate(input("إجابة مبتورة [E1]", "LENGTH")).status, "VALID");
  assert.equal(validator.validate(input("إجابة مبتورة [E1", "LENGTH")).safeReason, "MALFORMED_CITATION");
});

test("M8C validator allows empty CONTENT_FILTER but validates references when present", () => {
  assert.equal(validator.validate(input("", "CONTENT_FILTER")).status, "VALID");
  assert.equal(validator.validate(input("تم إيقاف الإخراج", "CONTENT_FILTER")).status, "VALID");
  assert.equal(validator.validate(input("[E99]", "CONTENT_FILTER")).safeReason, "UNKNOWN_CITATION");
});

test("M8C validator does not rewrite output and exposes only bounded safe metadata", () => {
  const outputText = "إجابة [E1]";
  const result = validator.validate(input(outputText));
  assert.equal(outputText, "إجابة [E1]");
  assert.deepEqual(Object.keys(result).sort(), ["citationCount", "citedLabels", "safeReason", "status", "uniqueCitationCount"]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.citedLabels), true);
});

test("M8C validator fails closed for unsupported protocols and invalid citation maps", () => {
  assert.equal(validator.validate({ ...input("إجابة [E1]"), citationProtocolRevision: 2 }).safeReason, "UNSUPPORTED_PROTOCOL");
  assert.equal(validator.validate({ ...input("إجابة [E1]"), citationMap: [{ ...citationMap(1)[0]!, label: "[E01]" }] }).safeReason, "INVALID_CITATION_MAP");
});
