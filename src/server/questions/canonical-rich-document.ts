import type { RichDocument, RichInline } from "../question-packages/contracts";
import type { CanonicalRichDocument } from "./contracts";
import { QuestionDomainError } from "./errors";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MARKS = new Set(["bold", "italic", "underline"]);

export function toCanonicalRichDocument(
  document: RichDocument,
  resolveAssetRef: (assetRef: string) => string,
): CanonicalRichDocument {
  const canonical: CanonicalRichDocument = {
    type: "doc",
    version: 1,
    blocks: document.blocks.map((block) => {
      if (block.type === "image") {
        return {
          id: block.id,
          type: "image" as const,
          assetId: resolveAssetRef(block.assetRef),
          alt: block.alt,
          ...(block.caption ? { caption: structuredClone(block.caption) } : {}),
        };
      }
      return structuredClone(block);
    }),
  };
  assertCanonicalRichDocument(canonical, true);
  return canonical;
}

export function assertCanonicalRichDocument(
  value: unknown,
  requireMeaningful = false,
): asserts value is CanonicalRichDocument {
  if (!isRecord(value) || value.type !== "doc" || value.version !== 1) {
    invalid("Canonical RichDocument marker is invalid.");
  }
  if (!Array.isArray(value.blocks) || value.blocks.length > 10_000) {
    invalid("Canonical RichDocument blocks are invalid.");
  }

  const blockIds = new Set<string>();
  for (const candidate of value.blocks) {
    if (!isRecord(candidate) || !isUuid(candidate.id) || typeof candidate.type !== "string") {
      invalid("Canonical RichDocument block identity is invalid.");
    }
    if (blockIds.has(candidate.id)) invalid("Canonical RichDocument block IDs must be unique.");
    blockIds.add(candidate.id);

    switch (candidate.type) {
      case "paragraph":
        assertOnlyKeys(candidate, ["id", "type", "spans"]);
        assertInline(candidate.spans);
        break;
      case "heading":
        assertOnlyKeys(candidate, ["id", "type", "level", "spans"]);
        if (![2, 3, 4].includes(Number(candidate.level))) invalid("Heading level is invalid.");
        assertInline(candidate.spans);
        break;
      case "ordered-list":
      case "bullet-list":
        assertOnlyKeys(candidate, ["id", "type", "items"]);
        if (!Array.isArray(candidate.items) || candidate.items.length > 10_000) {
          invalid("List items are invalid.");
        }
        candidate.items.forEach((item) => {
          if (!isRecord(item)) invalid("List item is invalid.");
          assertOnlyKeys(item, ["spans"]);
          assertInline(item.spans);
        });
        break;
      case "quran":
        assertOnlyKeys(candidate, ["id", "type", "verses"]);
        assertVerses(candidate.verses, (verse) => {
          assertOnlyKeys(verse, ["id", "spans", "surah", "ayah"]);
          assertInline(verse.spans);
          if (verse.surah !== undefined && typeof verse.surah !== "string") invalid("Quran surah metadata is invalid.");
          if (verse.ayah !== undefined && (!Number.isInteger(verse.ayah) || Number(verse.ayah) < 1)) invalid("Quran ayah metadata is invalid.");
        });
        break;
      case "poetry":
        assertOnlyKeys(candidate, ["id", "type", "verses"]);
        assertVerses(candidate.verses, (verse) => {
          assertOnlyKeys(verse, ["id", "sadr", "ajuz"]);
          assertInline(verse.sadr);
          assertInline(verse.ajuz);
        });
        break;
      case "table":
        assertOnlyKeys(candidate, ["id", "type", "headerRowCount", "caption", "columnAlignments", "displayMode", "rows"]);
        if (!Number.isInteger(candidate.headerRowCount) || Number(candidate.headerRowCount) < 0) invalid("Table headerRowCount is invalid.");
        if (candidate.caption !== undefined) assertInline(candidate.caption);
        if (candidate.columnAlignments !== undefined) {
          if (!Array.isArray(candidate.columnAlignments) || candidate.columnAlignments.some((alignment) => !["start", "center", "end"].includes(String(alignment)))) invalid("Table column alignment is invalid.");
        }
        if (candidate.displayMode !== undefined && !["standard", "compact"].includes(String(candidate.displayMode))) invalid("Table display mode is invalid.");
        if (!Array.isArray(candidate.rows) || Number(candidate.headerRowCount) > candidate.rows.length) invalid("Table rows are invalid.");
        candidate.rows.forEach((row) => {
          if (!isRecord(row)) invalid("Table row is invalid.");
          assertOnlyKeys(row, ["cells"]);
          if (!Array.isArray(row.cells)) invalid("Table cells are invalid.");
          row.cells.forEach((cell) => {
            if (!isRecord(cell)) invalid("Table cell is invalid.");
            assertOnlyKeys(cell, ["spans"]);
            assertInline(cell.spans);
          });
        });
        break;
      case "image":
        assertOnlyKeys(candidate, ["id", "type", "assetId", "alt", "caption"]);
        if (!isUuid(candidate.assetId) || typeof candidate.alt !== "string") invalid("Canonical image reference is invalid.");
        if (candidate.caption !== undefined) assertInline(candidate.caption);
        break;
      case "divider":
        assertOnlyKeys(candidate, ["id", "type"]);
        break;
      default:
        invalid("Canonical RichDocument block type is invalid.");
    }
  }

  if (requireMeaningful && !isMeaningfulCanonicalRichDocument(value as CanonicalRichDocument)) {
    invalid("Canonical Question Variant content must be meaningful.");
  }
}

export function isMeaningfulCanonicalRichDocument(
  document: CanonicalRichDocument,
): boolean {
  return document.blocks.some((block) => {
    switch (block.type) {
      case "paragraph":
      case "heading":
        return meaningfulInline(block.spans);
      case "ordered-list":
      case "bullet-list":
        return block.items.some((item) => meaningfulInline(item.spans));
      case "quran":
        return block.verses.some((verse) => meaningfulInline(verse.spans));
      case "poetry":
        return block.verses.some(
          (verse) => meaningfulInline(verse.sadr) || meaningfulInline(verse.ajuz),
        );
      case "table":
        return (
          (block.caption ? meaningfulInline(block.caption) : false) ||
          block.rows.some((row) =>
            row.cells.some((cell) => meaningfulInline(cell.spans)),
          )
        );
      case "image":
        return true;
      case "divider":
        return false;
    }
  });
}

function assertVerses(
  value: unknown,
  validate: (verse: Record<string, unknown>) => void,
): void {
  if (!Array.isArray(value) || value.length > 10_000) invalid("Verse collection is invalid.");
  const ids = new Set<string>();
  value.forEach((verse) => {
    if (!isRecord(verse) || !isUuid(verse.id) || ids.has(verse.id)) invalid("Verse identity is invalid or duplicated.");
    ids.add(verse.id);
    validate(verse);
  });
}

function assertInline(value: unknown): asserts value is RichInline {
  if (!Array.isArray(value) || value.length > 10_000) invalid("RichInline is invalid.");
  value.forEach((span) => {
    if (!isRecord(span) || typeof span.text !== "string" || span.text.length > 100_000) invalid("Rich text span is invalid.");
    assertOnlyKeys(span, ["text", "marks"]);
    if (span.marks !== undefined) {
      if (!Array.isArray(span.marks) || new Set(span.marks).size !== span.marks.length || span.marks.some((mark) => typeof mark !== "string" || !MARKS.has(mark))) invalid("Rich text marks are invalid.");
    }
  });
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: string[]): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    invalid("Canonical RichDocument contains an unsupported field.");
  }
}

function meaningfulInline(inline: RichInline): boolean {
  return inline.some((span) => span.text.trim().length > 0);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
  throw new QuestionDomainError("QUESTION_DOMAIN_VALIDATION_FAILED", message);
}
