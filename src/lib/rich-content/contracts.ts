import type { RichInline } from "@/server/question-packages/contracts";
import type { CanonicalRichDocument } from "@/server/questions/contracts";

export const RICH_CONTENT_BLOCK_TYPES = [
  "paragraph",
  "heading",
  "ordered-list",
  "bullet-list",
  "quran",
  "poetry",
  "table",
  "image",
  "divider",
] as const;

export type RichContentBlockType = (typeof RICH_CONTENT_BLOCK_TYPES)[number];

type CanonicalNonImageBlock = Exclude<
  CanonicalRichDocument["blocks"][number],
  { type: "image" }
>;

export interface PublicRichContentImageBlock {
  id: string;
  type: "image";
  src: string;
  alt: string;
  caption?: RichInline;
}

/**
 * Presentation-safe RichDocument sent to a renderer. Portable assetRef and
 * canonical assetId are deliberately absent; images contain only a resolved URL.
 */
export interface PublicRichDocument {
  type: "doc";
  version: 1;
  blocks: Array<CanonicalNonImageBlock | PublicRichContentImageBlock>;
}

export type PublicRichContentBlock = PublicRichDocument["blocks"][number];
export type RichContentAssetUrlResolver = (assetId: string) => string;

export class RichContentPresentationError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "RichContentPresentationError";
  }
}
