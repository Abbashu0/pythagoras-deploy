import type { CanonicalRichDocument } from "../../questions/contracts";
import type { RichInline } from "../../question-packages/contracts";
import {
  AI_RETRIEVAL_MAX_CHUNK_BYTES,
  AI_RETRIEVAL_TARGET_CHUNK_BYTES,
  type AIChunkDraft,
  type AIChunkSourceItem,
  type AIChunkingStrategy,
} from "./contracts";

interface SemanticUnit {
  id: string;
  text: string;
}

interface UnitPiece {
  unitId: string;
  text: string;
  part: number;
  totalParts: number;
}

/** Deterministic RichDocument strategy; it never calls a provider or changes canonical content. */
export class StructuredRichDocumentChunkingStrategy implements AIChunkingStrategy {
  readonly key = "structured-rich-v1";
  readonly revision = 1;

  build(input: AIChunkSourceItem): AIChunkDraft[] {
    const pieces = extractSemanticUnits(input.content).flatMap((unit) => splitUnit(unit));
    const drafts: AIChunkDraft[] = [];
    let current: UnitPiece[] = [];
    let currentBytes = 0;
    const flush = (): void => {
      if (!current.length) return;
      drafts.push({
        text: current.map((piece) => piece.text).join("\n"),
        sourceUnitIds: [...new Set(current.map((piece) => piece.unitId))],
        sourceUnitParts: current.map(({ unitId, part, totalParts }) => ({ unitId, part, totalParts })),
      });
      current = [];
      currentBytes = 0;
    };

    for (const piece of pieces) {
      const separatorBytes = current.length ? Buffer.byteLength("\n", "utf8") : 0;
      const pieceBytes = Buffer.byteLength(piece.text, "utf8");
      if (current.length && currentBytes + separatorBytes + pieceBytes > AI_RETRIEVAL_TARGET_CHUNK_BYTES) flush();
      current.push(piece);
      currentBytes += (current.length > 1 ? separatorBytes : 0) + pieceBytes;
      if (pieceBytes >= AI_RETRIEVAL_TARGET_CHUNK_BYTES) flush();
    }
    flush();
    return drafts;
  }
}

export function createStructuredRichDocumentChunkingStrategy(): AIChunkingStrategy {
  return new StructuredRichDocumentChunkingStrategy();
}

function extractSemanticUnits(document: CanonicalRichDocument): SemanticUnit[] {
  const units: SemanticUnit[] = [];
  const headings: Array<string | undefined> = [];
  const context = (): string => headings.filter((value): value is string => Boolean(value)).join(" / ");
  const add = (id: string, text: string): void => {
    const normalized = text.replace(/\s+/gu, " ").trim();
    if (!normalized) return;
    const prefix = context();
    units.push({ id, text: prefix ? `${prefix}\n${normalized}` : normalized });
  };

  for (const block of document.blocks) {
    switch (block.type) {
      case "paragraph":
        add(block.id, inlineText(block.spans));
        break;
      case "heading": {
        add(block.id, inlineText(block.spans));
        headings[block.level - 2] = inlineText(block.spans).trim();
        headings.splice(block.level - 1);
        break;
      }
      case "ordered-list":
      case "bullet-list":
        block.items.forEach((item, index) => add(`${block.id}:item:${index + 1}`, `${block.type === "ordered-list" ? `${index + 1}.` : "•"} ${inlineText(item.spans)}`));
        break;
      case "quran":
        block.verses.forEach((verse, index) => {
          const locator = [verse.surah, verse.ayah === undefined ? undefined : String(verse.ayah)].filter(Boolean).join(":");
          add(`${block.id}:verse:${verse.id || index + 1}`, `${locator ? `${locator} ` : ""}${inlineText(verse.spans)}`);
        });
        break;
      case "poetry":
        block.verses.forEach((verse, index) => add(`${block.id}:verse:${verse.id || index + 1}`, `${inlineText(verse.sadr)} — ${inlineText(verse.ajuz)}`));
        break;
      case "table":
        block.rows.forEach((row, index) => add(`${block.id}:row:${index + 1}`, row.cells.map((cell) => inlineText(cell.spans)).join(" | ")));
        break;
      case "image":
        add(block.id, [block.alt, block.caption ? inlineText(block.caption) : undefined].filter(Boolean).join(" — ") || "image");
        break;
      case "divider":
        add(block.id, "—");
        break;
    }
  }
  return units;
}

function splitUnit(unit: SemanticUnit): UnitPiece[] {
  if (Buffer.byteLength(unit.text, "utf8") <= AI_RETRIEVAL_MAX_CHUNK_BYTES) return [{ unitId: unit.id, text: unit.text, part: 1, totalParts: 1 }];
  const chars = Array.from(unit.text);
  const pieces: string[] = [];
  let start = 0;
  while (start < chars.length) {
    let end = start;
    let bytes = 0;
    while (end < chars.length) {
      const nextBytes = Buffer.byteLength(chars[end], "utf8");
      if (bytes + nextBytes > AI_RETRIEVAL_MAX_CHUNK_BYTES) break;
      bytes += nextBytes;
      end += 1;
    }
    if (end === start) end += 1;
    const boundary = findBoundary(chars, start, end);
    const actualEnd = boundary > start ? boundary : end;
    pieces.push(chars.slice(start, actualEnd).join(""));
    start = actualEnd;
  }
  return pieces.map((text, index) => ({ unitId: unit.id, text, part: index + 1, totalParts: pieces.length }));
}

function findBoundary(chars: string[], start: number, end: number): number {
  for (let index = end - 1; index > start; index -= 1) {
    if (/[\s.!?؟؛:،,。]/u.test(chars[index])) return index + 1;
  }
  return 0;
}

function inlineText(spans: RichInline): string {
  return spans.map((span) => span.text).join("");
}
