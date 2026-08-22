import type { NextRequest } from "next/server";
import { getAssetService } from "@/server/assets";
import { assetApiErrorResponse, requireAssetApiAdmin } from "../../_shared";

export const runtime = "nodejs";

const SAFE_INLINE_IMAGE_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function contentDisposition(filename: string, inline: boolean): string {
  return `${inline ? "inline" : "attachment"}; filename="asset"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    requireAssetApiAdmin(request);
    const { id } = await context.params;
    const { asset, body } = await getAssetService().openContent(id);
    const inline = SAFE_INLINE_IMAGE_TYPES.has(asset.mimeType);
    return new Response(body, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": contentDisposition(asset.originalFilename, inline),
        "Content-Length": String(asset.byteSize),
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Type": asset.mimeType,
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return assetApiErrorResponse(error);
  }
}
