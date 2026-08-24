export const STUDENT_RICH_CONTENT_BLOCK_TYPES = Object.freeze([
  "paragraph",
  "heading",
  "ordered-list",
  "bullet-list",
  "quran",
  "poetry",
  "table",
  "image",
  "divider",
]);

const BLOCK_TYPES = new Set(STUDENT_RICH_CONTENT_BLOCK_TYPES);
const MARKS = ["bold", "italic", "underline"];

export function renderRichDocument(document, options = {}) {
  try {
    assertPublicDocument(document);
    return `<article class="rich-content" dir="rtl" data-rich-document="public-v1">${document.blocks.map(renderBlock).join("")}</article>`;
  } catch {
    return renderRichContentFallback(options.fallbackLabel);
  }
}

export function renderRichInline(inline) {
  if (!Array.isArray(inline)) throw new Error("RichInline must be an array.");
  return inline.map((span) => {
    if (!span || typeof span !== "object" || typeof span.text !== "string") {
      throw new Error("RichInline span is invalid.");
    }
    let content = escapeHtml(span.text);
    for (const mark of MARKS) {
      if (!span.marks?.includes(mark)) continue;
      if (mark === "bold") content = `<strong>${content}</strong>`;
      if (mark === "italic") content = `<em>${content}</em>`;
      if (mark === "underline") content = `<u>${content}</u>`;
    }
    return content;
  }).join("");
}

function renderBlock(block) {
  if (!block || typeof block !== "object" || !BLOCK_TYPES.has(block.type)) {
    throw new Error("Unsupported Rich Content block.");
  }
  const blockId = escapeAttribute(String(block.id ?? ""));
  switch (block.type) {
    case "paragraph":
      return `<p class="rich-content__paragraph" data-block-id="${blockId}">${renderRichInline(block.spans)}</p>`;
    case "heading": {
      if (![2, 3, 4].includes(block.level)) throw new Error("Heading level is invalid.");
      return `<h${block.level} class="rich-content__heading rich-content__heading--${block.level}" data-block-id="${blockId}">${renderRichInline(block.spans)}</h${block.level}>`;
    }
    case "ordered-list":
    case "bullet-list": {
      if (!Array.isArray(block.items)) throw new Error("List items are invalid.");
      const tag = block.type === "ordered-list" ? "ol" : "ul";
      return `<${tag} class="rich-content__list" data-block-id="${blockId}">${block.items.map((item) => `<li>${renderRichInline(item.spans)}</li>`).join("")}</${tag}>`;
    }
    case "quran":
      if (!Array.isArray(block.verses)) throw new Error("Quran verses are invalid.");
      return `<section class="rich-content__quran" data-block-id="${blockId}" aria-label="نص قرآني">${block.verses.map((verse) => {
        const reference = formatQuranReference(verse.surah, verse.ayah);
        return `<div class="rich-content__quran-verse" data-verse-id="${escapeAttribute(String(verse.id ?? ""))}"><p class="rich-content__quran-text">${renderRichInline(verse.spans)}</p>${reference ? `<cite class="rich-content__quran-meta">${escapeHtml(reference)}</cite>` : ""}</div>`;
      }).join("")}</section>`;
    case "poetry":
      if (!Array.isArray(block.verses)) throw new Error("Poetry verses are invalid.");
      return `<section class="rich-content__poetry" data-block-id="${blockId}" aria-label="نص شعري">${block.verses.map((verse) => `<div class="rich-content__poetry-verse" data-verse-id="${escapeAttribute(String(verse.id ?? ""))}"><p class="rich-content__hemistich">${renderRichInline(verse.sadr)}</p><span class="rich-content__poetry-separator" aria-hidden="true">•</span><p class="rich-content__hemistich">${renderRichInline(verse.ajuz)}</p></div>`).join("")}</section>`;
    case "table":
      return renderTable(block, blockId);
    case "image": {
      const src = safeAssetUrl(block.src);
      const alt = escapeAttribute(String(block.alt ?? ""));
      const caption = block.caption ? `<figcaption class="rich-content__caption">${renderRichInline(block.caption)}</figcaption>` : "";
      if (!src) {
        return `<figure class="rich-content__figure rich-content__figure--missing" data-block-id="${blockId}"><div class="rich-content__missing-image" role="img" aria-label="${alt}">تعذّر تحميل الصورة</div>${caption}</figure>`;
      }
      return `<figure class="rich-content__figure" data-block-id="${blockId}"><img class="rich-content__image" src="${escapeAttribute(src)}" alt="${alt}" loading="lazy" decoding="async">${caption}</figure>`;
    }
    case "divider":
      return `<hr class="rich-content__divider" data-block-id="${blockId}">`;
    default:
      throw new Error("Unsupported Rich Content block.");
  }
}

function renderTable(block, blockId) {
  if (!Array.isArray(block.rows) || !Number.isInteger(block.headerRowCount)) {
    throw new Error("Table structure is invalid.");
  }
  const headerRows = block.rows.slice(0, block.headerRowCount);
  const bodyRows = block.rows.slice(block.headerRowCount);
  const caption = block.caption ? `<caption class="rich-content__caption">${renderRichInline(block.caption)}</caption>` : "";
  const mode = block.displayMode === "compact" ? " rich-content__table--compact" : "";
  return `<div class="rich-content__table-region" data-block-id="${blockId}" role="region" aria-label="جدول محتوى" tabindex="0"><table class="rich-content__table${mode}">${caption}${headerRows.length ? `<thead>${renderRows(headerRows, true, block.columnAlignments)}</thead>` : ""}${bodyRows.length ? `<tbody>${renderRows(bodyRows, false, block.columnAlignments)}</tbody>` : ""}</table></div>`;
}

function renderRows(rows, header, alignments = []) {
  return rows.map((row) => {
    if (!row || !Array.isArray(row.cells)) throw new Error("Table row is invalid.");
    return `<tr>${row.cells.map((cell, columnIndex) => {
      const tag = header ? "th" : "td";
      const scope = header ? " scope=\"col\"" : "";
      const alignment = ["start", "center", "end"].includes(alignments[columnIndex]) ? alignments[columnIndex] : "start";
      return `<${tag}${scope} class="rich-content__cell rich-content__cell--${alignment}">${renderRichInline(cell.spans)}</${tag}>`;
    }).join("")}</tr>`;
  }).join("");
}

function assertPublicDocument(document) {
  if (!document || document.type !== "doc" || document.version !== 1 || !Array.isArray(document.blocks)) {
    throw new Error("Public RichDocument is invalid.");
  }
}

function safeAssetUrl(value) {
  if (typeof value !== "string" || !value || /[\u0000-\u001f\u007f\\]/u.test(value)) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? value : null;
  } catch {
    return null;
  }
}

function formatQuranReference(surah, ayah) {
  if (typeof surah === "string" && Number.isInteger(ayah)) return `${surah} — الآية ${ayah}`;
  if (typeof surah === "string") return surah;
  if (Number.isInteger(ayah)) return `الآية ${ayah}`;
  return "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function renderRichContentFallback(label = "تعذّر عرض المحتوى المنسق.") {
  return `<div class="rich-content__fallback" role="alert">${escapeHtml(label)}</div>`;
}
