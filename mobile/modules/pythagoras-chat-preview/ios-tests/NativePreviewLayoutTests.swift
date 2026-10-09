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
      XCTAssertEqual(view.layer.cornerRadius, 0) // no independent rounded layer mask
      XCTAssertNotNil(view.inkLayout)
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
      var diagnostic = input(source, category: category)
      diagnostic.opticalTuning = .validated(opticalSafetyEnabled: true)
      view.configure(diagnostic)
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
    props.opticalSafetyEnabled = true
    props.endSafetyWidthFactor = 1.5
    props.endSafetyExtraPixels = 6
    props.narrowEligibilityFactor = 3
    #if DEBUG
    XCTAssertEqual(props.activeOpticalTuning, .validated(opticalSafetyEnabled: true, sideSafetyPixels: 2,
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
    changed.opticalTuning = .validated(opticalSafetyEnabled: true, sideSafetyPixels: 2, endSafetyWidthFactor: 1.5,
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
    XCTAssertEqual(view.fitStatus, .unavailableGeometry)
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
    let timings = DiagnosticTimings()
    var diagnosticWindow: UIWindow?
    var sequence = 0
    func find(_ root: UIView) -> VectorPreviewView? {
      if let preview = root as? VectorPreviewView { return preview }
      return root.subviews.lazy.compactMap { find($0) }.first
    }
    func record(_ stage: String, hostSize: CGSize? = nil, intrinsic: CGSize? = nil) {
      sequence += 1
      var data: [String: Any] = ["kind": "swiftui-sizing", "stage": stage,
        "sequence": sequence, "elapsedSeconds": timings.elapsed]
      if let window = diagnosticWindow {
        data["windowFrame"] = diagnosticRect(window.frame)
        data["windowBounds"] = diagnosticRect(window.bounds)
        data["windowSafeAreaInsets"] = diagnosticInsets(window.safeAreaInsets)
        data["windowSafeLayoutFrame"] = diagnosticRect(window.safeAreaLayoutGuide.layoutFrame)
        data["windowLayoutMargins"] = diagnosticInsets(window.layoutMargins)
      }
      if let root = host.viewIfLoaded {
        data["rootBounds"] = diagnosticRect(root.bounds)
        data["rootSafeAreaInsets"] = diagnosticInsets(root.safeAreaInsets)
        data["rootAdditionalSafeAreaInsets"] = diagnosticInsets(host.additionalSafeAreaInsets)
        if let view = find(root) {
          data["representedBounds"] = diagnosticRect(view.bounds)
          data["representedBoundsInRoot"] = diagnosticRect(view.convert(view.bounds, to: root))
          if let window = diagnosticWindow {
            data["representedBoundsInWindow"] = diagnosticRect(view.convert(view.bounds, to: window))
          }
          data["fitStatus"] = String(describing: view.fitStatus)
          if let fit = view.fit {
            data["verifiedFitSize"] = diagnosticSize(fit.size)
            if let hostSize {
              data["hostMinusFit"] = diagnosticSize(CGSize(width: hostSize.width - fit.size.width,
                height: hostSize.height - fit.size.height))
            }
          }
        }
        if let hostSize {
          // Diagnostic arithmetic ONLY, not a new expected size or an assertion.
          // UIView.convert above puts the actual child bounds in the root/window
          // spaces; this subtraction exposes possible root safe-area accounting.
          let safe = root.safeAreaInsets
          data["hostSizeLessRootSafeInsetsDiagnosticOnly"] = diagnosticSize(CGSize(
            width: hostSize.width - safe.left - safe.right,
            height: hostSize.height - safe.top - safe.bottom))
        }
      }
      if let hostSize { data["hostingSizeThatFits"] = diagnosticSize(hostSize) }
      if let intrinsic { data["representedIntrinsicSize"] = diagnosticSize(intrinsic) }
      emitDiagnostic(data)
    }
    defer { emitDiagnostic(["kind": "swiftui-sizing-timings", "seconds": timings.seconds,
      "totalSeconds": timings.elapsed]) }
    record("before-load")
    timings.measure("load") { host.loadViewIfNeeded() }
    record("after-load-before-early-query")
    let early = timings.measure("early-host-size-query") { host.sizeThatFits(in: CGSize(width: 390, height: 844)) }
    record("after-early-query", hostSize: early)
    XCTAssertEqual(early, .zero)
    record("before-window-attachment-and-fixture-layout")
    let window = try timings.measure("window-attachment-and-fixture-layout") { try testWindow(root: host) }
    diagnosticWindow = window
    defer { timings.measure("window-cleanup") { close(window) } }
    record("after-window-attachment-and-fixture-layout")
    // This exercises the real represented view + observed SwiftUI frame, not
    // just VectorPreviewView.fittedSize or an ambient runner window.
    host.view.setNeedsLayout()
    record("before-explicit-host-layout")
    timings.measure("explicit-host-layout") { host.view.layoutIfNeeded() }
    record("after-explicit-host-layout-before-recovery-query")
    let recovered = timings.measure("recovered-host-size-query") { host.sizeThatFits(in: CGSize(width: 390, height: 844)) }
    record("after-recovery-query", hostSize: recovered)
    XCTAssertGreaterThan(recovered.width, 0)
    XCTAssertGreaterThan(recovered.height, 0)
    let view = try XCTUnwrap(find(host.view))
    XCTAssertEqual(recovered, try XCTUnwrap(view.fit).size)
    XCTAssertEqual(view.intrinsicContentSize, recovered)
    // This read follows the original intrinsic assertion and reuses its valid
    // cached fit; no extra sizeThatFits/window/layout request is introduced.
    record("after-original-fit-and-intrinsic-assertions", hostSize: recovered, intrinsic: view.intrinsicContentSize)
    timings.measure("final-host-layout") { host.view.layoutIfNeeded() }
    record("after-final-host-layout", hostSize: recovered)
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

  @MainActor
  func testRectangleContainmentDoesNotProveRoundedInkContainment() throws {
    let canvas = CGRect(x: 0, y: 0, width: 30, height: 300)
    let outline = RoundedRectangle(cornerRadius: 12, style: .continuous).path(in: canvas).cgPath
    let cornerInk = CGRect(x: 0.25, y: 0.25, width: 2, height: 2)
    XCTAssertTrue(canvas.contains(cornerInk))
    XCTAssertFalse(FittedPreviewInkLayout.contains(cornerInk, in: outline, clearance: 0))
    let resolved = try XCTUnwrap(FittedPreviewInkLayout.resolve(natural: canvas.size,
      available: CGSize(width: 100, height: 400), inkRects: [cornerInk],
      sourceCornerRadius: 12, sourceBorderWidth: 0, displayScale: 3,
      tuning: .validated(opticalSafetyEnabled: false)))
    XCTAssertGreaterThan(resolved.geometry.opticalInsets.height, 0)
    XCTAssertTrue(resolved.inkRects.allSatisfy {
      FittedPreviewInkLayout.contains($0, in: resolved.outline, clearance: resolved.rasterClearance)
    })
    XCTAssertNil(FittedPreviewInkLayout.resolve(natural: canvas.size,
      available: CGSize(width: 0.1, height: 0.1), inkRects: [cornerInk],
      sourceCornerRadius: 12, sourceBorderWidth: 0, displayScale: 1,
      tuning: .validated(opticalSafetyEnabled: false)))
  }

  @MainActor
  private func raster(_ view: VectorPreviewView, scale: CGFloat, clipInk: Bool,
    throughLayer: Bool = false, capture: ((CGRect, CGAffineTransform) -> Void)? = nil) throws -> CGImage {
    let fit = try XCTUnwrap(view.fit)
    // ONLY the bounded fitted canvas is allocated, never the full source height.
    let canvas = CGSize(width: ceil(fit.size.width * scale) / scale,
      height: ceil(fit.size.height * scale) / scale)
    view.bounds = CGRect(origin: .zero, size: canvas)
    let format = UIGraphicsImageRendererFormat()
    format.scale = scale
    format.opaque = false
    format.preferredRange = .standard
    view.setNeedsDisplay()
    view.layer.displayIfNeeded()
    let image = UIGraphicsImageRenderer(size: canvas, format: format).image { output in
      capture?(view.bounds, output.cgContext.ctm)
      if throughLayer { view.layer.render(in: output.cgContext) }
      else { XCTAssertTrue(view.renderPreview(in: output.cgContext, canvas: view.bounds, clipInk: clipInk)) }
    }
    if throughLayer { XCTAssertTrue(view.lastDrawingContainedInk) }
    return try XCTUnwrap(image.cgImage)
  }

  private func assertNoLostInk(_ actual: CGImage, _ reference: CGImage,
    file: StaticString = #filePath, line: UInt = #line) throws {
    XCTAssertEqual(try lostInkPixels(actual, reference), 0,
      "App clipping/layer lost rasterized ink", file: file, line: line)
  }

  private func lostInkPixels(_ actual: CGImage, _ reference: CGImage,
    file: StaticString = #filePath, line: UInt = #line) throws -> Int {
    XCTAssertEqual(actual.width, reference.width, file: file, line: line)
    XCTAssertEqual(actual.height, reference.height, file: file, line: line)
    // Normalize both images into the SAME explicit RGBA bitmap. Compare alpha
    // support, including first/last pixels and colored emoji, not only rectangles.
    let expected = try normalizedAlpha(reference), found = try normalizedAlpha(actual)
    XCTAssertTrue(expected.contains { $0 > 0 }, "Reference must contain ink", file: file, line: line)
    // Strict comparison: do not dismiss a lost low-alpha endpoint pixel as
    // harmless rounding. Any layer-conversion mismatch must be investigated.
    let lost = zip(expected, found).filter { $0.0 > $0.1 }.count
    return lost
  }

  // Lifted unchanged from lostInkPixels so diagnostics and STRICT assertions
  // normalize through exactly the same RGBA conversion (no alpha threshold).
  private func normalizedAlpha(_ image: CGImage) throws -> [UInt8] {
    var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
    try bytes.withUnsafeMutableBytes { buffer in
      let context = try XCTUnwrap(CGContext(data: buffer.baseAddress, width: image.width,
        height: image.height, bitsPerComponent: 8, bytesPerRow: image.width * 4,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue |
          CGImageAlphaInfo.premultipliedLast.rawValue))
      context.interpolationQuality = .none
      context.draw(image, in: CGRect(x: 0, y: 0, width: CGFloat(image.width), height: CGFloat(image.height)))
    }
    return stride(from: 3, to: bytes.count, by: 4).map { bytes[$0] }
  }

  private final class DiagnosticTimings {
    private let start = ProcessInfo.processInfo.systemUptime
    private(set) var seconds: [String: Double] = [:]
    var elapsed: Double { ProcessInfo.processInfo.systemUptime - start }
    func measure<T>(_ name: String, _ block: () throws -> T) rethrows -> T {
      let before = ProcessInfo.processInfo.systemUptime
      defer { seconds[name, default: 0] += ProcessInfo.processInfo.systemUptime - before }
      return try block()
    }
  }

  private func diagnosticSize(_ size: CGSize) -> [String: Double] {
    ["width": Double(size.width), "height": Double(size.height)]
  }

  private func diagnosticPoint(_ point: CGPoint) -> [String: Double] {
    ["x": Double(point.x), "y": Double(point.y)]
  }

  private func diagnosticRect(_ rect: CGRect) -> [String: Double] {
    ["x": Double(rect.origin.x), "y": Double(rect.origin.y),
      "width": Double(rect.width), "height": Double(rect.height)]
  }

  private func diagnosticInsets(_ insets: UIEdgeInsets) -> [String: Double] {
    ["top": Double(insets.top), "left": Double(insets.left),
      "bottom": Double(insets.bottom), "right": Double(insets.right)]
  }

  private func diagnosticTransform(_ transform: CGAffineTransform) -> [String: Double] {
    ["a": Double(transform.a), "b": Double(transform.b), "c": Double(transform.c),
      "d": Double(transform.d), "tx": Double(transform.tx), "ty": Double(transform.ty)]
  }

  private func emitDiagnostic(_ data: [String: Any]) {
    do {
      let bytes = try JSONSerialization.data(withJSONObject: data, options: [.sortedKeys])
      print("NATIVE_PREVIEW_DIAGNOSTIC " + String(decoding: bytes, as: UTF8.self))
    } catch { XCTFail("Diagnostic serialization failed: \(error)") }
  }

  private struct RasterCapture {
    let image: CGImage
    let canvas: CGRect
    let ctm: CGAffineTransform
  }

  @MainActor
  private func capturedRaster(_ view: VectorPreviewView, scale: CGFloat, clipInk: Bool,
    throughLayer: Bool = false) throws -> RasterCapture {
    var captured: (CGRect, CGAffineTransform)?
    let image = try raster(view, scale: scale, clipInk: clipInk, throughLayer: throughLayer) {
      captured = ($0, $1)
    }
    let metadata = try XCTUnwrap(captured)
    return RasterCapture(image: image, canvas: metadata.0, ctm: metadata.1)
  }

  private struct RasterAxisMapping {
    let columnsIncreaseDeviceX: Bool
    let rowsIncreaseDeviceY: Bool
    func devicePoint(column: CGFloat, row: CGFloat, width: Int, height: Int) -> CGPoint {
      CGPoint(x: columnsIncreaseDeviceX ? column : CGFloat(width) - column,
        y: rowsIncreaseDeviceY ? row : CGFloat(height) - row)
    }
  }

  private enum DiagnosticError: Error {
    case invalidPixelMapping
    case incompatibleRasters
  }

  @MainActor
  private func calibratedRasterAxes() throws -> RasterAxisMapping {
    // Two unequal-alpha 1px fiducials at UIKit TOP-left and BOTTOM-left.
    // Use the SAME normalization as the comparisons. Observe, do not assume,
    // which data row/column corresponds to the renderer's device coordinates.
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = false
    format.preferredRange = .standard
    var ctm = CGAffineTransform.identity
    let image = UIGraphicsImageRenderer(size: CGSize(width: 3, height: 3), format: format).image {
      let context = $0.cgContext
      ctm = context.ctm
      context.setShouldAntialias(false)
      context.setFillColor(UIColor.white.cgColor)
      context.fill(CGRect(x: 0, y: 0, width: 1, height: 1))
      context.setFillColor(UIColor.white.withAlphaComponent(0.5).cgColor)
      context.fill(CGRect(x: 0, y: 2, width: 1, height: 1))
    }
    let alpha = try normalizedAlpha(XCTUnwrap(image.cgImage))
    let occupied = alpha.indices.filter { alpha[$0] > 0 }
    XCTAssertEqual(occupied.count, 2, "Unexpected calibration support; pixel mapping cannot be assumed")
    let top = try XCTUnwrap(occupied.first { alpha[$0] == 255 })
    let bottom = try XCTUnwrap(occupied.first { alpha[$0] != 255 })
    let topDevice = CGPoint(x: 0.5, y: 0.5).applying(ctm)
    let mapping = RasterAxisMapping(columnsIncreaseDeviceX: CGFloat(top % 3) + 0.5 == topDevice.x,
      rowsIncreaseDeviceY: CGFloat(top / 3) + 0.5 == topDevice.y)
    let mappedTop = mapping.devicePoint(column: CGFloat(top % 3) + 0.5,
      row: CGFloat(top / 3) + 0.5, width: 3, height: 3)
    let mappedBottom = mapping.devicePoint(column: CGFloat(bottom % 3) + 0.5,
      row: CGFloat(bottom / 3) + 0.5, width: 3, height: 3)
    let bottomDevice = CGPoint(x: 0.5, y: 2.5).applying(ctm)
    XCTAssertEqual(mappedTop, topDevice)
    XCTAssertEqual(mappedBottom, bottomDevice)
    emitDiagnostic(["kind": "raster-axis-calibration", "alphaRows": alpha.map { Int($0) },
      "rendererCTM": diagnosticTransform(ctm), "columnsIncreaseDeviceX": mapping.columnsIncreaseDeviceX,
      "rowsIncreaseDeviceY": mapping.rowsIncreaseDeviceY])
    guard occupied.count == 2, mappedTop == topDevice, mappedBottom == bottomDevice else {
      throw DiagnosticError.invalidPixelMapping // no unverified coordinate reporting
    }
    return mapping
  }

  private func approximateBoundary(_ path: CGPath, displayScale: CGFloat) -> [(CGPoint, CGPoint)]? {
    // Failure diagnostics ONLY. Public path flattening with a stated threshold,
    // not an analytic distance or a new clipping/acceptance policy. Bound work.
    var segments: [(CGPoint, CGPoint)] = []
    var current = CGPoint.zero, start = CGPoint.zero
    var valid = true
    let flattened = path.flattened(threshold: 1 / (displayScale * 64))
    flattened.applyWithBlock { pointer in
      let element = pointer.pointee
      switch element.type {
      case .moveToPoint: current = element.points[0]; start = current
      case .addLineToPoint:
        if segments.count < 4096 { segments.append((current, element.points[0])) }
        else { valid = false }
        current = element.points[0]
      case .closeSubpath:
        if segments.count < 4096 { segments.append((current, start)) }
        else { valid = false }
        current = start
      default: valid = false // never guess a distance from unflattened curves
      }
    }
    return valid && !segments.isEmpty ? segments : nil
  }

  private func distance(_ point: CGPoint, to segments: [(CGPoint, CGPoint)]) -> CGFloat {
    var minimum = CGFloat.infinity
    for (a, b) in segments {
      let dx = b.x - a.x, dy = b.y - a.y
      let squared = dx * dx + dy * dy
      let projection = squared > 0 ? ((point.x - a.x) * dx + (point.y - a.y) * dy) / squared : 0
      let t = min(1, max(0, projection))
      minimum = min(minimum, hypot(point.x - a.x - t * dx, point.y - a.y - t * dy))
    }
    return minimum
  }

  private func rasterComparison(_ actual: RasterCapture, reference: RasterCapture,
    kind: String, axes: RasterAxisMapping, layout: FittedPreviewInkLayout,
    displayScale: CGFloat, timings: DiagnosticTimings) throws -> (record: [String: Any], differs: Bool) {
    XCTAssertEqual(actual.image.width, reference.image.width)
    XCTAssertEqual(actual.image.height, reference.image.height)
    XCTAssertEqual(actual.canvas, reference.canvas)
    XCTAssertEqual(actual.ctm, reference.ctm)
    let determinant = reference.ctm.a * reference.ctm.d - reference.ctm.b * reference.ctm.c
    guard actual.image.width == reference.image.width, actual.image.height == reference.image.height,
      actual.canvas == reference.canvas, actual.ctm == reference.ctm,
      [reference.ctm.a, reference.ctm.b, reference.ctm.c, reference.ctm.d,
        reference.ctm.tx, reference.ctm.ty, determinant].allSatisfy({ $0.isFinite }), determinant != 0,
      reference.ctm.b == 0, reference.ctm.c == 0 else {
      // Current UIGraphics renderer CTMs are axis-aligned. Do not label an
      // AABB as the exact pixel cell if a future renderer rotates/shears it.
      throw DiagnosticError.incompatibleRasters
    }
    let expected = try timings.measure(kind + "-reference-alpha-extraction") { try normalizedAlpha(reference.image) }
    let found = try timings.measure(kind + "-actual-alpha-extraction") { try normalizedAlpha(actual.image) }
    guard expected.count == found.count else { throw DiagnosticError.incompatibleRasters }
    return timings.measure(kind + "-alpha-comparison-and-sample-geometry") {
      let width = reference.image.width, height = reference.image.height
      let offset = CGPoint(x: reference.canvas.midX - layout.geometry.size.width / 2,
        y: reference.canvas.midY - layout.geometry.size.height / 2)
      let inverse = reference.ctm.inverted()
      var lower = 0, higher = 0, samples: [[String: Any]] = []
      var boundary: [(CGPoint, CGPoint)]?
      var boundaryAttempted = false
      for index in expected.indices {
        let delta = Int(expected[index]) - Int(found[index])
        if delta > 0 { lower += 1 }
        if delta < 0 { higher += 1 }
        let shouldSample = kind == "unclipped-repeat" ? delta != 0 : delta > 0
        guard shouldSample, samples.count < 32 else { continue }
        if !boundaryAttempted {
          boundary = approximateBoundary(layout.outline, displayScale: displayScale)
          boundaryAttempted = true
        }
        let x = index % width, y = index / width
        // Normalized memory row -> calibrated device pixel -> INVERSE captured
        // renderer CTM -> UIKit canvas -> subtract production center placement.
        // Optical offsets/fit scale already belong to layout.inkRects; do not
        // apply them twice. Report centers AND whole pixel cells for overhang.
        let device = axes.devicePoint(column: CGFloat(x) + 0.5, row: CGFloat(y) + 0.5, width: width, height: height)
        let canvasPoint = device.applying(inverse)
        let fittedPoint = CGPoint(x: canvasPoint.x - offset.x, y: canvasPoint.y - offset.y)
        let deviceCorner = axes.devicePoint(column: CGFloat(x), row: CGFloat(y), width: width, height: height)
        let opposite = axes.devicePoint(column: CGFloat(x + 1), row: CGFloat(y + 1), width: width, height: height)
        let deviceRect = CGRect(x: min(deviceCorner.x, opposite.x), y: min(deviceCorner.y, opposite.y),
          width: abs(opposite.x - deviceCorner.x), height: abs(opposite.y - deviceCorner.y))
        let fittedPixel = deviceRect.applying(inverse).offsetBy(dx: -offset.x, dy: -offset.y)
        let inside = layout.outline.contains(fittedPoint, using: .winding, transform: .identity)
        var sample: [String: Any] = ["pixelColumn": x, "normalizedMemoryRow": y,
          "referenceAlpha": Int(expected[index]), "actualAlpha": Int(found[index]), "referenceMinusActualAlpha": delta,
          "canvasPoint": diagnosticPoint(canvasPoint), "fittedPoint": diagnosticPoint(fittedPoint),
          "imageTopLeftPixelCenter": diagnosticPoint(CGPoint(
            x: (canvasPoint.x - reference.canvas.minX) * displayScale,
            y: (canvasPoint.y - reference.canvas.minY) * displayScale)),
          "fittedPixelCell": diagnosticRect(fittedPixel), "insideRoundedPathAtCenter": inside,
          "pixelCellInsideRoundedPath": FittedPreviewInkLayout.contains(fittedPixel, in: layout.outline, clearance: 0),
          "intersectsTransformedInkEnvelope": layout.inkRects.contains { $0.intersects(fittedPixel) },
          "centerInsideTransformedInkEnvelope": layout.inkRects.contains { $0.contains(fittedPoint) }]
        if let boundary {
          let signed = distance(fittedPoint, to: boundary) * (inside ? 1 : -1)
          if signed.isFinite { sample["approximateSignedBoundaryDistancePoints"] = Double(signed) }
        }
        samples.append(sample)
      }
      let record: [String: Any] = ["comparison": kind, "totalPixelsInspected": expected.count,
        "lowerAlphaPixels": lower, "higherAlphaPixels": higher, "differentAlphaPixels": lower + higher,
        "sampleLimit": 32, "samples": samples, "samplePolicy": kind == "unclipped-repeat" ? "any-difference" : "lower-alpha",
        "canvasBounds": diagnosticRect(reference.canvas), "rendererCTM": diagnosticTransform(reference.ctm),
        "centerPlacementOffset": diagnosticPoint(offset), "rasterWidthPixels": width, "rasterHeightPixels": height,
        "pixelCoordinateSpace": "normalized-RGBA memory column/row; calibrated device axes; inverse renderer CTM; fittedPoint excludes center offset",
        "distanceMethod": "approximate-polyline; positive-inside; flatten-threshold=1/64-display-pixel; max-4096-segments; absent-if-unavailable"]
      return (record, lower + higher > 0)
    }
  }

  @MainActor
  func testRasterLossProbeRejectsAnExtraUnverifiedMask() throws {
    let window = try testWindow()
    let view = VectorPreviewView(frame: .zero, testDisplayScale: 3)
    defer { view.dispose(); close(window) }
    let value = input(String(repeating: "نَصّ عَرَبِيّ API 😀\n", count: 50))
    view.configure(PreviewInput(source: value.source, logicalMaxWidth: value.logicalMaxWidth,
      foreground: .white, background: .clear, border: .clear, rtl: value.rtl,
      fontStyle: value.fontStyle, lineSpacing: value.lineSpacing,
      horizontalPadding: value.horizontalPadding, verticalPadding: value.verticalPadding,
      borderWidth: value.borderWidth, cornerRadius: value.cornerRadius,
      category: value.category, appearance: value.appearance,
      opticalTuning: .validated(opticalSafetyEnabled: false)))
    attach(view, to: window)
    let reference = try raster(view, scale: 3, clipInk: false)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 3
    format.opaque = false
    format.preferredRange = .standard
    let damaged = UIGraphicsImageRenderer(size: view.bounds.size, format: format).image {
      // Negative control ONLY: this is not a claim about UIKit's actual mask.
      $0.cgContext.clip(to: CGRect(x: 0, y: 0, width: view.bounds.width, height: view.bounds.height / 2))
      XCTAssertTrue(view.renderPreview(in: $0.cgContext, canvas: view.bounds, clipInk: true))
    }
    XCTAssertGreaterThan(try lostInkPixels(XCTUnwrap(damaged.cgImage), reference), 0)
  }

  @MainActor
  func testActualBoundedRasterKeepsAllInkWithoutOpticalHeuristics() throws {
    let window = try testWindow()
    defer { close(window) }
    let axes = try calibratedRasterAxes()
    let paragraph = "نَصّ عَرَبِيّ بِالتَّشْكِيلِ + API 123 👨‍👩‍👧‍👦 😀\r\n\t"
    let sources = ["مرحبا", String(repeating: paragraph, count: 30),
      String(repeating: paragraph, count: 1500), String(repeating: paragraph, count: 5000)]
    let variants = ["short", "paragraphs-30", "paragraphs-1500", "paragraphs-5000"]
    for (sourceIndex, source) in sources.enumerated() {
      for scale in [CGFloat(1), CGFloat(2), CGFloat(3)] {
        for category in [UIContentSizeCategory.large, .accessibilityLarge] {
          let complete = source + "\nPYTHAGORAS_LONG_MESSAGE_END_2026\n\n"
          let utf16Length = (complete as NSString).length
          let identity = "\(variants[sourceIndex])-utf16-\(utf16Length)-scale-\(Int(scale))-\(category.rawValue)"
          try XCTContext.runActivity(named: identity) { activity in
            let timings = DiagnosticTimings()
            let failuresBefore = testRun?.failureCount ?? 0
            var data: [String: Any] = ["kind": "raster-case", "case": identity,
              "sourceVariant": variants[sourceIndex], "sourceUTF16Length": utf16Length,
              "dynamicTypeCategory": category.rawValue, "displayScale": Double(scale)]
            var images: [(String, CGImage)] = []
            var lowerAlphaDetected = false
            var referenceUnstable = false
            let view = VectorPreviewView(frame: .zero, testDisplayScale: scale)
            defer {
              timings.measure("cleanup") { view.dispose(); view.removeFromSuperview() }
              data["seconds"] = timings.seconds
              data["totalCaseSecondsBeforeEvidenceEncoding"] = timings.elapsed
              let failed = lowerAlphaDetected || (testRun?.failureCount ?? failuresBefore) > failuresBefore
              data["caseHasRecordedFailure"] = failed
              data["referenceReproducibilityMismatch"] = referenceUnstable
              // Only a failing case/comparison retains images. Reference-repeat
              // inequality is failed reproducibility evidence, NOT an excuse to
              // change the original clipping assertions. Successful cases add
              // no attachments. PNG/original quality introduces no JPEG loss.
              if failed || referenceUnstable {
                timings.measure("failure-image-attachments") {
                  for (name, image) in images {
                    let attachment = XCTAttachment(image: UIImage(cgImage: image, scale: scale, orientation: .up), quality: .original)
                    attachment.name = identity + "-" + name
                    attachment.lifetime = .keepAlways
                    activity.add(attachment)
                  }
                }
              }
              data["seconds"] = timings.seconds
              data["totalCaseSeconds"] = timings.elapsed
              emitDiagnostic(data) // one bounded summary even after thrown XCTest failures
            }
            var value = input(complete, category: category)
            value.opticalTuning = .validated(opticalSafetyEnabled: false)
            // Transparent surface/border isolates glyph ink. No bitmap snapshot is
            // added to production. Exact typography/source match production input.
            value = PreviewInput(source: value.source, logicalMaxWidth: value.logicalMaxWidth,
              foreground: .white, background: .clear, border: .clear, rtl: value.rtl,
              fontStyle: value.fontStyle, lineSpacing: value.lineSpacing,
              horizontalPadding: value.horizontalPadding, verticalPadding: value.verticalPadding,
              borderWidth: value.borderWidth, cornerRadius: value.cornerRadius,
              category: value.category, appearance: value.appearance, opticalTuning: value.opticalTuning)
            timings.measure("configure-attach-initial-fit") { view.configure(value); attach(view, to: window) }
            let verified = try XCTUnwrap(view.inkLayout)
            data["naturalSize"] = diagnosticSize(try XCTUnwrap(view.naturalSize))
            data["fittedSize"] = diagnosticSize(verified.geometry.size)
            data["uniformFitScale"] = Double(verified.geometry.scale)
            data["opticalInsets"] = diagnosticSize(verified.geometry.opticalInsets)
            data["effectiveCornerRadius"] = Double(verified.geometry.scaledCornerRadius(value.cornerRadius))
            data["rasterClearance"] = Double(verified.rasterClearance)
            data["logicalMaxWidth"] = Double(value.logicalMaxWidth)
            data["transformedInkEnvelopeCount"] = verified.inkRects.count
            data["hullVertexCount"] = verified.hullVertexCount
            XCTAssertEqual(view.accessibilityLabel, complete)
            let envelopesVerified = timings.measure("existing-envelope-assertion") {
              verified.inkRects.allSatisfy {
                FittedPreviewInkLayout.contains($0, in: verified.outline, clearance: verified.rasterClearance)
              }
            }
            XCTAssertTrue(envelopesVerified)
            data["allInkEnvelopesVerifiedInsidePath"] = envelopesVerified
            let reference = try timings.measure("unclipped-raster") { try capturedRaster(view, scale: scale, clipInk: false) }
            images.append(("unclipped-reference", reference.image))
            data["actualCanvasBounds"] = diagnosticRect(reference.canvas)
            data["centerPlacementOffset"] = diagnosticPoint(CGPoint(
              x: reference.canvas.midX - verified.geometry.size.width / 2,
              y: reference.canvas.midY - verified.geometry.size.height / 2))
            data["rendererCTM"] = diagnosticTransform(reference.ctm)
            let direct = try timings.measure("clipped-raster") { try capturedRaster(view, scale: scale, clipInk: true) }
            images.append(("app-clipped-direct", direct.image))
            // Keep the ORIGINAL render/assert ordering and zero-lost-alpha
            // assertions. Diagnostic work never substitutes for acceptance.
            try timings.measure("original-direct-alpha-extraction-and-assertion") { try assertNoLostInk(direct.image, reference.image) }
            let layer = try timings.measure("layer-raster") { try capturedRaster(view, scale: scale, clipInk: true, throughLayer: true) }
            images.append(("uiview-layer", layer.image))
            try timings.measure("original-layer-alpha-extraction-and-assertion") { try assertNoLostInk(layer.image, reference.image) }
            // Repeated reference comes AFTER the original draw/assert ordering.
            // A mismatch is recorded as instability, not excused as clip success.
            let repeated = try timings.measure("repeated-unclipped-raster") { try capturedRaster(view, scale: scale, clipInk: false) }
            images.append(("repeated-unclipped-reference", repeated.image))
            var comparisons: [[String: Any]] = []
            for (kind, actual) in [("unclipped-repeat", repeated), ("direct-CGContext", direct), ("UIView-layer", layer)] {
              let result = try rasterComparison(actual, reference: reference, kind: kind,
                axes: axes, layout: verified, displayScale: scale, timings: timings)
              comparisons.append(result.record)
              if kind == "unclipped-repeat" {
                referenceUnstable = result.differs
                data["repeatedUnclippedAlphaIdentical"] = !result.differs
              }
              else if let lower = result.record["lowerAlphaPixels"] as? Int { lowerAlphaDetected = lowerAlphaDetected || lower > 0 }
              data["comparisons"] = comparisons // retain completed evidence if a later probe throws
            }
            try timings.measure("endpoint-probes") { try assertEndpointInk(view, scale: scale) }
            XCTAssertEqual(view.fittedSize(proposal: .zero), verified.geometry.size)
            XCTAssertEqual(view.fit, verified.geometry)
          }
        }
      }
    }
  }

  @MainActor
  func testActualUndersizedCanvasCannotReportSuccessfulInkDrawing() throws {
    let window = try testWindow()
    let view = VectorPreviewView(frame: .zero)
    defer { view.dispose(); close(window) }
    view.configure(input("مرحبا\nEND"))
    attach(view, to: window)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 3
    _ = UIGraphicsImageRenderer(size: CGSize(width: 1, height: 1), format: format).image {
      XCTAssertFalse(view.renderPreview(in: $0.cgContext,
        canvas: CGRect(x: 0, y: 0, width: 1, height: 1), clipInk: true))
    }
  }

  @MainActor
  private func assertEndpointInk(_ view: VectorPreviewView, scale: CGFloat) throws {
    let layout = try XCTUnwrap(view.inkLayout)
    let source = try XCTUnwrap(view.accessibilityLabel) as NSString
    let ending = source.range(of: "PYTHAGORAS_LONG_MESSAGE_END_2026", options: .backwards)
    XCTAssertNotEqual(ending.location, NSNotFound)
    let first = try XCTUnwrap(view.fittedInkBounds(forCharacters: source.rangeOfComposedCharacterSequence(at: 0)))
    let last = try XCTUnwrap(view.fittedInkBounds(forCharacters:
      source.rangeOfComposedCharacterSequence(at: NSMaxRange(ending) - 1)))
    // Actual first/last composed-character envelopes. Whole-preview 8-bit
    // alpha alone can hide quantized details when many lines share one pixel.
    // Magnify the SAME production vector + clipping path back to natural scale
    // into small bounded crops; never allocate the natural full source image.
    let zoom = 1 / layout.geometry.scale
    for endpoint in [first, last] {
      let extent = CGSize(width: endpoint.width * zoom + 4, height: endpoint.height * zoom + 4)
      XCTAssertTrue(extent.width.isFinite && extent.height.isFinite)
      let format = UIGraphicsImageRendererFormat()
      format.scale = scale
      format.opaque = false
      format.preferredRange = .standard
      func image(clipped: Bool) throws -> CGImage {
        let output = UIGraphicsImageRenderer(size: extent, format: format).image {
          $0.cgContext.translateBy(x: 2 - endpoint.minX * zoom, y: 2 - endpoint.minY * zoom)
          $0.cgContext.scaleBy(x: zoom, y: zoom)
          // Bounds already set by raster() to a pixel-aligned output canvas.
          // Undo its center-placement offset for this exact endpoint crop.
          $0.cgContext.translateBy(x: -(view.bounds.width - layout.geometry.size.width) / 2,
            y: -(view.bounds.height - layout.geometry.size.height) / 2)
          XCTAssertTrue(view.renderPreview(in: $0.cgContext, canvas: view.bounds, clipInk: clipped))
        }
        return try XCTUnwrap(output.cgImage)
      }
      try assertNoLostInk(image(clipped: true), image(clipped: false))
    }
  }

  @MainActor
  func testConstrainedSearchLargeRadiusAndExtremeBodyHaveVerifiedFits() throws {
    for (natural, available, radius, ink) in [
      (CGSize(width: 96, height: 96), CGSize(width: 30, height: 30), CGFloat(1000000), CGRect(x: 8, y: 8, width: 80, height: 80)),
      (CGSize(width: 320, height: 1000000), CGSize(width: 16, height: 20), CGFloat(24), CGRect(x: 15, y: 11, width: 290, height: 999978)),
      (CGSize(width: 90, height: 48), CGSize(width: 300, height: 400), CGFloat(24), CGRect(x: 15, y: 11, width: 60, height: 26))
    ] {
      let result = try XCTUnwrap(FittedPreviewInkLayout.resolve(natural: natural, available: available,
        inkRects: [ink], sourceCornerRadius: radius, sourceBorderWidth: 0, displayScale: 3, tuning: .defaults))
      XCTAssertTrue(result.inkRects.allSatisfy {
        FittedPreviewInkLayout.contains($0, in: result.outline, clearance: result.rasterClearance)
      })
      XCTAssertLessThanOrEqual(result.geometry.size.width, available.width + 0.000001)
      XCTAssertLessThanOrEqual(result.geometry.size.height, available.height + 0.000001)
      XCTAssertEqual(result.geometry.contentRect.width / result.geometry.contentRect.height,
        natural.width / natural.height, accuracy: 0.000001)
      if natural.height == 48 { XCTAssertEqual(result.geometry.scale, 1) }
    }
  }

  @MainActor
  func testHullReductionKeepsEveryOriginalLineEnvelopeSafe() throws {
    let lines = (0..<5000).map { CGRect(x: 15, y: CGFloat($0) * 25 + 11, width: 290, height: 20) }
    let result = try XCTUnwrap(FittedPreviewInkLayout.resolve(natural: CGSize(width: 320, height: 125022),
      available: CGSize(width: 300, height: 400), inkRects: lines, sourceCornerRadius: 24,
      sourceBorderWidth: 0.8, displayScale: 3, tuning: .defaults))
    XCTAssertEqual(result.hullVertexCount, 4) // repeated search uses four vertices, not 5000 lines
    XCTAssertEqual(result.inkRects.count, lines.count)
    XCTAssertTrue(result.inkRects.allSatisfy {
      FittedPreviewInkLayout.contains($0, in: result.outline, clearance: result.rasterClearance)
    })
  }

  @MainActor
  func testKnownWindowFailureIsNotUnavailableGeometryOrSuccessfulEmptyFit() throws {
    let window = try testWindow()
    let view = VectorPreviewView(frame: .zero, testDisplayScale: 1)
    let sizing = PreviewSizingState()
    sizing.bind(view)
    let value = input("نَصّ كامل END")
    view.configure(value)
    defer { view.dispose(); close(window) }
    attach(view, to: window)
    XCTAssertNotNil(sizing.recoveredSize(for: value))
    XCTAssertNil(sizing.failure)
    window.frame.size.width = 1
    window.layoutIfNeeded()
    XCTAssertGreaterThan(window.safeAreaLayoutGuide.layoutFrame.width, 0)
    view.setNeedsLayout()
    view.layoutIfNeeded()
    // Positive, known viewport, but a one-point-wide canvas cannot contain ink
    // expanded by one physical pixel on EACH side. Not an attachment retry.
    XCTAssertEqual(view.fittedSize(proposal: .unspecified), .zero)
    XCTAssertEqual(view.fitStatus, .noVerifiedInkFit)
    XCTAssertNil(view.fit)
    XCTAssertNil(sizing.recoveredSize(for: value))
    XCTAssertEqual(sizing.failure, .noVerifiedInkFit)
    XCTAssertNil(view.accessibilityLabel)
    XCTAssertEqual(view.fittedSize(proposal: .zero), .zero)
    XCTAssertEqual(view.fitStatus, .noVerifiedInkFit) // failed work is not repeated
    window.frame.size.width = 390
    window.layoutIfNeeded()
    view.setNeedsLayout()
    view.layoutIfNeeded()
    XCTAssertEqual(view.fitStatus, .fitted)
    XCTAssertNotNil(sizing.recoveredSize(for: value))
    XCTAssertNil(sizing.failure)
  }
}
