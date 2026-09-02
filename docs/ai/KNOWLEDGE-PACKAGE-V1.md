# `pythagoras.knowledge-package` V1

This document defines the portable source-document contract delivered by AI-M6. It is deliberately separate from `pythagoras.question-package`; it represents approved knowledge documents and does not contain precomputed retrieval data.

## Envelope

The V1 envelope uses:

```json
{
  "$schema": "https://schemas.pythagoras.local/knowledge-package/1.0.0",
  "format": "pythagoras.knowledge-package",
  "schemaVersion": "1.0.0",
  "contentMode": "knowledge",
  "package": {
    "id": "stable-uuid",
    "key": "arabic.official-knowledge",
    "title": "Approved Arabic reference",
    "subjectKey": "arabic",
    "language": "ar",
    "contentRevision": 1
  },
  "source": { "id": "stable-uuid", "revision": 1 },
  "documents": [],
  "assetsManifest": []
}
```

Package identity is `id + key + subjectKey`. `contentRevision` changes when the source-document content changes; document order is presentation metadata, not identity. The package pins an exact published Knowledge Source revision. Source and Package revisions are immutable after publication.

Each document has a stable `id`, positive `order`, optional title/provenance, and the existing editor-neutral V1 `RichDocument`. Portable images use `assetRef`; canonical SQLite rows resolve that reference to an Asset ID during publication. A portable package contains no filesystem path or storage key.

The manifest records `ref`, SHA-256, safe filename, MIME type, byte size, and bounded scalar metadata. Publication resolves every referenced asset against the existing Asset Library and verifies the declared hash, size, and MIME type.

## Source governance

Source types are closed: `OFFICIAL_TEXTBOOK`, `MINISTERIAL_REFERENCE`, `PYTHAGORAS_APPROVED`, `TEACHER_SUPPLEMENT`, `REFERENCE_TABLE`, and `OTHER_APPROVED`. Trust is explicit (`OFFICIAL`, `PYTHAGORAS_APPROVED`, `TEACHER_REVIEWED`, `OTHER_APPROVED`) and is never inferred from a title or URL. Rights must be explicitly reviewed; only a source revision with `rightsStatus = CLEARED` and `enabled = true` is eligible for production projection.

AI-assisted preparation is a future producer option recorded as metadata. AI-M6 does not call a model, OCR documents, import a real corpus, or treat model output as approved truth. Manual and deterministic fixtures are sufficient for this milestone.

## Publication and storage boundary

Package content may exceed the Change Set snapshot limit. AI-M6 stages a validated, content-addressed local artifact under `PYTHAGORAS_DATA_DIR`; the governed Change Set contains only bounded package metadata and the artifact hash/reference. OWNER publication revalidates the artifact, source pin, assets, and RichDocuments, then atomically materializes normalized canonical Package revision, Document, and Asset-binding rows. No draft artifact or Change Set proposal is production eligible.

The canonical package retains historical revisions and the exact source pin. Disabling a source or restricting its rights does not erase history; the published-only eligibility query excludes the package while the current source state is unavailable or not cleared.

## Explicit non-goals

V1 has no chunks, embeddings, vector index, retrieval scores, rerank scores, Evidence Pack, web search, provider call, Conversation flow, Student/Admin AI UI, or AI-assisted ingestion runtime. Those are later milestones and must consume this published contract through replaceable projection boundaries.
