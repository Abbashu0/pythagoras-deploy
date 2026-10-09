# User-message preview fitting

Local Expo module for Expo SDK 57 / ExpoUI 57.0.14. It changes the native child
of the existing ContextMenu.Preview slot, not ContextMenu interaction itself.
A Development Build containing this module uses the native fitter. Older builds
keep the original full-source Text preview through the JS availability gate.

## Verified source integration gate

ExpoUI exports public ExpoUIView and open UIBaseViewProps (ios/UIBaseView.swift,
UIBaseViewProps.swift). ExpoModulesCore exports ExpoSwiftUI.View / AnyChild;
SwiftUIVirtualView.mountChild accepts any such child independent of its module.
ExpoUI SlotView.Children forwards those children. Therefore an ExpoUIView from
this local module is a SwiftUI child, not an ordinary RN UIView embedded in the
preview. expo-module.config.json + ios/PythagorasChatPreview.podspec are resolved
from the SDK's default ./modules nativeModulesDir. No ExpoUI patch, generated iOS
project edit, package upgrade or additional dependency is required.

This is a source/autolinking feasibility result, not successful Xcode compilation.

## Sizing

UIViewRepresentable.sizeThatFits owns sizing synchronously on main. TextKit
lays out the exact source at a finite logical width with Dynamic Type body font,
native bidi, original line spacing and padding. A first width pass uses left
alignment to measure occupied width; final layout restores the requested physical
alignment and includes trailing blank lines. Glyph character coverage must equal
the full NSTextStorage length. There is no source truncation or length-height math.

The natural layout and fit are cached only in that preview's UIView. Identical
source/style/font/category/appearance inputs and window identity/bounds/safe
insets/layout margins reuse the fit. Trial proposals and finger position are not
cache keys. Genuine input or window-geometry changes invalidate; ordinary layout
passes do not. Keyboard movement alone does not refit an already valid snapshot.
A failed TextKit measurement remains failed until an input/geometry/lifecycle
change, preventing repeated expensive work. No timer or global cache is installed.

The fitted SwiftUI child owns local @StateObject sizing state. Window attachment,
safe-area change, or native layout after an initially unusable viewport resolves
the same synchronous fitter. Only a successful positive fit emits a weak native
callback to @Published recovery bounds. SwiftUI consumes those bounds through an
explicit fitted .frame, changing its layout proposal to UIViewRepresentable.
UIKit intrinsicContentSize uses that same fitter, and is also invalidated; this
is NOT a claim that intrinsic invalidation alone reaches SwiftUI. Publishing does
not happen inside sizeThatFits/updateUIView/intrinsicContentSize. Native recovery
is gated once per valid fit, with no self-scheduling setNeedsLayout loop or JS event.

SwiftUI onAppear/onDisappear provide additional child lifecycle boundaries even
when its UIView/window is retained. Disappearance clears the fit and prevents
intervening queries from establishing a stale dismissed snapshot; appearance or
real window reattachment enables fresh measurement. Detachment/dismantle release
TextKit and the weak recovery callback is removed at disposal. ExpoUI 57.0.14's
ContextMenu exposes NO explicit menu-open/menu-close callback, and Apple does not
promise child onDisappear on every dismissal. We therefore do not claim a menu
delegate boundary: correctness on retained hosts additionally depends on exact
input and real window-geometry keys, not on assuming every menu detaches its view.
An indistinguishable reopening reuses valid identical geometry if SwiftUI emits
no lifecycle event. Actual context-menu callback ordering needs device testing.

Exact UIKit menu height is not publicly exposed to this component. The budget is
a conservative APPROXIMATION: current window.safeAreaLayoutGuide.layoutFrame,
excluding the overlap with its native keyboardLayoutGuide at the time of sizing,
less horizontal layout margins, with vertical reservation equal to the greater
of 35% of safe height or max(44pt, 3 native body-font line heights) plus actual
vertical layout margins. 44pt is the iOS minimum action target; three line heights
approximate a padded Copy row. The 35% floor leaves additional system spacing.
This is not a device-specific dimension or a claim of measuring the system menu.
Reading keyboardLayoutGuide installs no keyboard observer, inset owner or scroll
write. If the system later dismisses the keyboard, that presentation keeps its
initial conservative fit until dismissal.

The own window is preferred; before attachment, only a unique foreground key
window is used. Transient proposals, even finite ones, are not accepted as a
substitute viewport: a small trial query must not freeze a tiny fit. If no relevant
window exists, or its safe dimensions are zero/nonfinite, sizing returns zero
until native window geometry is available; it is not stored as a successful fit.
Window attachment/native valid-geometry events explicitly recover SwiftUI sizing
as described above. Neither sizing path invents viewport dimensions. UIKit can
attach a window before its safe viewport is usable, so layoutSubviews also checks
for initial recovery, but does nothing once the unchanged valid fit is notified.

The basic fit uses s=min(1, availableWidth/naturalWidth, availableHeight/naturalHeight).
Ordinary previews report (naturalWidth*s, naturalHeight*s). Narrow miniatures
add the fitted-space optical safety margins described below. UIView.bounds are
the reported outer size. Glyphs, native text spacing and original padding use
one uniform CGContext scale inside that canvas. The continuous surface is drawn
in fitted coordinates with scaled radius/border width. TextKit's internal
measurement container is tall, but no natural-height view/layer or huge bitmap
is created. No drawingGroup, renderer snapshot, texture allocation or scaleEffect
with an unscaled external frame is used. Copy is outside this view and unscaled.

The fitted SwiftUI surface explicitly supplies a `.contextMenuPreview` content
shape after its fitted frame. Recovery carries the successful fit geometry as
well as size, so the continuous lift outline and CGContext path use the same
`sourceCornerRadius * scale` value. The UIView layer now clips only rectangular
bounds, without a second rounded mask. An unavailable fit has no authoritative
radius and supplies zero until successful native recovery. No unscaled 24pt
radius is applied to a narrow miniature. Product physical QA reported that this
outline alignment alone did not eliminate clipped caps. It is retained; the
additional correction protects the content region rather than retuning the mask.
Apple describes this content shape as the lift preview shape; it is not a
contract exposing the fully presented custom preview's system mask.

## Ink-containment investigation and verification gate

Physical QA establishes that optional optical margins reduce the symptom; it
does NOT establish which compositor clips it. Confirmed source defects were:
`usedRect`/full character coverage were treated as sufficient without validating
actual rendered ink against the rounded path, and an independent Core Animation
rounded mask clipped the same drawing a second time. Neither fact proves the
physical device's remaining clipping is app-owned. No finger-motion tuning is
introduced.

| Boundary | Source evidence / new invariant | Verification still required |
| --- | --- | --- |
| A: TextKit | `boundingRect(forGlyphRange:in:)` per complete line includes glyph/mark overhang; all glyphs/characters must be covered. Natural size/origin include negative and positive ink overhang plus trailing blank lines. | Hosted TextKit tests for Arabic marks, emoji, bidi and Dynamic Type. This is a conservative ink envelope, not individual glyph outlines. |
| B: CGContext | One cached continuous `CGPath` is BOTH the containment authority and drawing clip. Every transformed ink envelope expanded by one physical pixel plus scaled stroke width must lie inside it. | Hosted clipped vs unclipped bounded raster alpha comparison; one pixel is an explicit raster tolerance, not a claim about every possible font rasterizer. |
| C: UIView/layer | `clipsToBounds` remains, `layer.cornerRadius = 0`; no independent rounded CA mask. Actual centered ink bounds are checked against actual UIView bounds before drawing. An undersized host canvas returns drawing failure, not successful partial ink. | Hosted actual `layer.render` against the same unclipped reference, including subpixel output bounds. |
| D: SwiftUI lift | Existing fitted frame and `.contentShape(.contextMenuPreview, …)` remain. This specifies lift geometry, not the final system compositor mask. | Physical native ContextMenu lift/dismissal and first-frame layout. |
| E: system presentation | Installed ExpoUI forwards the custom slot to SwiftUI `.contextMenu(menuItems:preview:)`; it exposes no final mask geometry or delegate to this child. No additional system-mask guarantee is inferred. | Actual iPhone presentation. Hosted UIView raster tests do NOT exercise this boundary. |

References: Apple's [TextKit ink bounding API](https://developer.apple.com/documentation/uikit/nslayoutmanager/boundingrect(forglyphrange:in:)),
[Core Animation implicit mask](https://developer.apple.com/documentation/quartzcore/calayer/maskstobounds),
and [lift content shape](https://developer.apple.com/documentation/swiftui/contentshapekinds/contextmenupreview).

`FittedPreviewInkLayout` validates all four corners of each expanded envelope
against the actual convex continuous rounded path: by convexity this contains
the whole envelope, not just its intersection with a rectangular canvas. A
candidate with no extra correction is accepted first. Only if that fails, a
bounded discovery samples smaller corrections before refining a verified
candidate. The preferred bound comes from the fitted corner extent plus
pixel/stroke clearance, and probes stay strictly below the space-consumption
limit. The initial preferred bound is NOT required to be valid. Every candidate refits the unchanged
complete body uniformly inside its reported outer bounds. No additional TextKit
measurement is performed during the search. We do not claim globally optimal
insets or exhaustive real-valued interval coverage. At most 28 discovery probes
and 12 refinement steps follow the zero-correction attempt. The final returned
candidate is always explicitly checked. No verified candidate means a failure,
NOT mathematical proof that no possible correction exists.
Unscaled short previews stay identical whenever their measured ink already
satisfies the path/pixel invariant. There is no new width-based black cap band.

The optional five-prop optical policy remains compatible, but is no longer the
safety authority. The intentional Debug AND Release production baseline is now
`opticalSafetyEnabled: false`: no legacy width-based bands, mandatory ink/path
validation. Numeric defaults remain 1/1/3/2. The prior diagnostic false has become
the reviewed baseline direction, not a mismatch excused by failing tests. Node
tests assert JS/native parity and separately opt into the unchanged legacy band
math. Collapse thresholds remain unchanged.

Hosted XCTest compares complete vector glyph drawing with/without ONLY the app
ink clip, then compares actual UIView/layer output to the same reference. Both
images are allocated at bounded FITTED size. ANY lost 8-bit alpha value fails
the test; a reference with no ink also fails. Cases cover
short, medium, long and 5000-paragraph stress input, combining marks, emoji, bidi,
final marker/trailing blank lines, scales 1/2/3 and accessibility Dynamic Type.
The reference uses the SAME production draw method, not a different text renderer.
Synthetic corner tests also demonstrate that rectangular containment can pass
while rounded-path containment fails. These tests are added, NOT executed on
Windows. Node guards only verify their presence and native integration structure.
An intentionally extra half-canvas mask is a negative control: the raster loss
probe MUST detect missing ink. This is not a simulation or identification of
UIKit's unknown actual mask.
Whole-preview alpha alone cannot prove that individual glyph details survive
extreme quantization: several lines may share a single pixel. Separate crops
magnify the actual first composed character and final END-marker character
vectors AND clipping path to natural text scale, with bounded glyph-crop image
dimensions and strict alpha comparison. Trailing blank lines are not mistaken
for the last glyph. Character
coverage and complete draw range remain separate source-integrity checks. This
does not claim arbitrary-length miniatures are legible on a physical screen.

Before any claim that this fixes the observed physical symptom: execute hosted
XCTest, compile the native module, and compare the first/last lines on iPhone.
If app raster comparison passes but device clipping remains, stop app-inset
experiments and investigate the system preview boundary separately. No supported
API here exposes an exact final UIKit mask; any alternative presentation then
requires a separate Product Owner decision. Extremely small full-source
miniatures may remain unreadable from screen resolution even without clipping.

## Optional legacy optical diagnostic (disabled by default)

Original padding shrinks with the text: 11pt becomes 0.22pt at scale 0.02.
ONLY when explicitly enabled in Debug, for a scaled preview whose basic fitted width is within the source corner
diameter, `fitPreview` reserves symmetric FITTED-space margins before the final
fit. Short unscaled and wider previews retain their exact previous geometry.
Each side receives one physical pixel from the actual measurement window's
screen scale. Each end receives the basic fitted width plus three pixels: two
account for the side margins in the maximum resulting outer width, and one is
raster clearance. Thus endInset >= finalOuterWidth + onePixel, a conservative
safe band beyond even full-width continuous cap regions.

The available budget is reduced by these margins, then the same complete
TextKit body is uniformly fitted once inside the remainder. Reported dimensions
include both margins; the text origin includes them before the uniform scale.
The source is not rewrapped or cropped, and no unreported drawing overflow is
created. The outer surface/border and clipping follow those reported bounds.
This is constant-time geometry after the single TextKit measurement, with no
iteration, timer, JS callback or extra row. Oversized diagnostic bands fall back
to the plain fit; they cannot veto an otherwise valid mandatory search. Invalid
pixel metrics fail closed. Mandatory ink containment still runs after either
policy. Window
display scale is part of the native cache key; ordinary proposals remain frozen.

Node tests cover complete content-box dimensions, cap clearance, pixel metrics
and unchanged short/wide cases. Hosted XCTest additionally checks actual
NSLayoutManager glyph bounds for Arabic/combining marks and the end marker.
These tests have not been run on Windows and do not validate the system menu
compositor or finger motion. Physical QA must confirm the first/last visible
lines and whether the conservative strip margins look appropriate. No
movement-resistance API is added, and inline collapse thresholds are unchanged.

## Fast Refresh optical tuning (development only)

`mobile/src/ai/native-preview-tuning.dev.ts` is the single editable JS tuning
location. The ContextMenu passes these five optional props only when `__DEV__`
is true. The local native view uses the SDK 57 `@Field` mechanism, validates
values into `PreviewOpticalTuning`, and captures that value in `PreviewInput`.

| Parameter | Default | Accepted native range |
| --- | --- | --- |
| `opticalSafetyEnabled` | `false` | Boolean |
| `sideSafetyPixels` | `1` | 0–8 physical pixels |
| `endSafetyWidthFactor` | `1` | 0–4 |
| `endSafetyExtraPixels` | `3` | 0–32 physical pixels |
| `narrowEligibilityFactor` | `2` | 0–8 |

Nonfinite, negative or excessive numeric fields use that field's default.
Wrong types are rejected by Expo's typed field decoder. If a valid experiment
would consume the viewport, fitting uses the plain body fit instead; mandatory
ink validation remains required. It never publishes negative/invalid bounds. Disabling optical safety or
using weaker margins changes only the optional policy; mandatory ink containment
remains active. System presentation clipping is a separate unproven boundary.
Release ignores diagnostic overrides and uses disabled legacy optics plus
mandatory containment. No diagnostic switch can disable the safety invariant.

The existing unsigned workflow uses `xcodebuild -configuration Debug`. Native
overrides are also protected by `#if DEBUG`; a Release module always supplies
`.defaults` even if JS sends overrides. The first native build must verify
the local pod compiles with the expected Debug conditions and the props link.
No developer controls, preferences, storage, network request or remount key is
introduced. The source/style props follow the tuning spread, so tuning cannot
replace the original source or bubble width.

Validated tuning participates in synthesized `PreviewInput` equality. A changed
effective parameter therefore takes the existing `configure -> resetPresentation
-> sizeThatFits` path; old recovery bounds are rejected by their input identity.
Unchanged/normalized-to-default inputs reuse valid geometry. The window metrics,
native recovery callback and context-preview outline retain their existing
ownership. Dismiss the menu around edits; exact behavior while actively holding
the menu during Fast Refresh still requires device QA.

Developer workflow:

1. After independent review, build/install one Development IPA containing these
   native props. An older fitter build cannot gain them from JavaScript alone.
2. Start Metro from `mobile/` using the existing LAN Development Build workflow:
   `npx expo start --dev-client --lan`. Keep the existing API/LAN environment.
3. Edit the five constants in `mobile/src/ai/native-preview-tuning.dev.ts`.
4. Let Metro/Fast Refresh deliver the updated JS.
5. Dismiss and reopen the native ContextMenu; it receives the updated validated
   inputs without changing the inline message or transcript measurements.
6. Compare screenshots and tune again without rebuilding the IPA.

Swift implementation changes, new native prop definitions, or geometry behaviors
not expressible by these five controls still require a native rebuild. Once
values are accepted, promote them to `PreviewOpticalTuning.defaults` and align the
JS constants in a reviewed native checkpoint/build. Fast Refresh does not reload
compiled Swift. Neither native compilation nor these lifecycle guarantees have
been verified on a device by the Windows structural tests.

Full layout is linear in source size, measured once per presentation (width/final
alignment passes); memory holds one attributed source/glyph layout. Extremely
long messages may become unreadable miniatures. Their exact source still reaches
Copy. Nonfinite/failed/full-coverage-invalid measurement fails safely without
rendering a partial source. Real TextKit timing and memory need device profiling.

## Failure audit: unresolved presentation gate

`PreviewFitStatus` distinguishes `unavailableGeometry`, `invalidTextLayout`,
`noVerifiedInkFit`, `fitted`, and `suspended`. Unavailable window/viewport/scale
does not consume a measurement attempt; the existing attachment/geometry event
can recover sizing. After a known-window layout/containment failure, no fit is
cached and no successful recovery/frame update is published. A weak native
invalidation callback from the existing recovery events (never sizeThatFits)
clears any older successful same-input SwiftUI frame and records a genuine
failure locally. Unavailable geometry is transient, not a failure; successful
recovery clears failure. Obsolete accessibility labels clear with the snapshot.
Failed work is
not retried until source/style/window/lifecycle changes. A constrained positive
viewport can genuinely fail (for example, one-pixel-wide space cannot contain
the two-sided one-pixel ink tolerance). A bounded search miss is reported only
as `noVerifiedInkFit`, not proved impossibility.

IMPORTANT: the existing SwiftUI custom Preview slot STILL receives zero size on
failure. It has no public failure callback allowing this child to omit the
parent's Preview slot while retaining Trigger/Items. Therefore an invisible
custom preview is a real unresolved UI failure possibility, even though it is
not cached/reported as a successful fit. The status is native/read-only and
locally observed, not a JS event or a fallback presentation. No student-facing
substitute is implemented.
Displaying a bounded scrollable full-source preview, omitting the custom preview,
or another failure surface requires independent Product/architecture approval.
Do not call this ready for complete native UX validation until that policy is
resolved. An undersized actual drawing canvas separately returns drawing failure.

## Main-thread cost

TextKit measurement remains on the native layout owner, once per valid cache
lifetime. Line ink measurement is O(n). The geometry search now builds the convex
hull of source-envelope corners once (O(n log n), O(n) temporary memory); convex
path containment of its pixel-expanded vertices proves containment of ALL line
envelopes. Typical full-width multiline text has four hull vertices, instead of
four path tests per line for every candidate. The worst hull can still be O(n),
so no constant-time claim is made. Fitted envelope arrays are materialized only
once AFTER verified discovery/refinement. A final O(n) actual-path check of EVERY
transformed envelope runs once before publishing, independently auditing hull
numerics; it is not repeated per search candidate. Drawing uses a cached union for O(1)
rectangular host-bounds validation. This adds no observation fan-out, repeated
TextKit layout, timer, transcript measurement or off-main UIKit access.

No runtime timings have been measured on Windows. Hosted tests include a
5000-line reduction case and verify EVERY original envelope after reduction.
Before shipping, capture context-menu opening with Time Profiler/Allocations on
the same iPhone (short/long/extreme input; compare Debug and Release separately),
and inspect TextKit measurement, hull sorting, path checks and peak memory.
Reopen unchanged content to verify the existing retained-host cache behavior.

## Executable hosted XCTest wiring — macOS execution still pending

The installed Expo 57.0.18 `template.tgz` was inspected: it supplies an iOS
project, shared scheme, Podfile, properties, and the existing Expo/RN
post_install. `app.json` sets `com.abbashu.pythagoras` and dynamic frameworks.
There is no locally generated `mobile/ios` on this Windows host; this installed
Expo CLI explicitly skips iOS prebuild on Windows. The macOS generator therefore
inspects the REAL prebuilt project and refuses missing/ambiguous containers,
wrong production identity, duplicate test targets, or changed production target
settings. No claim is made that it has already executed against a generated Mac
project.

`.github/scripts/prepare-ios-preview-tests.rb` adds only:

- `PythagorasPreviewTestHost`: a tiny UIKit application with an actual
  UIWindowScene, no React/Metro/backend startup, its own test-only bundle ID.
- `PythagorasPreviewTests`: hosted unit-test bundle, original
  `ios-tests/NativePreviewLayoutTests.swift` source reference, TEST_HOST and
  BUNDLE_LOADER pointing at that host, shared Debug scheme and target dependency.
- A generated-only sibling Podfile target reusing the existing local
  `PythagorasChatPreview` pod and the app's dynamic-framework mode. The test bundle
  inherits search paths and loads production symbols from the host. No
  production Swift source is copied into the test bundle. Test-host dead-code
  stripping is disabled and it references the module class to retain linkage.

Production target/configuration/build-phase snapshots are compared before and
after project serialization. Production `app.json`, bundle ID, podspec, source,
existing IPA workflow and dispatcher are unchanged. The normal IPA workflow does
NOT invoke the generator. The podspec still compiles `ios/*.swift`, including
the ink validator; host/test Swift remains outside that production glob.

After review, on a Mac with the existing Node/CocoaPods/Xcode environment:

```sh
npm ci --prefix mobile
node .github/scripts/verify-enriched-markdown-height-patch.mjs
bash .github/scripts/ios-preview-tests.sh
```

Run from a fresh checkout WITHOUT generated `mobile/ios`. The driver executes:

1. Source inventory (currently 13 Foundation / 19 hosted test methods; private
   helpers excluded), source SHA-256s, SwiftPM compiled discovery, actual
   Foundation XCTest and its xUnit report. Empty/missing/partial execution fails.
2. Expo prebuild, the test-target generator, CocoaPods, actual generated workspace
   discovery. Original SDK pins/production sources are used, not stubs.
3. Installed available iPhone/iOS Simulator discovery (latest available runtime;
   no hard-coded iPhone model/OS), boot, Simulator-only Debug build-for-testing
   with ENABLE_TESTABILITY, and compile-log checks for all four native Swift files.
4. `xcodebuild test-without-building -enumerate-tests` with flat JSON output.
   Compiled discovered IDs MUST exactly match the source inventory before tests.
5. Real hosted execution on that UDID, serially, without automatic retries.
   `xcresulttool get test-results summary/tests` supplies executed identities,
   counts, outcomes and durations. The reporter rejects skipped/failed/unknown,
   missing/duplicate tests, mismatched totals, or missing destination provenance.

The checked-in reporter uses only Python standard-library JSON/XML; xcodeproj is
the existing CocoaPods gem. Missing tools or unsupported actual Xcode report
schemas fail explicitly, not by silently assuming success. No dependencies are
added to the app. Local infrastructure tests use SYNTHETIC result fixtures and
static source guards, not native compilation/raster execution evidence.

Reports preserve discovery, actual result counts, per-test durations/slowest five
cases, invocation wall time, selected runtime/UDID, checkout SHA, raw Xcode logs
and `.xcresult`. Default reports are in an isolated temporary directory; set
`PREVIEW_TEST_REPORTS` to an EMPTY directory to choose the location. DerivedData
is separate, so no built app/IPA is uploaded. The GitHub test path uploads only
test evidence, including failure logs. Build/discovery/test/report errors are
fatal. System-owned ContextMenu presentation mask and haptic/lift remain outside
these UIView/TextKit tests.

**Native execution status:** Foundation and hosted Swift/XCTest have NOT run on
this Windows host. Actual compilation, module symbol linkage, enumeration JSON,
xcresult schema, Simulator launch and test durations await the first approved Mac
run. Writing the wiring/workflow does not prove those integration gates passed.

### GitHub test-only entrypoint and dispatch blocker

`.github/workflows/ios-preview-tests.yml` is a new macos-26 reusable/manual workflow.
It checks out ONLY `ios-dev-build-spike`, requires an exact approved `expected_sha`,
and executes this driver. It never invokes the IPA script, archives iphoneos,
uploads an IPA, or runs on push. Neither it nor the current uncommitted source is
published yet.

The existing main dispatcher calls ONLY `ios-dev-build.yml@ios-dev-build-spike`.
It cannot select this test workflow without a dispatcher change. The NEW test
workflow is not registered on main; do NOT assume that `--ref ios-dev-build-spike`
alone makes it manually dispatchable. GitHub requires a default-branch dispatch
entrypoint for this new workflow. See [GitHub manual dispatch requirements](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

Minimal safe solution, requiring explicit approval: add a separate small main
dispatcher at `.github/workflows/ios-preview-tests.yml` (do NOT change the IPA
dispatcher or merge spike into main):

```yaml
name: Native preview test dispatcher
on:
  workflow_dispatch:
    inputs:
      expected_sha:
        description: Reviewed spike checkpoint SHA
        required: true
        type: string
permissions:
  contents: read
jobs:
  native-preview-tests:
    uses: Abbashu0/pythagoras-deploy/.github/workflows/ios-preview-tests.yml@ios-dev-build-spike
    with:
      expected_sha: ${{ inputs.expected_sha }}
    permissions:
      contents: read
```

This is documentation only; main was NOT edited. After independent review,
approved checkpoint/push AND approved main registration, the ONE manual command is:

```sh
gh workflow run ios-preview-tests.yml --ref main -f expected_sha=<NEW_REVIEWED_SPIKE_SHA>
```

Do not use current HEAD for the still-uncommitted correction or dispatch now.
The reusable `Uses:` revision and checkout SHA must then be verified from actual
job logs. Existing IPA dispatch remains independent. Foundation and hosted UIKit
execution failures must be reviewed; do not tune geometry to hide them.

## Review gates

- Xcode compile/autolink of the public ExpoUI interfaces and SwiftUI view.
- Short typography/padding parity against the previously approved SwiftUI Text.
- Complete middle/end paragraphs in medium/long/extreme preview, normal Copy menu.
- Portrait/landscape, Dynamic Type, keyboard-open safe viewport, multiple windows.
- Initial unspecified sizing queries (no zero-size flash) and native lifecycle
  reset between repeated presentations; no late refit while the finger moves.
- Actual Copy row/system spacing versus the conservative budget.
- No row-height/scroll change. Native long press/haptic/lift/dismiss remain system-owned.

No movement-resistance workaround is implemented.

Node tests validate integration structure and evaluate the exact native fitting
expressions portably. They do not compile Swift or execute UIKit. On a Swift host,
`swift test --package-path mobile/modules/pythagoras-chat-preview` executes the
Foundation-only geometry XCTest cases. The separate ios-tests/NativePreviewLayoutTests.swift
must be added to a hosted iOS XCTest target linked to the Debug pod. It exercises
real short/medium/long/extreme TextKit coverage, reported dimensions, nil queries,
repeated sizing and cache teardown. Tests own explicit UIWindows (never make the
runner's window authoritative), disable ambient key-window fallback, and include
early unavailable intrinsic/sizing queries, attachment recovery, detach/reattach,
changed source/style/Dynamic Type/appearance, and retained-window appearance.
A UIHostingController test exercises the actual SwiftUI represented sizing path
and final UIView bounds after an early zero proposal. Neither Swift XCTest set
has been run on Windows. UIKit/TextKit and menu presentation still require a
native build; no successful compilation or recovery timing is claimed here.
