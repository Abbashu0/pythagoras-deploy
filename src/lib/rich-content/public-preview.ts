import type { CanonicalRichDocument } from "@/server/questions/contracts";
import type { PublicRichContentBlock, PublicRichDocument } from "./contracts";

const DEFAULT_PREVIEW_CHARACTERS = 360;

/**
 * Creates the small public projection used by collapsed Student Question
 * Cards. It deliberately omits images and tables; Detail remains the source
 * of truth for the complete RichDocument.
 */
export function toPublicRichPreview(
  document: CanonicalRichDocument,
  maxCharacters = DEFAULT_PREVIEW_CHARACTERS,
): PublicRichDocument {
  let remaining = Math.max(1, Math.trunc(maxCharacters));
  const blocks: PublicRichContentBlock[] = [];

  for (const block of document.blocks) {
    if (remaining <= 0) break;
    const preview = previewBlock(block, remaining);
    if (!preview) continue;
    blocks.push(preview.block);
    remaining -= preview.characters;
  }

  return { type: "doc", version: 1, blocks };
}

function previewBlock(
  block: CanonicalRichDocument["blocks"][number],
  remaining: number,
): { block: PublicRichContentBlock; characters: number } | null {
  switch (block.type) {
    case "paragraph":
    case "heading": {
      const spans = sliceInline(block.spans, remaining);
      return spans.characters
        ? { block: { ...block, spans: spans.spans }, characters: spans.characters }
        : null;
    }
    case "ordered-list":
    case "bullet-list": {
      let budget = remaining;
      const items: { spans: typeof block.items[number]["spans"] }[] = [];
      for (const item of block.items) {
        const spans = sliceInline(item.spans, budget);
        if (!spans.characters) break;
        items.push({ spans: spans.spans });
        budget -= spans.characters;
      }
      return items.length
        ? { block: { ...block, items }, characters: remaining - budget }
        : null;
    }
    case "quran": {
      let budget = remaining;
      const verses: typeof block.verses = [];
      for (const verse of block.verses) {
        const spans = sliceInline(verse.spans, budget);
        if (!spans.characters) break;
        verses.push({ ...verse, spans: spans.spans });
        budget -= spans.characters;
      }
      return verses.length
        ? { block: { ...block, verses }, characters: remaining - budget }
        : null;
    }
    case "poetry": {
      let budget = remaining;
      const verses: typeof block.verses = [];
      for (const verse of block.verses) {
        const sadr = sliceInline(verse.sadr, budget);
        budget -= sadr.characters;
        const ajuz = sliceInline(verse.ajuz, budget);
        budget -= ajuz.characters;
        if (!sadr.characters && !ajuz.characters) break;
        verses.push({ ...verse, sadr: sadr.spans, ajuz: ajuz.spans });
      }
      return verses.length
        ? { block: { ...block, verses }, characters: remaining - budget }
        : null;
    }
    case "table":
    case "image":
    case "divider":
      return null;
  }
}

function sliceInline(
  spans: { text: string; marks?: ("bold" | "italic" | "underline")[] }[],
  maxCharacters: number,
) {
  let remaining = Math.max(0, maxCharacters);
  let characters = 0;
  const result: typeof spans = [];

  for (const span of spans) {
    if (remaining <= 0) break;
    const text = Array.from(span.text).slice(0, remaining).join("");
    if (!text) continue;
    result.push({ ...span, text });
    const length = Array.from(text).length;
    characters += length;
    remaining -= length;
  }

  return { spans: result, characters };
}
