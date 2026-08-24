import { assertCanonicalRichDocument } from "@/server/questions/canonical-rich-document";
import type { CanonicalRichDocument } from "@/server/questions/contracts";
import { assertSafePresentationAssetUrl } from "./asset-urls";
import {
  RichContentPresentationError,
  type PublicRichDocument,
  type RichContentAssetUrlResolver,
} from "./contracts";

/**
 * Converts canonical database content into renderer-safe presentation data.
 * This is intentionally pure apart from the injected URL resolver.
 */
export function toPublicRichDocument(
  document: CanonicalRichDocument,
  resolveAssetUrl: RichContentAssetUrlResolver,
): PublicRichDocument {
  try {
    assertCanonicalRichDocument(document);
    return {
      type: "doc",
      version: 1,
      blocks: document.blocks.map((block) => {
        if (block.type !== "image") return structuredClone(block);
        return {
          id: block.id,
          type: "image" as const,
          src: assertSafePresentationAssetUrl(resolveAssetUrl(block.assetId)),
          alt: block.alt,
          ...(block.caption
            ? { caption: structuredClone(block.caption) }
            : {}),
        };
      }),
    };
  } catch (error) {
    if (error instanceof RichContentPresentationError) throw error;
    throw new RichContentPresentationError(
      "Canonical RichDocument could not be prepared for presentation.",
      error,
    );
  }
}
