# Native Code Blocks: Source / Preview (pending iPhone review)

Baseline: `24a366c1ea9b1cf0f94403ff6c5b0a4eda9c700e`. The single MD4C-backed `ENRMCodeBlockContainerView` remains the source renderer. HighlighterSwift, raw AST Copy, TextKit/no-wrap scrolling, 18pt continuous corners, RaTeX, tables and Bidi are retained.

## Header and presentation

- Header label uses `StyleConfig.paragraphColor`, supplied by `paragraph.color = palette.text`. Source stays `palette.textSecondary`; typography and header height stay unchanged.
- Only exact, case-insensitive, whitespace-trimmed `html` and `mermaid` AST fence metadata grants Preview. Display sanitization and syntax aliases do not grant it to XML, JSX, TSX, Markdown or other families.
- Source is the default. Native `UISegmentedControl` displays source/play SF Symbols on one `UIGlassEffect(.regular)` surface at iOS 26+. Earlier iOS uses system thin material; Reduce Transparency uses a system tonal surface. Two 44pt segment targets share an 88pt-wide control; visible material is 36pt high. No separate glass container is needed for this single material. UIKit glass/clearGlass button configurations were audited; the standard segmented selection control preserves its native selected/pressed semantics.
- Copy hides in Preview, returns to its deterministic 44pt Source slot, and retains `doc.on.doc` / checkmark. The central symbol constant is ready for the separately reviewed glyph. No optical rightward adjustment is included.
- Preview body height is `clamp(round(cardWidth * 0.85), 260, 330)` points. Web/diagram content cannot expand the transcript asynchronously. An explicit mode change calls a weak owner callback, increments the native render revision, marks height validation pending, and uses the existing `validateHeightForCurrentWidth` / Fabric state-update path. Preview code never writes React geometry or scroll offsets.

## HTML isolation

Created lazily on the first Preview request. `WKWebsiteDataStore.nonPersistent`, `WKWebpagePreferences.allowsContentJavaScript = false` at configuration and navigation policy, no native message handlers, no injected model scripts, `baseURL: nil`. The exact AST source is embedded after application-owned CSP/viewport/default warm background styles; Copy never uses this wrapper. Source CSS may explicitly override the background.

CSP: `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; media-src 'none'; base-uri 'none'; form-action 'none'`.

There are no permitted data/remote/file assets in this first version. Only the initial main-frame `about:blank`/nil navigation caused by `loadHTMLString` is accepted. All subsequent navigation, form/link/popup/JavaScript targets and app-file destinations are refused. Additional source CSP cannot loosen the earlier policy. Inline HTML/CSS render best-effort; a quiet native error overlay contains no engine text. HTML may scroll within the bounded preview; its gesture behavior needs physical review.

## Exact MermaidKit audit

- Repository: <https://github.com/braddschick/MermaidKit/tree/a6a5c15f3c91ff4061780c235a44716a988dc475>.
- Exact SPM revision `a6a5c15f3c91ff4061780c235a44716a988dc475`; product/module `MermaidKit`; Swift tools 5.9; iOS 15 / macOS 12; no transitive packages.
- Official Mermaid 11.15.0 is copied offline as an SPM resource. Original Git blob: 3,312,967 bytes; SHA-256 `70137e77bb273bb2ef972b86e8b0400cca8be53cb25bfc45911a186dc98665de`. Windows checkout CRLF conversion changes the working-file hash; the original blob/normalized source matches the upstream version manifest.
- MermaidKit MIT (Bradd Schick); Mermaid MIT (Knut Sveidqvist). Complete upstream license notices are included through `PythagorasCodePreviewNotices.bundle`. Uncompressed resource impact is approximately 3.16 MiB plus Swift code; IPA compression impact is not yet measured.
- Audited `MermaidSource`, `MermaidConfiguration`, `MermaidHTMLBuilder`, `MermaidWebView`, `MermaidView`, controller and navigation policy. Bundled/default source loads through `Bundle.module`; no CDN fallback. Strict security, per-document script nonce, no unsafe-eval, inline style only, data/blob images, data fonts, connect/frame/object/form blocked. Diagram text is Base64 data for the official engine. Upstream navigation refuses links/redirects and exposes an optional host callback; this integration ignores links and enables no node actions.
- The public API is SwiftUI. A real `ENRMCodePreviewController` is contained by the React view controller, and owns a real child `UIHostingController<AnyView>` for `MermaidView`. This avoids unowned hosting views or private WKWebView access. Fixed-viewport `.panZoom` provides diagram navigation with no toolbar/export/share/editor. Dark/default themes follow the actual Pythagoras palette; background is transparent.

## Lifetime

Source never instantiates a preview controller or WKWebView. Switching back detaches the preview controller and keeps it while that code view remains mounted, so Source and horizontal offset stay immediate. Hidden Source updates do not render previews; re-entry updates the retained instance. Leaving the window/removing the block disposes it, stops HTML loading, clears delegates/scripts/handlers, replaces the Mermaid host root with `EmptyView` (invoking upstream dismantling), and removes both child-controller relationships. Closures use weak ownership. HTML updates coalesce on actual WK navigation completion rather than timers. No raw error/source logging.

## Scroll-to-Bottom

The existing transcript state and `onEndVisible` signal decide visibility: only `user-scrolled-away && !endVisible`. Passive stream growth never shows it. A ref guards the visibility edge, so there is no new per-frame React state publication. Pressing writes one nonanimated document-end offset, excluding unused anchor reserve and clamped to the actual native range; `onEndVisible(true)` acknowledges the explicit intent and re-arms existing follow rules. A new drag cancels that intent.

The 44pt native glass `arrow.down` button is an absolute child of the existing Composer `KeyboardStickyView`, above its measured height with 12pt separation. It adds no measured Composer height, content padding or keyboard listener. Older iOS uses a native bordered button. No haptic is added.

## Verification boundaries / first native gates

Structural/AST/type/lint tests and clean patch application run locally. Optional browser oracles use `PYTHAGORAS_PREVIEW_CHROME` and `PYTHAGORAS_MERMAID_AUDIT_ROOT` for real bundled Mermaid diagrams/malformed input and actual HTML CSP script/network rejection. Chromium evidence is not WKWebView/iPhone evidence.

The next reviewed IPA must verify Mermaid SPM resolution, its resource bundle embedding, generated Swift/Objective-C interfaces, legitimate hosting containment, HTML navigation/error behavior, diagram pan/zoom versus transcript dragging, Source/Preview height transitions, Copy return geometry, dark/light glass and the keyboard-attached down button. No Xcode compile or physical result is claimed in this local pass.
