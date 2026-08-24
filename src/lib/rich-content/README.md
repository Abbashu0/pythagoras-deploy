# Rich Content boundaries

Pythagoras keeps three representations deliberately separate:

- Portable Question Package V1 uses `assetRef` for transferable JSON.
- Canonical SQLite RichDocument uses local immutable Asset `assetId` values.
- Public presentation uses only a resolved, authorized image URL plus `alt` and optional caption.

`toPublicRichDocument()` is the pure presentation boundary. URL resolution is injected; renderers never access the Asset repository, storage keys, filesystem paths, or portable manifest references.

The Admin React renderer accepts canonical content and an Admin URL resolver. The Student vanilla-JS renderer accepts only public presentation content. Both support the complete V1 block and mark set without raw HTML.

## Future editor adapter

M10 does not contain an editor or an editor-state format. A future adapter may translate:

`CanonicalRichDocument → editor state → CanonicalRichDocument`

That adapter must preserve block IDs, Quran/poetry verse IDs, inline marks, Asset IDs, table header/caption/alignment semantics, and block order. Tiptap or any other editor technology must remain an implementation detail and must never replace CanonicalRichDocument as the stored content contract.
