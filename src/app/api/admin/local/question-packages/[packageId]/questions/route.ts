import type { NextRequest } from "next/server";
import { AdminValidationError, getLocalAdminActor } from "@/server/admin-auth";
import { getContentDatabase } from "@/server/content";
import { getDirectQuestionEditorService } from "@/server/question-editor";
import { QUESTION_SOURCE_KINDS, type QuestionSourceKind } from "@/server/questions";
import {
  localApiError,
  localJson,
  readLocalJsonBody,
  requireLocalAdminMutation,
  requireLocalAdminRead,
} from "../../../_shared";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ packageId: string }> },
) {
  try {
    requireLocalAdminRead(request);
    const database = getContentDatabase();
    const search = request.nextUrl.searchParams;
    const options = {
      offset: queryInteger(search.get("offset"), "offset", 0),
      limit: queryInteger(search.get("limit"), "limit", 50),
      query: search.get("query") ?? "",
      taxonomyNodeId: search.get("taxonomyNodeId") ?? undefined,
      sourceKind: querySourceKind(search.get("sourceKind")),
      year: queryOptionalInteger(search.get("year"), "year"),
      hasAnswer: queryBoolean(search.get("hasAnswer"), "hasAnswer"),
      variantCount: queryEnum(search.get("variantCount"), ["ONE", "MULTIPLE"] as const, "variantCount"),
      occurrenceState: queryEnum(search.get("occurrenceState"), ["HAS", "NONE"] as const, "occurrenceState"),
    };
    const result = getDirectQuestionEditorService().listQuestions(
      (await context.params).packageId,
      getLocalAdminActor(database),
      options,
    );
    return localJson({ ok: true, ...result });
  } catch (error) {
    return localApiError(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ packageId: string }> },
) {
  try {
    const actor = requireLocalAdminMutation(request);
    const body = await readLocalJsonBody(request);
    if (Object.keys(body).some((key) => !["questionId", "content"].includes(key))) {
      throw new AdminValidationError("Question create contains unsupported fields.");
    }
    if (!("questionId" in body) || !("content" in body)) {
      throw new AdminValidationError("Question ID and content are required.");
    }
    const question = getDirectQuestionEditorService().createQuestion(
      (await context.params).packageId,
      body.questionId,
      body.content,
      actor,
    );
    return localJson({ ok: true, question });
  } catch (error) {
    return localApiError(error);
  }
}

function queryInteger(value: string | null, label: string, fallback: number): number {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new AdminValidationError(`${label} is invalid.`);
  return parsed;
}

function queryOptionalInteger(value: string | null, label: string): number | undefined {
  if (value === null || value === "") return undefined;
  return queryInteger(value, label, 0);
}

function queryBoolean(value: string | null, label: string): boolean | undefined {
  if (value === null || value === "") return undefined;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  throw new AdminValidationError(`${label} is invalid.`);
}

function querySourceKind(value: string | null): QuestionSourceKind | undefined {
  if (value === null || value === "") return undefined;
  if (!QUESTION_SOURCE_KINDS.includes(value as QuestionSourceKind)) throw new AdminValidationError("sourceKind is invalid.");
  return value as QuestionSourceKind;
}

function queryEnum<T extends readonly string[]>(value: string | null, allowed: T, label: string): T[number] | undefined {
  if (value === null || value === "") return undefined;
  if (!allowed.includes(value)) throw new AdminValidationError(`${label} is invalid.`);
  return value;
}
