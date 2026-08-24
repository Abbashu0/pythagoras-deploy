import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RichDocumentRenderer } from "../src/components/admin/rich-content";
import {
  RICH_CONTENT_BLOCK_TYPES,
  buildAdminRichContentAssetUrl,
  buildPublicRichContentAssetUrl,
  toPublicRichDocument,
} from "../src/lib/rich-content";
import type { RichDocument } from "../src/server/question-packages";
import {
  assertCanonicalRichDocument,
  toCanonicalRichDocument,
  type CanonicalRichDocument,
} from "../src/server/questions";
import { openContentDatabase } from "../src/server/content";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const imageAssetId = "01920000-0000-7000-8000-000000000020";
const maliciousText = '<script>alert(1)</script><img src=x onerror=alert(1)>"</div>';

const canonicalDocument: CanonicalRichDocument = {
  type: "doc",
  version: 1,
  blocks: [
    {
      id: "01920000-0000-7000-8000-000000000001",
      type: "heading",
      level: 2,
      spans: [{ text: "عنوان عربي English 2026", marks: ["bold", "underline"] }],
    },
    {
      id: "01920000-0000-7000-8000-000000000002",
      type: "paragraph",
      spans: [
        { text: "نص عربي طويل مع علامات: " },
        { text: maliciousText, marks: ["bold", "italic", "underline"] },
      ],
    },
    {
      id: "01920000-0000-7000-8000-000000000003",
      type: "ordered-list",
      items: [{ spans: [{ text: "العنصر الأول" }] }],
    },
    {
      id: "01920000-0000-7000-8000-000000000004",
      type: "bullet-list",
      items: [{ spans: [{ text: "نقطة تعليمية" }] }],
    },
    {
      id: "01920000-0000-7000-8000-000000000005",
      type: "quran",
      verses: [
        {
          id: "01920000-0000-7000-8000-000000000006",
          spans: [{ text: "إِنَّا أَعْطَيْنَاكَ الْكَوْثَرَ", marks: ["underline"] }],
          surah: "الكوثر",
          ayah: 1,
        },
      ],
    },
    {
      id: "01920000-0000-7000-8000-000000000007",
      type: "poetry",
      verses: [
        {
          id: "01920000-0000-7000-8000-000000000008",
          sadr: [{ text: "قِفا نبكِ", marks: ["underline"] }],
          ajuz: [{ text: "مِن ذكرى حبيبٍ ومنزلِ", marks: ["italic"] }],
        },
      ],
    },
    {
      id: "01920000-0000-7000-8000-000000000009",
      type: "table",
      headerRowCount: 1,
      caption: [{ text: "جدول المقارنة", marks: ["bold"] }],
      columnAlignments: ["start", "center", "end"],
      displayMode: "compact",
      rows: [
        { cells: [{ spans: [{ text: "الأول" }] }, { spans: [{ text: "الثاني" }] }, { spans: [{ text: "الثالث" }] }] },
        { cells: [{ spans: [{ text: "A" }] }, { spans: [{ text: "B" }] }, { spans: [{ text: "C" }] }] },
      ],
    },
    {
      id: "01920000-0000-7000-8000-000000000010",
      type: "image",
      assetId: imageAssetId,
      alt: "رسم توضيحي آمن",
      caption: [{ text: "وصف الصورة", marks: ["italic"] }],
    },
    { id: "01920000-0000-7000-8000-000000000011", type: "divider" },
  ],
};

test("Portable to Canonical remains stable and Canonical to Public strips local asset identity only", () => {
  const portable = structuredClone(canonicalDocument) as unknown as RichDocument;
  const portableImage = portable.blocks.find((block) => block.type === "image");
  assert.equal(portableImage?.type, "image");
  if (portableImage?.type !== "image") throw new Error("missing image");
  delete (portableImage as unknown as { assetId?: string }).assetId;
  portableImage.assetRef = "diagram-one";

  const canonical = toCanonicalRichDocument(portable, (assetRef) => {
    assert.equal(assetRef, "diagram-one");
    return imageAssetId;
  });
  assert.deepEqual(canonical, canonicalDocument);

  const resolved: string[] = [];
  const presentation = toPublicRichDocument(canonical, (assetId) => {
    resolved.push(assetId);
    return buildPublicRichContentAssetUrl(assetId);
  });
  assert.deepEqual(resolved, [imageAssetId]);
  assert.deepEqual(
    presentation.blocks.slice(0, -2),
    canonical.blocks.slice(0, -2),
  );
  const image = presentation.blocks.find((block) => block.type === "image");
  assert.equal(image?.type === "image" ? image.src : null, `/api/content/assets/${imageAssetId}`);
  const serialized = JSON.stringify(presentation);
  for (const forbidden of ["assetRef", "assetId", "storageKey", "file://", "C:\\", "/storage/objects/"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(buildAdminRichContentAssetUrl(imageAssetId), `/api/admin/assets/${imageAssetId}/content`);
});

test("Admin and Student render every V1 block with equivalent semantic markup", async () => {
  const presentation = toPublicRichDocument(
    canonicalDocument,
    buildPublicRichContentAssetUrl,
  );
  const adminMarkup = renderToStaticMarkup(
    createElement(RichDocumentRenderer, {
      document: canonicalDocument,
      resolveAssetUrl: buildAdminRichContentAssetUrl,
    }),
  );
  const student = await loadStudentRenderer();
  const studentMarkup = student.renderRichDocument(presentation);

  assert.deepEqual(
    [...student.STUDENT_RICH_CONTENT_BLOCK_TYPES],
    [...RICH_CONTENT_BLOCK_TYPES],
  );
  for (const markup of [adminMarkup, studentMarkup]) {
    for (const tag of ["<article", "<h2", "<p", "<ol", "<ul", "<section", "<table", "<thead", "<tbody", "<th", "<td", "<figure", "<img", "<figcaption", "<hr"]) {
      assert.ok(markup.includes(tag), `${tag} missing`);
    }
    assert.ok(markup.includes("<u><em><strong>"));
    assert.ok(markup.includes("إِنَّا أَعْطَيْنَاكَ الْكَوْثَرَ"));
    assert.ok(markup.includes("الكوثر — الآية 1"));
    assert.ok(markup.includes("قِفا نبكِ"));
    assert.ok(markup.includes("جدول المقارنة"));
    assert.ok(markup.includes('scope="col"'));
    assert.ok(markup.includes("وصف الصورة"));
  }
  assert.ok(adminMarkup.includes(`/api/admin/assets/${imageAssetId}/content`));
  assert.ok(studentMarkup.includes(`/api/content/assets/${imageAssetId}`));
});

test("both renderers escape script-looking educational text and reject raw HTML blocks", async () => {
  const presentation = toPublicRichDocument(canonicalDocument, buildPublicRichContentAssetUrl);
  const adminMarkup = renderToStaticMarkup(
    createElement(RichDocumentRenderer, {
      document: canonicalDocument,
      resolveAssetUrl: buildAdminRichContentAssetUrl,
    }),
  );
  const student = await loadStudentRenderer();
  const studentMarkup = student.renderRichDocument(presentation);
  for (const markup of [adminMarkup, studentMarkup]) {
    assert.equal(markup.includes("<script>alert(1)</script>"), false);
    assert.equal(markup.includes("onerror=alert(1)"), true);
    assert.ok(markup.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  }

  const rawHtml = structuredClone(canonicalDocument) as unknown as {
    blocks: Array<Record<string, unknown>>;
  };
  rawHtml.blocks = [{ id: "01920000-0000-7000-8000-000000000012", type: "html", html: maliciousText }];
  assert.throws(() => assertCanonicalRichDocument(rawHtml));
  const adminFallback = renderToStaticMarkup(
    createElement(RichDocumentRenderer, {
      document: rawHtml as unknown as CanonicalRichDocument,
      resolveAssetUrl: buildAdminRichContentAssetUrl,
    }),
  );
  const studentFallback = student.renderRichDocument({ type: "doc", version: 1, blocks: rawHtml.blocks });
  assert.ok(adminFallback.includes('role="alert"'));
  assert.ok(studentFallback.includes('role="alert"'));
  assert.equal(adminFallback.includes(maliciousText), false);
  assert.equal(studentFallback.includes(maliciousText), false);

  assert.throws(() =>
    toPublicRichDocument(canonicalDocument, () => "javascript:alert(1)"),
  );
});

test("responsive Quran, poetry, table, and image styling stays scoped to Rich Content", () => {
  const studentCss = readFileSync(
    path.join(process.cwd(), "public/pythagoras/src/styles/rich-content.css"),
    "utf8",
  );
  const adminCss = readFileSync(
    path.join(process.cwd(), "src/components/admin/rich-content/rich-document.css"),
    "utf8",
  );
  for (const css of [studentCss, adminCss]) {
    assert.ok(css.includes("overflow-x: auto"));
    assert.ok(css.includes("@media (max-width: 520px)"));
    assert.ok(css.includes("grid-template-columns: minmax(0, 1fr)"));
    assert.ok(css.includes("max-width: 100%"));
    assert.equal(/(?:^|\n)\s*(?:p|table|img|section|article)\s*\{/u.test(css), false);
  }
  assert.ok(studentCss.includes(".rich-content__poetry-verse"));
  assert.ok(studentCss.includes(".rich-content__table-region"));
});

test("M10 adds no migration, Question API, Editor, search, or runtime Question data", () => {
  assert.equal(
    readdirSync(migrationsDirectory).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).length,
    8,
  );
  assert.equal(readdirSync(migrationsDirectory).some((name) => name.startsWith("0008")), false);
  const apiTree = readTree(path.join(process.cwd(), "src/app/api"));
  assert.equal(/api[\\/]content[\\/]questions|api[\\/]admin[\\/]questions/u.test(apiTree.paths), false);
  const adminQuestionPage = readFileSync(
    path.join(process.cwd(), "src/app/admin/(protected)/questions/page.tsx"),
    "utf8",
  );
  assert.equal(/RichDocumentRenderer|QuestionEditor|Tiptap|import package/iu.test(adminQuestionPage), false);
  const questionPlaceholder = readFileSync(
    path.join(process.cwd(), "public/pythagoras/src/pages/QuestionBankPlaceholderPage.js"),
    "utf8",
  );
  assert.equal(/fetch\(|renderRichDocument|search/iu.test(questionPlaceholder), false);

  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m10-empty-"));
  try {
    const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
    for (const table of ["question_packages", "questions", "question_variants", "question_occurrences"]) {
      const row = database.client.prepare(`select count(*) as count from ${table}`).get() as { count: number };
      assert.equal(row.count, 0, table);
    }
    assert.equal(database.client.pragma("quick_check", { simple: true }), "ok");
    database.close();
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

async function loadStudentRenderer(): Promise<{
  STUDENT_RICH_CONTENT_BLOCK_TYPES: readonly string[];
  renderRichDocument(document: unknown): string;
}> {
  const url = pathToFileURL(
    path.join(
      process.cwd(),
      "public/pythagoras/src/components/RichDocumentRenderer.js",
    ),
  );
  url.searchParams.set("m10", String(Date.now()));
  return import(url.href);
}

function readTree(root: string): { paths: string; contents: string } {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else files.push(target);
    }
  };
  visit(root);
  return {
    paths: files.join("\n"),
    contents: files.map((file) => readFileSync(file, "utf8")).join("\n"),
  };
}
