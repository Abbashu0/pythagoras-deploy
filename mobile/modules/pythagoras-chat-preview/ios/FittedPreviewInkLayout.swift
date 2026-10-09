import SwiftUI
import CoreGraphics

/// A successful fit includes a proof against the EXACT path used by draw().
/// TextKit ink envelopes are conservative; they are not line-fragment boxes.
struct FittedPreviewInkLayout {
  let geometry: FittedPreviewGeometry
  let outline: CGPath
  let inkRects: [CGRect]
  let rasterClearance: CGFloat
  let hullVertexCount: Int
  let inkBounds: CGRect

  /// A convex clipping path contains all envelopes iff it contains their convex
  /// hull. Build once, not 4 * lineCount path queries on every search candidate.
  static func convexHull(_ rects: [CGRect]) -> [CGPoint] {
    var points: [CGPoint] = []
    for box in rects {
      points.append(CGPoint(x: box.minX, y: box.minY))
      points.append(CGPoint(x: box.maxX, y: box.minY))
      points.append(CGPoint(x: box.minX, y: box.maxY))
      points.append(CGPoint(x: box.maxX, y: box.maxY))
    }
    points.sort { (lhs: CGPoint, rhs: CGPoint) -> Bool in
      if lhs.x == rhs.x { return lhs.y < rhs.y }
      return lhs.x < rhs.x
    }
    var unique: [CGPoint] = []
    for point in points where unique.last != point { unique.append(point) }
    guard unique.count > 1 else { return unique }
    func half(_ points: [CGPoint]) -> [CGPoint] {
      var result: [CGPoint] = []
      for point in points {
        while result.count >= 2 {
          let a = result[result.count - 2], b = result[result.count - 1]
          let cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
          // Overflow is not permission to drop an unverified hull point.
          if !cross.isFinite { return points }
          if cross > 0 { break }
          result.removeLast()
        }
        result.append(point)
      }
      return result
    }
    return Array(half(unique).dropLast()) + Array(half(Array(unique.reversed())).dropLast())
  }

  static func finite(_ rect: CGRect) -> Bool {
    !rect.isNull && !rect.isInfinite && rect.width >= 0 && rect.height >= 0 &&
      [rect.minX, rect.minY, rect.maxX, rect.maxY].allSatisfy { $0.isFinite }
  }

  /// RoundedRectangle(.continuous) is convex. Containing all four corners of
  /// each expanded ink envelope therefore contains the WHOLE envelope, not
  /// merely its rectangular intersection with the canvas.
  static func contains(_ rect: CGRect, in outline: CGPath, clearance: CGFloat) -> Bool {
    guard finite(rect), clearance.isFinite, clearance >= 0 else { return false }
    let box = rect.insetBy(dx: -clearance, dy: -clearance)
    guard finite(box) else { return false }
    return [CGPoint(x: box.minX, y: box.minY), CGPoint(x: box.maxX, y: box.minY),
      CGPoint(x: box.minX, y: box.maxY), CGPoint(x: box.maxX, y: box.maxY)]
      .allSatisfy { outline.contains($0, using: .winding, transform: .identity) }
  }

  static func resolve(natural: CGSize, available: CGSize, inkRects: [CGRect],
    sourceCornerRadius: CGFloat, sourceBorderWidth: CGFloat, displayScale: CGFloat,
    tuning: PreviewOpticalTuning) -> FittedPreviewInkLayout? {
    guard inkRects.allSatisfy({ finite($0) }),
      let base = FittedPreviewGeometry.fitPreview(natural: natural, available: available,
        sourceCornerRadius: sourceCornerRadius, displayScale: displayScale, tuning: tuning)
      else { return nil }
    let pixel = 1 / displayScale
    let border = sourceBorderWidth.isFinite ? max(0, sourceBorderWidth) : 0
    let hull = convexHull(inkRects)

    typealias Candidate = (geometry: FittedPreviewGeometry, outline: CGPath, clearance: CGFloat)
    func candidate(_ correction: CGFloat) -> Candidate? {
      let insets = CGSize(width: base.opticalInsets.width + correction,
        height: base.opticalInsets.height + correction)
      let inner = CGSize(width: available.width - 2 * insets.width,
        height: available.height - 2 * insets.height)
      guard let body = FittedPreviewGeometry.fit(natural: natural, available: inner) else { return nil }
      let geometry = FittedPreviewGeometry(scale: body.scale,
        size: CGSize(width: body.size.width + 2 * insets.width,
          height: body.size.height + 2 * insets.height), opticalInsets: insets)
      let canvas = CGRect(origin: .zero, size: geometry.size)
      let outline = RoundedRectangle(cornerRadius: geometry.scaledCornerRadius(sourceCornerRadius),
        style: .continuous).path(in: canvas).cgPath
      // One physical pixel covers raster support; full stroke width also keeps
      // the ink clear of the app's inset border. No width-proportional cap band.
      let clearance = pixel + border * geometry.scale
      let transform = CGAffineTransform(scaleX: geometry.scale, y: geometry.scale)
        .concatenating(CGAffineTransform(translationX: insets.width, y: insets.height))
      guard hull.allSatisfy({ contains(CGRect(origin: $0.applying(transform), size: .zero),
        in: outline, clearance: clearance) })
        else { return nil }
      return (geometry, outline, clearance)
    }

    func finish(_ verified: Candidate) -> FittedPreviewInkLayout? {
      let geometry = verified.geometry
      let transform = CGAffineTransform(scaleX: geometry.scale, y: geometry.scale)
        .concatenating(CGAffineTransform(translationX: geometry.opticalInsets.width, y: geometry.opticalInsets.height))
      // Allocate fitted envelopes ONCE after discovery/refinement. The union
      // provides O(1) rectangular host-bounds checks on later drawing calls.
      let transformed = inkRects.map { $0.applying(transform) }
      // One final O(n) audit against the actual path catches hull/numerical
      // mistakes; the repeated search does not pay this cost per candidate.
      guard transformed.allSatisfy({ contains($0, in: verified.outline, clearance: verified.clearance) })
        else { return nil }
      return FittedPreviewInkLayout(geometry: geometry, outline: verified.outline,
        inkRects: transformed, rasterClearance: verified.clearance, hullVertexCount: hull.count,
        inkBounds: transformed.reduce(CGRect.null) { $0.union($1) })
    }

    if let unchanged = candidate(0) { return finish(unchanged) }
    let cornerExtent = min(base.scaledCornerRadius(sourceCornerRadius), min(base.size.width, base.size.height) / 2)
    let preferred = cornerExtent * 2 + pixel + border * base.scale
    let spaceLimit = min(available.width / 2 - base.opticalInsets.width,
      available.height / 2 - base.opticalInsets.height)
    for probe in PreviewCorrectionSearch.probes(preferred: preferred, spaceLimit: spaceLimit) {
      guard var valid = candidate(probe) else { continue }
      var low: CGFloat = 0, high = probe
      // Retain ONLY verified candidates. Refinement does not assume global
      // monotonicity/completeness of arbitrary valid intervals.
      for _ in 0..<PreviewCorrectionSearch.refinementSteps {
        let midpoint = (low + high) / 2
        if let next = candidate(midpoint) { high = midpoint; valid = next }
        else { low = midpoint }
      }
      return finish(valid)
    }
    return nil // no verified candidate; not a mathematical impossibility proof
  }

  /// Actual UIView bounds may be pixel-rounded by its host. Do not silently
  /// accept a canvas that would cut ink after the existing centered placement.
  func containsInk(in bounds: CGRect) -> Bool {
    guard Self.finite(bounds), bounds.width > 0, bounds.height > 0 else { return false }
    let dx = bounds.midX - geometry.size.width / 2
    let dy = bounds.midY - geometry.size.height / 2
    guard !inkBounds.isNull else { return true } // legitimate whitespace-only ink
    return bounds.contains(inkBounds.offsetBy(dx: dx, dy: dy)
      .insetBy(dx: -rasterClearance, dy: -rasterClearance))
  }
}
