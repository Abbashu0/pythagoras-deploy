import Foundation

struct FittedPreviewGeometry: Equatable {
  let scale: CGFloat
  let size: CGSize

  static func positiveFinite(_ value: CGFloat?) -> CGFloat? {
    guard let value, value.isFinite, value > 0 else { return nil }
    return value
  }

  /// Approximation, NOT a UIKit menu measurement. Reserve at least 35% of the
  /// actual safe viewport, or a 44pt minimum action / three Dynamic Type body
  /// line heights plus real vertical layout margins, whichever needs more room.
  /// Transient SwiftUI trial proposals are not a trustworthy viewport.
  /// Resolve exclusively from native window geometry.
  static func budget(
    viewport: CGSize?, horizontalMargins: CGFloat, verticalMargins: CGFloat,
    menuLineHeight: CGFloat
  ) -> CGSize? {
    guard let viewport, positiveFinite(viewport.width) != nil, positiveFinite(viewport.height) != nil
      else { return nil } // unknown geometry is never unlimited space
    let resolved = viewport
    let horizontal = horizontalMargins.isFinite ? max(0, horizontalMargins) : 0
    let vertical = verticalMargins.isFinite ? max(0, verticalMargins) : 0
    let line = positiveFinite(menuLineHeight) ?? 0
    let reserve = max(resolved.height * 0.35, max(44, line * 3) + vertical)
    return CGSize(width: max(1, resolved.width - horizontal), height: max(1, resolved.height - reserve))
  }

  static func fit(natural: CGSize, available: CGSize) -> FittedPreviewGeometry? {
    guard positiveFinite(natural.width) != nil, positiveFinite(natural.height) != nil,
      positiveFinite(available.width) != nil, positiveFinite(available.height) != nil else { return nil }
    let scale = min(1, min(available.width / natural.width, available.height / natural.height))
    let size = CGSize(width: natural.width * scale, height: natural.height * scale)
    guard positiveFinite(scale) != nil, positiveFinite(size.width) != nil,
      positiveFinite(size.height) != nil else { return nil }
    return FittedPreviewGeometry(scale: scale, size: size)
  }
}
