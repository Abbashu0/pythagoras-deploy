# User-message preview fitting

Local Expo module for Expo SDK 57 / ExpoUI 57.0.14. It changes the native child
of the existing ContextMenu.Preview slot, not ContextMenu interaction itself.
The existing IPA does not contain this module. JS keeps its original full-source
Text preview on that IPA; the new fitter requires a reviewed native build.

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

Uniform s=min(1, availableWidth/naturalWidth, availableHeight/naturalHeight).
The reported size is (naturalWidth*s, naturalHeight*s). UIView.bounds are fitted
bounds. CGContext scales the entire vector drawing, including glyphs, padding,
continuous shape and border, into that bounded canvas. TextKit's internal
measurement container is tall, but no natural-height view/layer or huge bitmap
is created. No drawingGroup, renderer snapshot, texture allocation or scaleEffect
with an unscaled external frame is used. Copy is outside this view and unscaled.

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
