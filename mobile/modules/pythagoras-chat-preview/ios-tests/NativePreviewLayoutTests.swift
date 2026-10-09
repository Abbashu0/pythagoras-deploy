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
    throughLayer: Bool = false) throws -> CGImage {
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
    func alpha(_ image: CGImage) throws -> [UInt8] {
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
    let expected = try alpha(reference), found = try alpha(actual)
    XCTAssertTrue(expected.contains { $0 > 0 }, "Reference must contain ink", file: file, line: line)
    // Strict comparison: do not dismiss a lost low-alpha endpoint pixel as
    // harmless rounding. Any layer-conversion mismatch must be investigated.
    let lost = zip(expected, found).filter { $0.0 > $0.1 }.count
    return lost
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
    let paragraph = "نَصّ عَرَبِيّ بِالتَّشْكِيلِ + API 123 👨‍👩‍👧‍👦 😀\r\n\t"
    let sources = ["مرحبا", String(repeating: paragraph, count: 30),
      String(repeating: paragraph, count: 1500), String(repeating: paragraph, count: 5000)]
    for source in sources {
      for scale in [CGFloat(1), CGFloat(2), CGFloat(3)] {
        for category in [UIContentSizeCategory.large, .accessibilityLarge] {
          let complete = source + "\nPYTHAGORAS_LONG_MESSAGE_END_2026\n\n"
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
          let view = VectorPreviewView(frame: .zero, testDisplayScale: scale)
          view.configure(value)
          attach(view, to: window)
          let verified = try XCTUnwrap(view.inkLayout)
          XCTAssertEqual(view.accessibilityLabel, complete)
          XCTAssertTrue(verified.inkRects.allSatisfy {
            FittedPreviewInkLayout.contains($0, in: verified.outline, clearance: verified.rasterClearance)
          })
          let reference = try raster(view, scale: scale, clipInk: false)
          try assertNoLostInk(raster(view, scale: scale, clipInk: true), reference)
          try assertNoLostInk(raster(view, scale: scale, clipInk: true, throughLayer: true), reference)
          try assertEndpointInk(view, scale: scale)
          XCTAssertEqual(view.fittedSize(proposal: .zero), verified.geometry.size)
          XCTAssertEqual(view.fit, verified.geometry)
          view.dispose()
          view.removeFromSuperview()
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
