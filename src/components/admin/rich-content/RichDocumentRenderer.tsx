import { Fragment, type ReactNode } from "react";
import type { RichInline } from "@/server/question-packages/contracts";
import type { CanonicalRichDocument } from "@/server/questions/contracts";
import {
  toPublicRichDocument,
  type PublicRichContentBlock,
  type PublicRichDocument,
  type RichContentAssetUrlResolver,
} from "@/lib/rich-content";

export interface RichDocumentRendererProps {
  document: CanonicalRichDocument;
  resolveAssetUrl: RichContentAssetUrlResolver;
  className?: string;
  fallbackLabel?: string;
}

export interface PublicRichDocumentRendererProps {
  document: PublicRichDocument;
  className?: string;
  fallbackLabel?: string;
}

export function RichDocumentRenderer({
  document,
  resolveAssetUrl,
  className,
  fallbackLabel,
}: RichDocumentRendererProps) {
  let presentation: PublicRichDocument;
  try {
    presentation = toPublicRichDocument(document, resolveAssetUrl);
  } catch {
    return <RichContentFallback label={fallbackLabel} />;
  }

  return (
    <PublicRichDocumentRenderer
      document={presentation}
      className={className}
      fallbackLabel={fallbackLabel}
    />
  );
}

export function PublicRichDocumentRenderer({
  document,
  className,
  fallbackLabel,
}: PublicRichDocumentRendererProps) {
  let renderedBlocks: ReactNode;
  try {
    if (document.type !== "doc" || document.version !== 1) {
      throw new Error("Unsupported presentation document.");
    }
    renderedBlocks = document.blocks.map((block) => renderBlock(block));
  } catch {
    return <RichContentFallback label={fallbackLabel} />;
  }

  return (
    <article
      className={["admin-rich-content", className].filter(Boolean).join(" ")}
      dir="rtl"
      data-rich-document="public-v1"
    >
      {renderedBlocks}
    </article>
  );
}

function renderBlock(block: PublicRichContentBlock): ReactNode {
  switch (block.type) {
    case "paragraph":
      return <p key={block.id} className="admin-rich-content__paragraph">{renderInline(block.spans)}</p>;
    case "heading": {
      const className = `admin-rich-content__heading admin-rich-content__heading--${block.level}`;
      if (block.level === 2) return <h2 key={block.id} className={className}>{renderInline(block.spans)}</h2>;
      if (block.level === 3) return <h3 key={block.id} className={className}>{renderInline(block.spans)}</h3>;
      return <h4 key={block.id} className={className}>{renderInline(block.spans)}</h4>;
    }
    case "ordered-list":
    case "bullet-list": {
      const Tag = block.type === "ordered-list" ? "ol" : "ul";
      return (
        <Tag key={block.id} className="admin-rich-content__list">
          {block.items.map((item, index) => <li key={index}>{renderInline(item.spans)}</li>)}
        </Tag>
      );
    }
    case "quran":
      return (
        <section key={block.id} className="admin-rich-content__quran" aria-label="نص قرآني">
          {block.verses.map((verse) => (
            <div key={verse.id} className="admin-rich-content__quran-verse">
              <p className="admin-rich-content__quran-text">{renderInline(verse.spans)}</p>
              {verse.surah || verse.ayah ? (
                <cite className="admin-rich-content__quran-meta">{formatQuranReference(verse.surah, verse.ayah)}</cite>
              ) : null}
            </div>
          ))}
        </section>
      );
    case "poetry":
      return (
        <section key={block.id} className="admin-rich-content__poetry" aria-label="نص شعري">
          {block.verses.map((verse) => (
            <div key={verse.id} className="admin-rich-content__poetry-verse">
              <p className="admin-rich-content__hemistich">{renderInline(verse.sadr)}</p>
              <span className="admin-rich-content__poetry-separator" aria-hidden="true">•</span>
              <p className="admin-rich-content__hemistich">{renderInline(verse.ajuz)}</p>
            </div>
          ))}
        </section>
      );
    case "table": {
      const headerRows = block.rows.slice(0, block.headerRowCount);
      const bodyRows = block.rows.slice(block.headerRowCount);
      return (
        <div key={block.id} className="admin-rich-content__table-region" role="region" aria-label="جدول محتوى" tabIndex={0}>
          <table className={`admin-rich-content__table ${block.displayMode === "compact" ? "admin-rich-content__table--compact" : ""}`}>
            {block.caption ? <caption className="admin-rich-content__caption">{renderInline(block.caption)}</caption> : null}
            {headerRows.length ? <thead>{renderRows(headerRows, true, block.columnAlignments)}</thead> : null}
            {bodyRows.length ? <tbody>{renderRows(bodyRows, false, block.columnAlignments)}</tbody> : null}
          </table>
        </div>
      );
    }
    case "image":
      return (
        <figure key={block.id} className="admin-rich-content__figure">
          <img className="admin-rich-content__image" src={block.src} alt={block.alt} loading="lazy" decoding="async" />
          {block.caption ? <figcaption className="admin-rich-content__caption">{renderInline(block.caption)}</figcaption> : null}
        </figure>
      );
    case "divider":
      return <hr key={block.id} className="admin-rich-content__divider" />;
    default:
      throw new Error("Unsupported Rich Content block.");
  }
}

function renderRows(
  rows: Extract<PublicRichContentBlock, { type: "table" }>["rows"],
  header: boolean,
  alignments?: Array<"start" | "center" | "end">,
): ReactNode {
  return rows.map((row, rowIndex) => (
    <tr key={rowIndex}>
      {row.cells.map((cell, columnIndex) => {
        const className = alignmentClass(alignments?.[columnIndex]);
        return header ? (
          <th key={columnIndex} scope="col" className={className}>{renderInline(cell.spans)}</th>
        ) : (
          <td key={columnIndex} className={className}>{renderInline(cell.spans)}</td>
        );
      })}
    </tr>
  ));
}

function renderInline(inline: RichInline): ReactNode {
  return inline.map((span, index) => {
    let content: ReactNode = span.text;
    if (span.marks?.includes("bold")) content = <strong>{content}</strong>;
    if (span.marks?.includes("italic")) content = <em>{content}</em>;
    if (span.marks?.includes("underline")) content = <u>{content}</u>;
    return <Fragment key={index}>{content}</Fragment>;
  });
}

function alignmentClass(alignment: "start" | "center" | "end" = "start"): string {
  return `admin-rich-content__cell--${alignment}`;
}

function formatQuranReference(surah?: string, ayah?: number): string {
  if (surah && ayah) return `${surah} — الآية ${ayah}`;
  if (surah) return surah;
  return `الآية ${ayah}`;
}

function RichContentFallback({ label = "تعذّر عرض المحتوى المنسق." }: { label?: string }) {
  return <div className="admin-rich-content__fallback" role="alert">{label}</div>;
}
