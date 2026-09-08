import type { NextRequest } from "next/server";
import { AIProviderConnectionError, getAIProviderConnectionTester } from "@/server/ai/provider-connection";
import { aiApiError, aiJson, requireAIAdmin } from "../../../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ providerId: string }> }) {
  try {
    requireAIAdmin(request);
    const { providerId } = await context.params;
    return aiJson({ ok: true, result: await getAIProviderConnectionTester().test(providerId) });
  } catch (error) {
    if (error instanceof AIProviderConnectionError && error.code === "PROVIDER_NOT_FOUND") return aiJson({ ok: false, code: error.code }, { status: 404 });
    return aiApiError(error);
  }
}
