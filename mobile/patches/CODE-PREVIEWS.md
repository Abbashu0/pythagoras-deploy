# Native Code Blocks: Source / Preview polish (pending iPhone review)

Baseline: `66cf89a96286aafcccadf638756efa2471451536`. The single MD4C-backed `ENRMCodeBlockContainerView` remains the source renderer. HighlighterSwift, exact raw AST Copy, TextKit/no-wrap source, RaTeX, tables and Bidi are retained. This pass changes native presentation/gesture ownership and unused transcript capacity, not Markdown parsing or conversation data.

## Header and presentation

- Header label uses `StyleConfig.paragraphColor`, supplied by `paragraph.color = palette.text`. Source stays `palette.textSecondary`; typography and header height stay unchanged.
- Only exact, case-insensitive, whitespace-trimmed `html` and `mermaid` AST fence metadata grants Preview. Display sanitization and syntax aliases do not grant it to XML, JSX, TSX, Markdown or other families.
- Source is the default. Native `UISegmentedControl` displays source/play SF Symbols on one `UIGlassEffect(.regular)` surface at iOS 26+. Earlier iOS uses system thin material; Reduce Transparency uses a system tonal surface. Two 44pt segment targets share an 88pt-wide control; visible material is 36pt high. The previous transparent background/divider images are removed: UIKit owns its track, selected capsule and pressed/animated selection. Ordering is LTR.
- Header coordinates never depend on presentation mode. Copy has a reserved 52pt slot immediately left of the fixed-right selector; hiding Copy does not move the selector. The Source surface encloses header/body; in Preview the ambient header stays in place and only the body surface below it has continuous 21pt corners. No heavy divider or added border.
- Persistent Chat Copy uses `square.on.square` / checkmark: both code header and Assistant action row. The code glyph alone moves optically 1pt right inside the unchanged 44pt hit box. System edit-menu, math/table menu commands are unchanged.
- A shared viewport cap is `clamp(round(cardWidth * 0.85), 260, 330)` points. Source reports `headerHeight + min(full TextKit body height, cap)`; Preview reports `headerHeight + cap`. Short source stays intrinsic. One native `UIScrollView` holds the full selectable/no-wrap text and owns both axes for long files/lines. Copy and highlighting still use the complete AST source.
- Both modes use the same visible-height helper for measurement and visual frames. Explicit mode changes synchronously update local frames and invoke the weak owner callback. The owner computes segment frames, increments the native revision, marks validation pending and uses the existing `validateHeightForCurrentWidth` / Fabric state-update path. Its current Fabric wrapper clips overflowing native paint while a larger height is awaiting acknowledgement. The validator itself is unchanged. Preview code never writes React geometry or conversation offsets.

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
- The public API is SwiftUI. A real `ENRMCodePreviewController` is contained by the React view controller, and owns a real child `UIHostingController<AnyView>` for `MermaidView`. Inline interaction is explicit: pan/zoom, no node actions, scale 0.7–3.5. Fullscreen uses 0.5–5. Dark/default themes follow the actual Pythagoras palette; background is transparent.
- This pinned package has no public render-success callback. During native layout the owner discovers the WKWebView only in its owned hosting subtree, not private Swift fields or a global search. An app-owned `WKContentWorld.defaultClient` observer watches actual SVG insertion, posts only a fixed `rendered` status, and ignores pan/zoom attribute changes. A narrow navigation delegate forwards the pinned package's navigation/failure methods unchanged; no Mermaid source/error crosses this bridge. HTML never receives this handler.
- Successful first rendering calls the public `MermaidController.zoomToFit()` once. Source updates while interacting do not reset zoom; a genuinely new presentation/source may fit again. A centered native activity indicator and generic secondary-color error label share the same fixed viewport, so success/error does not alter transcript height.

## Gesture ownership and expanded viewer

`ENRMCodeGestureGate` is a native, hit-scoped recognizer. A meaningful 8pt pan or two-touch gesture claims the viewport. Its failure-priority delegate makes ancestor scroll pans wait for it to fail; descendant WebKit/source recognizers may recognize simultaneously and retain touches (`cancelsTouchesInView = false`). A simple tap fails this gate. It does not replace ancestor delegates, disable global scroll flags or send JS/React pointer updates. Mermaid gets this gate only after successful rendering; HTML does not. Long Source gets it only while vertical overflow exists.

A one-touch Preview-body tap with at most 8pt movement opens `ENRMCodeFullscreenController`; Mermaid's tap requires its interaction gate to fail. Header interactions cannot open the viewer. This is a real `.fullScreen` controller, not a sheet. Its 44pt circular X and native **Code / Preview** text segments stay above the viewer surface. Preview is default and uses the same owned preview controller, HTML sandbox and pinned Mermaid engine. Code uses an immutable attributed-source snapshot, native selectable two-axis TextKit scrolling and the same foreground-only syntax service, with no inline-card chrome. Dismissal changes no conversation scroll offsets or anchors. All child controllers have explicit containment and teardown.

## Lifetime

Source never instantiates a preview controller or WKWebView. Switching back detaches the preview controller and keeps it while that code view remains mounted, so Source and internal offsets stay immediate. Hidden Source updates do not render previews; re-entry updates the retained instance. Leaving the window/removing the block disposes it, stops HTML loading, clears delegates/scripts/handlers, restores the upstream Mermaid delegate and disconnects the app-owned observer, replaces the Mermaid host root with `EmptyView` (invoking upstream dismantling), and removes child-controller relationships. Fullscreen teardown cancels syntax work and disposes its independent preview. Closures use weak ownership. HTML updates coalesce on actual WK navigation completion rather than timers. No raw error/source logging.

## Manual-reader capacity correction

The previous updater returned early for `user-scrolled-away`, and its pure consumer retained the entire preceding anchor reserve. Streaming/completion therefore could leave unnecessary new-turn capacity frozen below the real document. Manual-reader capacity now becomes `min(previousSpace, calculateChatTranscriptAnchorBlankSpace(currentOffset, contentHeight, viewportHeight, minimumComposerInset))`: never grow passively, release unused space monotonically, preserve the offset's required floor. Growth, terminal validation and drag/momentum boundaries may release unused capacity; none issues a scroll command. Existing anchoring/follow ownership is unchanged. Returning toward the real end releases an abandoned reserve instead of leaving the action row separated by a giant dead zone.

## Scroll-to-Bottom

The existing transcript state and `onEndVisible` signal decide visibility: only `user-scrolled-away && !endVisible`. Passive stream growth never shows it. A ref guards the visibility edge, so there is no new per-frame React state publication. Pressing writes one nonanimated document-end offset, excluding unused anchor reserve and clamped to the actual native range; `onEndVisible(true)` acknowledges the explicit intent and re-arms existing follow rules. A new drag cancels that intent.

The 44pt native glass `arrow.down` button is an absolute child of the existing Composer `KeyboardStickyView`, above its measured height with 12pt separation. It adds no measured Composer height, content padding or keyboard listener. Older iOS uses a native bordered button. No haptic is added.

## Verification boundaries / first native gates

Structural/AST/type/lint tests and clean patch application run locally. Optional browser oracles use `PYTHAGORAS_PREVIEW_CHROME` and `PYTHAGORAS_MERMAID_AUDIT_ROOT` for real bundled Mermaid diagrams/malformed input, SVG-insertion status (not transform noise), and actual HTML CSP script/network rejection. Chromium evidence is not WKWebView/iPhone evidence.

The next reviewed IPA must verify Swift/Objective-C interfaces and compilation, scoped gesture failure priority on KeyboardChatScrollView, native selected capsules in both appearances/Reduce Transparency, long Source internal scrolling/selection, repeated long Source↔Preview height cycles, loading/first-fit behavior, modal presentation/dismissal at an unchanged transcript position, native WebKit isolation in fullscreen, and manual-reader reserve release during growth/completion. Existing resource pins and bundles are retained. No Xcode compile or new physical result is claimed in this local pass.
