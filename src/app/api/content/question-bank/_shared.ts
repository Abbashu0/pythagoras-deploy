import { NextResponse } from "next/server";
import { isMaterialQuestionBankError } from "@/server/material-question-bank";

export function publicQuestionBankJson(body: Record<string, unknown>, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export function publicQuestionBankError(error: unknown) {
  if (isMaterialQuestionBankError(error)) {
    return publicQuestionBankJson({ ok: false, code: error.code }, error.code === "MATERIAL_BANK_NOT_FOUND" ? 404 : 400);
  }
  console.error("[public-question-bank] request failed", "UNEXPECTED_ERROR");
  return publicQuestionBankJson({ ok: false, code: "QUESTION_BANK_UNAVAILABLE" }, 503);
}

export function integerQuery(value: string | null, fallback: number): number {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}
