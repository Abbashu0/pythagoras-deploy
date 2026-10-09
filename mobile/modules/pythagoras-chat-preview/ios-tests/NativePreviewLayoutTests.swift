import SwiftUI
import UIKit
import XCTest
@testable import PythagorasChatPreview

// Add this file to a hosted iOS XCTest target linked against the local pod.
// It is deliberately excluded from pod production sources and swift test's
// Foundation-only target. These tests have NOT been executed on Windows.
final class NativePreviewLayoutTests: XCTestCase {
  @MainActor
  private func testWindow(root: UIViewController = UIViewController()) throws -> UIWindow {
    // Own the window; do not measure against the test runner's key window.
    let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
    let window = UIWindow(windowScene: scene)
    window.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
    root.additionalSafeAreaInsets = UIEdgeInsets(top: 12, left: 8, bottom: 12, right: 8)
    window.rootViewController = root
    window.isHidden = false
    window.layoutIfNeeded()
    root.view.layoutIfNeeded()
    XCTAssertGreaterThan(window.safeAreaLayoutGuide.layoutFrame.height, 0)
    return window
  }

  @MainActor
  private func attach(_ view: VectorPreviewView, to window: UIWindow) {
    view.allowsKeyWindowFallback = false
    window.rootViewController!.view.addSubview(view)
    window.layoutIfNeeded()
    window.rootViewController!.view.layoutIfNeeded()
  }

  @MainActor
  private func close(_ window: UIWindow) {
    window.isHidden = true
    window.rootViewController = nil
  }

  @MainActor
  private func input(_ source: String, category: UIContentSizeCategory = .large) -> PreviewInput {
    PreviewInput(source: source, logicalMaxWidth: 320,
      foreground: .label, background: .secondarySystemBackground, border: .separator,
      rtl: true, fontStyle: .body, lineSpacing: 3, horizontalPadding: 15,
      verticalPadding: 11, borderWidth: 0.8, cornerRadius: 24,
      category: category, appearance: .dark)
  }

  @MainActor
  func testShortTextKeepsNaturalSize() throws {
    let window = try testWindow()
    let view = VectorPreviewView(frame: .zero)
    defer { view.dispose(); close(window) }
    view.configure(input("مرحبا"))
    attach(view, to: window)
    let size = view.fittedSize(proposal: ProposedViewSize(width: 390, height: 760))
    let fit = try XCTUnwrap(view.fit)
    XCTAssertEqual(fit.scale, 1)
    XCTAssertEqual(size, try XCTUnwrap(view.naturalSize))
    XCTAssertEqual(view.intrinsicContentSize, size)
  }

  @MainActor
  func testPreviewOutlineMatchesTheScaledVectorBubble() throws {
    let window = try testWindow()
    defer { close(window) }
    for source in ["مرحبا", String(repeating: "نَصّ عربي + API 👨‍👩‍👧‍👦\n", count: 1600) + "PYTHAGORAS_LONG_MESSAGE_END_2026\n\n"] {
      let view = VectorPreviewView(frame: .zero)
      let value = input(source)
      let sizing = PreviewSizingState()
      sizing.bind(view)
      view.configure(value)
      attach(view, to: window)
      let fit = try XCTUnwrap(view.fit)
      let natural = try XCTUnwrap(view.naturalSize)
      XCTAssertEqual(fit.contentRect.width, natural.width * fit.scale, accuracy: 0.000001)
      XCTAssertEqual(fit.contentRect.height, natural.height * fit.scale, accuracy: 0.000001)
      let radius = try XCTUnwrap(sizing.recoveredCornerRadius(for: value))
      XCTAssertEqual(radius, value.cornerRadius * fit.scale)
      XCTAssertEqual(radius, view.layer.cornerRadius)
      XCTAssertEqual(sizing.recoveredSize(for: value), fit.size)
      XCTAssertEqual(view.accessibilityLabel, source)
      let outer = RoundedRectangle(cornerRadius: radius, style: .continuous)
        .path(in: CGRect(origin: .zero, size: fit.size))
      let vector = RoundedRectangle(cornerRadius: value.cornerRadius, style: .continuous)
        // The padded outer canvas is distinct from the unchanged TextKit body.
        .path(in: CGRect(origin: .zero, size: CGSize(width: fit.size.width / fit.scale, height: fit.size.height / fit.scale)))
        .applying(CGAffineTransform(scaleX: fit.scale, y: fit.scale))
      // Compare shape containment in the fitted coordinate space. This tests
      // the app-owned outline, not UIKit's live context-menu compositor.
      let cornerExtent = min(fit.size.width / 2, min(fit.size.height / 2, radius * 2))
      for x in 0..<20 {
        for y in 0..<20 {
          let dx = cornerExtent * (CGFloat(x) + 0.5) / 20
          let dy = cornerExtent * (CGFloat(y) + 0.5) / 20
          for point in [CGPoint(x: dx, y: dy), CGPoint(x: fit.size.width - dx, y: dy),
            CGPoint(x: dx, y: fit.size.height - dy), CGPoint(x: fit.size.width - dx, y: fit.size.height - dy)] {
            XCTAssertEqual(outer.contains(point), vector.contains(point))
          }
        }
      }
      view.removeFromSuperview()
      view.dispose()
    }
  }

  @MainActor
  func testMediumLongAndExtremeTextHaveFullCoverageAndScaledBounds() throws {
    let window = try testWindow()
    defer { close(window) }
    for count in [40, 1400, 5000] {
      let source = String(repeating: "نَصّ عربي + API 👨‍👩‍👧‍👦\r\n\tline\n", count: count)
        + "PYTHAGORAS_LONG_MESSAGE_END_2026\r\n  "
      let view = VectorPreviewView(frame: .zero)
      view.configure(input(source))
      attach(view, to: window)
      let size = view.fittedSize(proposal: ProposedViewSize(width: 390, height: 760))
      let fit = try XCTUnwrap(view.fit) // created only after full TextKit character coverage
      let natural = try XCTUnwrap(view.naturalSize)
      XCTAssertEqual(view.accessibilityLabel, source)
      XCTAssertTrue(size.width.isFinite && size.height.isFinite)
      XCTAssertGreaterThan(size.width, 0)
      XCTAssertGreaterThan(size.height, 0)
      XCTAssertEqual(size.width, natural.width * fit.scale + fit.opticalInsets.width * 2, accuracy: 0.000001)
      XCTAssertEqual(size.height, natural.height * fit.scale + fit.opticalInsets.height * 2, accuracy: 0.000001)
      XCTAssertEqual(view.intrinsicContentSize, size)
      XCTAssertLessThanOrEqual(fit.scale, 1)
      view.dispose()
      view.removeFromSuperview()
    }
  }

  @MainActor
  func testTrialProposalsDoNotChangeAnOpenSnapshot() throws {
    let window = try testWindow()
    let view = VectorPreviewView(frame: .zero)
    defer { view.dispose(); close(window) }
    view.configure(input(String(repeating: "سطر عربي\n", count: 80)))
    attach(view, to: window)
    let first = view.fittedSize(proposal: ProposedViewSize(width: 390, height: 760))
    let original = try XCTUnwrap(view.naturalSize)
    for proposal in [ProposedViewSize.unspecified, ProposedViewSize.zero,
      ProposedViewSize(width: 1, height: 1), ProposedViewSize(width: 999999, height: 999999)] {
      XCTAssertEqual(view.fittedSize(proposal: proposal), first)
    }
    view.configure(input(String(repeating: "سطر عربي\n", count: 80)))
    XCTAssertEqual(try XCTUnwrap(view.naturalSize), original)
    XCTAssertEqual(view.fittedSize(proposal: .unspecified), first)
  }

  @MainActor
  func testActualArabicGlyphBoundsStayOutsideOpticalCapsAndKeepTheEndMarker() throws {
    let window = try testWindow()
    defer { close(window) }
    for category in [UIContentSizeCategory.large, .accessibilityLarge] {
      let source = "بداية نَصّ عربي\n" + String(repeating: "نَصّ عربي + API 👨‍👩‍👧‍👦\r\n", count: 1600)
        + "PYTHAGORAS_LONG_MESSAGE_END_2026\n\n"
      let view = VectorPreviewView(frame: .zero)
      view.configure(input(source, category: category))
      attach(view, to: window)
      let fit = try XCTUnwrap(view.fit)
      let glyphs = try XCTUnwrap(view.fittedGlyphBounds)
      let pixel = 1 / window.screen.scale
      XCTAssertGreaterThan(fit.opticalInsets.height, 0)
      XCTAssertGreaterThanOrEqual(glyphs.minY, fit.size.width + pixel)
      XCTAssertGreaterThanOrEqual(fit.size.height - glyphs.maxY, fit.size.width + pixel)
      XCTAssertGreaterThanOrEqual(glyphs.minX, fit.contentRect.minX)
      XCTAssertLessThanOrEqual(glyphs.maxX, fit.contentRect.maxX)
      XCTAssertEqual(view.accessibilityLabel, source)
      XCTAssertEqual(view.intrinsicContentSize, fit.size)
      for proposal in [ProposedViewSize.unspecified, .zero, ProposedViewSize(width: 1, height: 1)] {
        XCTAssertEqual(view.fittedSize(proposal: proposal), fit.size)
        XCTAssertEqual(view.fit, fit)
        XCTAssertEqual(view.fittedGlyphBounds, glyphs)
      }
      view.removeFromSuperview()
      view.dispose()
    }
  }

  @MainActor
  func testNativePropsUseDebugOverridesAndReleaseDefaults() {
    let props = FittedUserMessageProps()
    props.sideSafetyPixels = -CGFloat.infinity
    props.endSafetyWidthFactor = -1
    props.endSafetyExtraPixels = 1000000
    props.narrowEligibilityFactor = .nan
    XCTAssertEqual(props.activeOpticalTuning, .defaults)
    props.sideSafetyPixels = 2
    props.endSafetyWidthFactor = 1.5
    props.endSafetyExtraPixels = 6
    props.narrowEligibilityFactor = 3
    #if DEBUG
    XCTAssertEqual(props.activeOpticalTuning, .validated(sideSafetyPixels: 2,
      endSafetyWidthFactor: 1.5, endSafetyExtraPixels: 6, narrowEligibilityFactor: 3))
    #else
    XCTAssertEqual(props.activeOpticalTuning, .defaults)
    #endif
  }

  @MainActor
  func testChangedTuningInvalidatesFitOnTheSameNativeView() throws {
    let window = try testWindow()
    let view = VectorPreviewView(frame: .zero)
    defer { view.dispose(); close(window) }
    let source = String(repeating: "نَصّ عربي + API 👨‍👩‍👧‍👦\n", count: 1600) + "PYTHAGORAS_LONG_MESSAGE_END_2026\n"
    let original = input(source)
    let sizing = PreviewSizingState()
    sizing.bind(view)
    view.configure(original)
    attach(view, to: window)
    let before = try XCTUnwrap(view.fit)
    var changed = original
    changed.opticalTuning = .validated(sideSafetyPixels: 2, endSafetyWidthFactor: 1.5,
      endSafetyExtraPixels: 6, narrowEligibilityFactor: 3)
    XCTAssertNotEqual(changed, original)
    view.configure(changed)
    XCTAssertNil(view.fit)
    XCTAssertNil(sizing.recoveredSize(for: changed)) // old recovery cannot own new props
    let size = view.fittedSize(proposal: .unspecified)
    let after = try XCTUnwrap(view.fit)
    XCTAssertNotEqual(after, before)
    XCTAssertEqual(view.accessibilityLabel, source)
    view.setNeedsLayout()
    view.layoutIfNeeded()
    XCTAssertEqual(sizing.recoveredSize(for: changed), size)
    view.configure(changed)
    XCTAssertEqual(view.fit, after)
    XCTAssertEqual(view.fittedSize(proposal: ProposedViewSize(width: 1, height: 1)), size)
  }

  @MainActor
  func testDetachReattachAndChangedStyle() throws {
    let window = try testWindow()
    let view = VectorPreviewView(frame: .zero)
    defer { view.dispose(); close(window) }
    view.configure(input("مرحبا"))
    attach(view, to: window)
    let original = try XCTUnwrap(view.naturalSize)
    view.removeFromSuperview()
    XCTAssertNil(view.fit)
    XCTAssertNil(view.naturalSize)
    XCTAssertEqual(view.intrinsicContentSize, .zero)
    view.configure(input("مرحبا", category: .accessibilityLarge))
    attach(view, to: window)
    _ = view.fittedSize(proposal: ProposedViewSize(width: 390, height: 760))
    XCTAssertNotEqual(try XCTUnwrap(view.naturalSize), original)
    let larger = try XCTUnwrap(view.naturalSize)
    // SwiftUI may retain the same UIKit view/window between appearances.
    view.endPresentation()
    XCTAssertNil(view.fit)
    var changed = input("مرحبا", category: .accessibilityLarge)
    changed = PreviewInput(source: changed.source, logicalMaxWidth: changed.logicalMaxWidth,
      foreground: .black, background: .white, border: .gray, rtl: changed.rtl,
      fontStyle: changed.fontStyle, lineSpacing: changed.lineSpacing,
      horizontalPadding: changed.horizontalPadding, verticalPadding: changed.verticalPadding,
      borderWidth: changed.borderWidth, cornerRadius: changed.cornerRadius,
      category: changed.category, appearance: .light)
    view.configure(changed)
    view.beginPresentation()
    XCTAssertEqual(view.naturalSize, larger)
    XCTAssertNotNil(view.fit)
    window.frame.size = CGSize(width: 700, height: 390)
    window.layoutIfNeeded()
    view.setNeedsLayout()
    view.layoutIfNeeded()
    XCTAssertEqual(view.intrinsicContentSize, view.fittedSize(proposal: .unspecified))
    XCTAssertNotNil(view.fit)
    view.endPresentation()
    let newSource = "New source\nنَصّ 👨‍👩‍👧‍👦\nPYTHAGORAS_LONG_MESSAGE_END_2026\n\n"
    view.configure(input(newSource))
    view.beginPresentation()
    XCTAssertEqual(view.accessibilityLabel, newSource)
    XCTAssertNotEqual(view.naturalSize, larger)
  }

  @MainActor
  func testUnspecifiedAndNonfiniteQueriesCannotProduceInfiniteBounds() throws {
    let window = try testWindow()
    let view = VectorPreviewView(frame: .zero)
    defer { view.dispose(); close(window) }
    view.configure(input("مرحبا"))
    attach(view, to: window)
    for proposal in [ProposedViewSize.unspecified, ProposedViewSize(width: .infinity, height: .nan)] {
      let size = view.fittedSize(proposal: proposal)
      XCTAssertTrue(size.width.isFinite && size.height.isFinite)
    }
  }

  @MainActor
  func testUnavailableSizingRecoversAfterAttachment() throws {
    let view = VectorPreviewView(frame: .zero)
    view.allowsKeyWindowFallback = false
    view.configure(input("مرحبا\nEND\n\n"))
    XCTAssertEqual(view.fittedSize(proposal: .unspecified), .zero)
    XCTAssertEqual(view.intrinsicContentSize, .zero)
    XCTAssertNil(view.fit)
    let sizing = PreviewSizingState()
    sizing.bind(view)
    let window = try testWindow()
    defer { view.dispose(); close(window) }
    attach(view, to: window)
    let fit = try XCTUnwrap(view.fit)
    XCTAssertEqual(sizing.recoveredSize(for: input("مرحبا\nEND\n\n")), fit.size)
    XCTAssertEqual(view.intrinsicContentSize, fit.size)
    view.removeFromSuperview()
    XCTAssertNil(view.fit)
    attach(view, to: window)
    XCTAssertEqual(view.fit, fit)
  }

  @MainActor
  func testRepresentableRecoversThroughSwiftUILayout() throws {
    let host = UIHostingController(rootView: FittedPreviewSurface(input: input("مرحبا"), allowsKeyWindowFallback: false))
    host.loadViewIfNeeded()
    let early = host.sizeThatFits(in: CGSize(width: 390, height: 844))
    XCTAssertEqual(early, .zero)
    let window = try testWindow(root: host)
    defer { close(window) }
    // This exercises the real represented view + observed SwiftUI frame, not
    // just VectorPreviewView.fittedSize or an ambient runner window.
    host.view.setNeedsLayout()
    host.view.layoutIfNeeded()
    let recovered = host.sizeThatFits(in: CGSize(width: 390, height: 844))
    XCTAssertGreaterThan(recovered.width, 0)
    XCTAssertGreaterThan(recovered.height, 0)
    func find(_ root: UIView) -> VectorPreviewView? {
      if let preview = root as? VectorPreviewView { return preview }
      return root.subviews.lazy.compactMap { find($0) }.first
    }
    let view = try XCTUnwrap(find(host.view))
    XCTAssertEqual(recovered, try XCTUnwrap(view.fit).size)
    XCTAssertEqual(view.intrinsicContentSize, recovered)
    host.view.layoutIfNeeded()
    XCTAssertEqual(view.bounds.size, recovered)
  }

  @MainActor
  func testAttachedZeroWindowCanAcquireUsableGeometry() throws {
    let window = try testWindow()
    window.frame = .zero
    window.layoutIfNeeded()
    let view = VectorPreviewView(frame: .zero)
    let source = input("مرحبا\nEND\n\n")
    view.configure(source)
    let sizing = PreviewSizingState()
    sizing.bind(view)
    defer { view.dispose(); close(window) }
    attach(view, to: window)
    XCTAssertEqual(view.intrinsicContentSize, .zero)
    XCTAssertNil(view.fit)
    XCTAssertNil(sizing.recoveredSize(for: source))
    window.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
    window.layoutIfNeeded()
    view.setNeedsLayout()
    view.layoutIfNeeded()
    let recovered = try XCTUnwrap(view.fit).size
    XCTAssertGreaterThan(recovered.height, 0)
    XCTAssertEqual(sizing.recoveredSize(for: source), recovered)
    XCTAssertEqual(view.intrinsicContentSize, recovered)
  }
}
