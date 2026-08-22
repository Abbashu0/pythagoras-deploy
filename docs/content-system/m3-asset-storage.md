# M3 asset storage foundation

M3 separates Asset metadata from immutable binary objects:

```text
Authenticated Admin actor
  -> AssetService
     -> AssetRepository -> SQLite assets table
     -> AssetStorage    -> local content-addressed objects
```

## Storage and identity

- Asset entities use stable UUIDv7 IDs.
- Binary identity is SHA-256, independent of the filename and Asset ID.
- Objects live at `<PYTHAGORAS_DATA_DIR>/storage/objects/<first-two-hash-characters>/<sha256>`.
- A random staging file is flushed and closed before an atomic hard-link publishes the final object. A concurrent identical write reuses and verifies the existing object.
- One logical Asset row is retained per SHA-256 in M3. Re-uploading identical bytes returns that existing Asset without changing its original creator or metadata.
- Original and Arabic filenames are preserved as sanitized metadata only; they never affect filesystem paths.

## Upload policy

`POST /api/admin/assets` accepts one streaming `multipart/form-data` field named `file` and an optional small `displayName` field. The request is streamed to a random file under `<PYTHAGORAS_DATA_DIR>/temp/uploads/`; it is not converted to base64 or buffered as one browser payload.

The default maximum is 100 MiB. Set `PYTHAGORAS_MAX_ASSET_BYTES` to a positive byte count when a different local limit is required. Configuration above 2 GiB is rejected. Multipart part, field, header, and file limits are enforced centrally.

The server inspects content rather than trusting the browser MIME value. `file-type` detects binary signatures, Sharp validates supported raster images and reads width/height without transforming bytes, and UTF-8/JSON inputs receive content validation. Duration is intentionally left null; M3 adds no FFmpeg dependency.

HTML, SVG, scripts, executables, WebAssembly, and other active formats are rejected. Safe raster types may be returned inline to an authenticated Admin. Documents, text, JSON, archives, and other accepted data are returned as attachments with `nosniff`, same-origin resource policy, a restrictive CSP, and no-store caching.

## Consistency and integrity

SQLite and the filesystem cannot share one ACID transaction. Ingestion therefore:

1. validates and hashes the staged file;
2. reuses an existing healthy Asset for the hash when present;
3. atomically publishes the object;
4. inserts metadata with authenticated creator attribution;
5. removes a newly created object if metadata insertion fails and no row references it.

Pre-existing deduplicated objects are never removed as compensation. An internal integrity operation detects a missing object, wrong size, or SHA-256 mismatch. Metadata edits use expected revisions and reject stale writes.

## Server API foundation

- `POST /api/admin/assets`
- `GET /api/admin/assets`
- `GET /api/admin/assets/:id`
- `GET /api/admin/assets/:id/content`

All routes require an active OWNER or ADMIN session. Mutation requests also use the shared trusted same-origin check. Safe DTOs exclude storage keys and absolute paths. There is deliberately no delete API in M3.

## Deferred work

M3 does not add an Asset Library UI, usage relations, transformations, legacy ImageDB migration, or banner/material integration. Existing localStorage/IndexedDB images remain untouched. M4 builds the visual library on this server foundation.
