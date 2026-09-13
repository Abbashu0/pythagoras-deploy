import type { NextRequest } from "next/server";
import { getAssetService } from "@/server/assets";
import { localApiError, requireLocalAdminRead } from "../../../_shared";

export const runtime = "nodejs";

const SAFE_INLINE_TYPES = new Set([
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
    requireLocalAdminRead(request);
    const { asset, body } = await getAssetService().openContent((await context.params).id);
    const forceDownload = request.nextUrl.searchParams.get("download") === "1";
    const inline = !forceDownload && SAFE_INLINE_TYPES.has(asset.mimeType);
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
    const response = localApiError(error);
    return response;
  }
}
