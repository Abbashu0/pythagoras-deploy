import type { CanonicalRichDocument } from "@/server/questions";

/**
 * Deterministic, presentation-neutral text projection for previews and search.
 * It never changes canonical RichDocument content.
 */
export function extractRichDocumentPlainText(document: CanonicalRichDocument | null | undefined): string {
  if (!document) return "";
  const inline = (spans: ReadonlyArray<{ text: string }>) => spans.map((span) => span.text).join("");
  const parts: string[] = [];
  for (const block of document.blocks) {
    switch (block.type) {
      case "paragraph":
      case "heading": parts.push(inline(block.spans)); break;
      case "ordered-list":
      case "bullet-list": parts.push(...block.items.map((item) => inline(item.spans))); break;
      case "quran": parts.push(...block.verses.map((verse) => inline(verse.spans))); break;
      case "poetry": parts.push(...block.verses.map((verse) => `${inline(verse.sadr)} ${inline(verse.ajuz)}`)); break;
      case "table":
        if (block.caption) parts.push(inline(block.caption));
        parts.push(...block.rows.flatMap((row) => row.cells.map((cell) => inline(cell.spans))));
        break;
      case "image":
        parts.push(block.alt);
        if (block.caption) parts.push(inline(block.caption));
        break;
      case "divider": break;
    }
  }
  return parts.join(" ").replace(/\s+/gu, " ").trim();
}
