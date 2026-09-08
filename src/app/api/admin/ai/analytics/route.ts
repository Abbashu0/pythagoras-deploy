import type { NextRequest } from "next/server";
import { AIDeidentifiedAnalyticsReadService } from "@/server/ai/telemetry";
import { getContentDatabase } from "@/server/content";
import { aiApiError, aiJson, requireAIAdmin } from "../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeTimestamp(value: string | null, fallback: number): number {
  if (value === null || !/^\d+$/u.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  try {
    requireAIAdmin(request);
    const now = Date.now();
    const to = safeTimestamp(request.nextUrl.searchParams.get("to"), now + 1);
    const from = safeTimestamp(request.nextUrl.searchParams.get("from"), Math.max(0, to - 30 * 86_400_000));
    const bucket = request.nextUrl.searchParams.get("bucket") ?? "day";
    const subjectKey = request.nextUrl.searchParams.get("subjectKey") ?? undefined;
    const analytics = new AIDeidentifiedAnalyticsReadService(getContentDatabase());
    if (bucket !== "day" && bucket !== "week" && bucket !== "month") return aiJson({ ok: false, code: "AI_TELEMETRY_RANGE_INVALID" }, { status: 400 });
    return aiJson({ ok: true, analytics: { overview: analytics.overview({ from, to, subjectKey }), timeSeries: analytics.timeSeries({ from, to, subjectKey }, bucket), subjectBreakdown: analytics.subjectBreakdown({ from, to, subjectKey }), modelProviderBreakdown: analytics.modelProviderBreakdown({ from, to, subjectKey }), failureBreakdown: analytics.failureBreakdown({ from, to, subjectKey }) }, refreshedAt: now });
  } catch (error) { return aiApiError(error); }
}
