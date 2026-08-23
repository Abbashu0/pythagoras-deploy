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

The validator checks missing parents, cycles, duplicate keys/IDs/orders, real order gaps, and invalid browse targets. It preserves source order values and does not require them to start at zero or one.

## Questions, variants, and provenance

A Question has a stable UUID, positive order, a `primaryVariantId`, taxonomy assignments, first-class variants, and an optional question-level `sharedAnswer`. Each Variant owns its own rich question wording and occurrence/provenance records. Occurrences can describe ministerial, discussion, educational-TV, book, exercise, enrichment, and other sources without turning source labels into question types.

The contract intentionally contains no MCQ options, distractors, quiz readiness, grading, timers, attempts, or question-type classification architecture.

## RichDocument V1

Rich content is editor-neutral structured data, not HTML and not a Tiptap document. V1 blocks are:

- `paragraph`, `heading`
- `ordered-list`, `bullet-list`
- `quran`, `poetry`, `table`
- `image`, `divider`

Inline marks are `bold`, `italic`, and `underline`. Image blocks use a portable `assetRef`. `assetsManifest` maps that reference to an immutable SHA-256, filename, MIME type, byte size, and optional scalar metadata. It never contains local Asset IDs, base64/Data URLs, or filesystem paths.

## Validation and diagnostics

Stage 1 uses Ajv in strict Draft 2020-12 mode against the bundled schema. Stage 2 checks cross-entity semantics: canonical subject membership, ID/key/order uniqueness, hierarchy cycles, assignments, primary variants, browse targets, manifest references, and answer completeness.

Every diagnostic contains `severity`, `code`, `message`, and `jsonPointer`, with optional `entityId` and bounded scalar `context`. Missing shared answers and unused manifest entries are warnings; broken references and structural violations are errors.

The future-import eligibility boundary accepts `VALID` and `VALID_WITH_WARNINGS` only. `INVALID`, `UNSUPPORTED_VERSION`, and `GENERIC_JSON` are explicitly blocked; M8 itself performs no import or publication.

## Asset Library inspection

JSON assets remain immutable. The server reads a bounded JSON payload, validates it, and caches only inspection metadata and diagnostics in `question_package_inspections`. The cache is keyed by Asset ID and verified against the immutable source SHA-256 and inspector version. The Asset Library displays recognition badges, counts, package metadata, and diagnostics. Generic JSON behavior is unchanged.

## Converter boundary

M8 has no converter or importer. A later explicit import milestone may translate a validated V1 package into a relational Question domain. That future boundary must preserve stable IDs, variants, provenance, rich documents, manifest hashes, and subject scope; it must not trust an Asset Library badge as authorization to publish. No real question corpus is included in M8.
