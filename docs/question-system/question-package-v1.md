# Pythagoras Question Package V1

M8 defines a portable interchange contract only. It does not import packages into a relational Question Bank and does not implement an editor, search, publication, or quiz behavior.

## Recognition markers

A package is recognized only when it explicitly declares:

```json
{
  "$schema": "https://schemas.pythagoras.local/question-package/1.0.0",
  "format": "pythagoras.question-package",
  "schemaVersion": "1.0.0",
  "contentMode": "question-bank"
}
```

The bundled JSON Schema is `src/server/question-packages/question-package-v1.schema.json`. Validation never fetches remote schemas. JSON without package markers remains `GENERIC_JSON`; a future marked version is `UNSUPPORTED_VERSION` rather than being guessed or coerced.

## Package and subject identity

`package.id` is a stable UUID and `package.key` is a portable semantic key. `subjectKey` must already exist in canonical Materials; inspecting a package never creates a subject. `contentRevision` describes the source package revision and is not a database revision.

## Taxonomy and Bank Browse

`taxonomy` is the reusable content classification hierarchy. Nodes have stable UUIDs, keys, kinds, parent references, and positive order values. Questions may be assigned to multiple nodes with exactly one `PRIMARY` assignment and any number of `RELATED` assignments.

`bankBrowse` is a separate presentation/navigation structure:

- `ALL_PACKAGE_QUESTIONS` directly lists the package questions, suitable for a simple Literature entry.
- `TREE` defines presentation groups and `QUESTION_LIST` nodes whose filters target taxonomy nodes. A Grammar package can therefore show nine topic choices without encoding those choices into the taxonomy itself.

The validator checks missing parents, cycles, duplicate keys/IDs, real order gaps, and invalid browse targets. Order uniqueness and gap diagnostics are scoped to siblings that share the same `parentId`; root nodes (`parentId: null`) form their own sibling group. A child may therefore use order `1` beneath multiple different parents. Source values are preserved and are never renumbered or required to start at zero or one.

## Questions, variants, and provenance

A Question has a stable UUID, positive canonical `order`, a `primaryVariantId`, taxonomy assignments, first-class variants, and an optional question-level `sharedAnswer`. Each Variant owns its own rich question wording and occurrence/provenance records. Occurrences use `roundCode`, explicit `branches[]` and `qualifiers[]`, optional session/source metadata, and a required non-empty `rawLabel` that preserves the original source wording exactly. Structured fields supplement that label; they never replace it.

`question.order` is package-level canonical ordering, not the number rendered beside a filtered Student result. A future Student list filters the active Bank Browse destination, sorts by canonical order, then renders a local 1-based ordinal (`#1`, `#2`, …). For example, a Nafi question whose package order is `483` can still be the first displayed Nafi result and show `#1`. No second persisted display-number field exists.

The contract intentionally contains no MCQ options, distractors, quiz readiness, grading, timers, attempts, or question-type classification architecture.

## RichDocument V1

Rich content is editor-neutral structured data, not HTML and not a Tiptap document. Every block has a stable UUID `id` independent of array position. Quran and poetry verses also have stable IDs. These identities survive reordering and support future editing, conflict inspection, usage projection, and block-aware merging.

`RichInline` is the shared text representation: an array of `{ text, marks? }` spans, where marks are `bold`, `italic`, and `underline`. It is used consistently by paragraphs, headings, lists, Quran verses, poetry hemistichs, table cells/captions, and image captions where rich inline formatting is meaningful. Exact Arabic text and diacritics are never normalized by the contract.

V1 blocks are:

- `paragraph`, `heading`
- `ordered-list`, `bullet-list`
- `quran`, `poetry`, `table`
- `image`, `divider`

Quran verses may carry optional `surah` and `ayah` metadata without inferred references or font data. Poetry preserves `sadr` and `ajuz` as separate rich inline sequences. Tables explicitly declare `headerRowCount`, may include a rich caption, column alignment (`start`, `center`, `end`), and an editor-neutral `standard`/`compact` display intent so renderers never have to guess header semantics. Image blocks use a portable `assetRef`. `assetsManifest` maps that reference to an immutable SHA-256, filename, MIME type, byte size, and optional scalar metadata. It never contains local Asset IDs, base64/Data URLs, or filesystem paths.

## Validation and diagnostics

Stage 1 uses Ajv in strict Draft 2020-12 mode against the bundled schema. Stage 2 checks cross-entity semantics: canonical subject membership, package-wide stable identity, sibling-scoped order, hierarchy cycles, assignments, primary variants, browse targets, manifest references, provenance labels, meaningful Variant content, and answer completeness.

Every diagnostic contains `severity`, `code`, `message`, and `jsonPointer`, with optional `entityId` and bounded scalar `context`. A Variant with no meaningful content is an error; this includes zero blocks, whitespace-only text, and divider-only documents. An image-only Variant is intentionally meaningful. A missing or semantically empty shared answer remains a preservation/review warning. Broken references and structural violations are errors.

The future-import eligibility boundary accepts `VALID` and `VALID_WITH_WARNINGS` only. `INVALID`, `UNSUPPORTED_VERSION`, and `GENERIC_JSON` are explicitly blocked; M8 itself performs no import or publication.

## Asset Library inspection

JSON assets remain immutable. The server reads a bounded JSON payload, validates it, and caches only inspection metadata and diagnostics in `question_package_inspections`. The cache is keyed by Asset ID and verified against the immutable source SHA-256 and inspector version. M8.1 uses inspector version `2`; version `1` rows are treated as stale and re-inspected on demand without a database migration. The Asset Library displays recognition badges, counts, package metadata, and diagnostics. Generic JSON behavior is unchanged.

## Converter boundary

M8 has no converter or importer. A later explicit import milestone may translate a validated V1 package into a relational Question domain. That future boundary must preserve stable IDs, variants, provenance, rich documents, manifest hashes, and subject scope; it must not trust an Asset Library badge as authorization to publish. No real question corpus is included in M8.
