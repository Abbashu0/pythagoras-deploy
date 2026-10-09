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
well as size, so the continuous outline and UIView layer use the same
`sourceCornerRadius * scale` value. An unavailable fit has no authoritative
radius and supplies zero until successful native recovery. No unscaled 24pt
radius is applied to a narrow miniature. Product physical QA reported that this
outline alignment alone did not eliminate clipped caps. It is retained; the
additional correction protects the content region rather than retuning the mask.

## Preview-only optical content safety

Original padding shrinks with the text: 11pt becomes 0.22pt at scale 0.02.
For a scaled preview whose basic fitted width is within the source corner
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
iteration, timer, JS callback or extra row. Insufficient space or invalid pixel
metrics fails closed, never producing a successful partial/zero fit. Window
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
| `opticalSafetyEnabled` | `true` | Boolean |
| `sideSafetyPixels` | `1` | 0–8 physical pixels |
| `endSafetyWidthFactor` | `1` | 0–4 |
| `endSafetyExtraPixels` | `3` | 0–32 physical pixels |
| `narrowEligibilityFactor` | `2` | 0–8 |

Nonfinite, negative or excessive numeric fields use that field's default.
Wrong types are rejected by Expo's typed field decoder. If a valid experiment
would consume the viewport, fitting uses the default optical policy once
instead; it never publishes negative/invalid bounds. Disabling safety or using
weaker margins may reproduce visual clipping deliberately during experimentation.
The exact previous defaults remain the stable production policy.

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
