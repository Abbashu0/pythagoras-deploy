# Native code syntax (pending physical iPhone review)

Starting baseline: `85f04d90721f8f24dc6b06ffbe675b1ce3a1e99b`.

The existing MD4C standalone CodeBlock segment and ENRMCodeBlockContainerView remain the only code renderer. Markdown is not parsed in JavaScript. Nested fences retain the library's existing text renderer.

## Audited dependency

- HighlighterSwift 3.1.0, tag commit `fe7aae9c9b31d3b296fd3d2dd575e1a207bb29e0`: <https://github.com/smittytone/HighlighterSwift/tree/3.1.0>.
- Package.swift: Swift tools 5.9, iOS 13+, no transitive package dependencies; product/module is `Highlighter`, not `HighlighterSwift`.
- Bundled Highlight.js 11.11.1: 192 grammars. The fast path uses JavaScriptCore and Foundation attributed text; the HTML document importer and autodetection are not used.
- Wrapper license MIT, grammar engine BSD 3-Clause. Notices are copied into the app via `PythagorasCodeSyntaxNotices.bundle`.
- The package is pinned by revision through the pod's existing React Native `spm_dependency` helper. Expo prebuild/Pod install regenerate integration; no generated Xcode project is edited. No npm dependency/version changes.

The library author labels iOS support untested. Local inspection verified its UIKit compatibility shims; Xcode compilation, indirect SPM resource-bundle embedding and physical runtime remain unverified in this Windows pass.

## Rendering and threading

1. Apply exact AST source with the existing font, LTR/no-wrap paragraph style and TextKit measurement immediately.
2. Submit metadata-selected grammar work to one `.utility` serial queue and one cached Highlighter instance.
3. Each container UUID has at most one pending job; newer deltas replace it. Canceled jobs are skipped. At most 128 clients can wait, with raw fallback under overload.
4. Cache foreground-only results by theme version, dark/light mode, grammar and SHA-256 of UTF-8 source. Explicit LRU caps: 64 entries / 2 MiB estimated source-and-run cost. Code above 32,768 UTF-16 units remains fully rendered/copied in monochrome.
5. Return through the main queue. Cancellation, container revision and exact source guards reject obsolete results.
6. Add only foreground attributes to the existing text storage. No source/font/paragraph/selection/offset/height updates belong to syntax completion.

Atom One Dark/Light supplies token classification colors. Those colors are mapped to Pythagoras-owned muted colors with >=4.5:1 contrast against the actual light/dark elevated card surface. Default text, card geometry and font remain Pythagoras-owned. No line numbers or syntax-driven bold/italic metrics are applied.

Display labels and grammar aliases are separate. Families include React/JSX -> JavaScript, TSX -> TypeScript, SwiftUI -> Swift, SQLite -> SQL, plist/Vue/Svelte -> XML, TOML/.env/git config -> INI. Canonical languages from the pinned engine are also accepted. Missing/explicit plain language never starts autodetection. CSV and pseudocode remain plain. Unsupported grammar names (including Mermaid, Prisma, Solidity and regex in this engine bundle) retain sanitized labels and raw monochrome text. No HTML/Mermaid preview is introduced.

When math is disabled the pod explicitly sets `ENRICHED_MARKDOWN_MATH=0`: the new generated Swift header must not make the library's fallback RaTeX detector enable unavailable math. Default enabled RaTeX configuration is unchanged.

## Local checks / next native QA

`tests/chat-native-syntax-highlighting.test.ts` always verifies integration/race/layout contracts and contrast. Its optional real-grammar oracle runs with `PYTHAGORAS_HIGHLIGHTER_AUDIT_ROOT` pointing to a temporary checkout of the exact upstream tag; it never becomes Mobile runtime code. The upstream bundle's grammar output is tested for Unicode, indentation, tabs, CRLF and entities. Native Swift attributed rendering and scheduling still require the reviewed Development IPA.

Next native review: verify `Highlighter_Highlighter.bundle` is embedded and the bridge initializes; test source/Copy parity and selection, cold first highlight and long streaming updates, rapid revisions/cancellation, Dynamic Type, dark/light contrast, horizontal code gestures versus vertical transcript gestures, and unchanged table/math/chat geometry.
