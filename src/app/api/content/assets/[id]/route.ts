import type { NextRequest } from "next/server";
import { getAssetService } from "@/server/assets";
import { getCanonicalContentRepository } from "@/server/canonical-content";
import { getMaterialQuestionBankService } from "@/server/material-question-bank";

export const runtime = "nodejs";
const SAFE_INLINE = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const visibleFromAppContent = getCanonicalContentRepository().isStudentVisibleAsset(id);
    const visibleFromQuestionBank = getMaterialQuestionBankService().isPublicAssetVisible(id);
    if (!visibleFromAppContent && !visibleFromQuestionBank) return new Response(null, { status: 404 });
    const { asset, body } = await getAssetService().openContent(id);
    if (!SAFE_INLINE.has(asset.mimeType)) return new Response(null, { status: 404 });
    return new Response(body, { status: 200, headers: {
      "Cache-Control": "public, max-age=3600, immutable",
      "Content-Disposition": "inline",
      "Content-Length": String(asset.byteSize),
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Type": asset.mimeType,
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch { return new Response(null, { status: 404 }); }
}
