import Foundation

/// Small optical policy, normalized before it enters a preview cache key.
struct PreviewOpticalTuning: Equatable {
  let opticalSafetyEnabled: Bool
  let sideSafetyPixels: CGFloat
  let endSafetyWidthFactor: CGFloat
  let endSafetyExtraPixels: CGFloat
  let narrowEligibilityFactor: CGFloat

  static let defaults = PreviewOpticalTuning(opticalSafetyEnabled: true,
    sideSafetyPixels: 1, endSafetyWidthFactor: 1, endSafetyExtraPixels: 3,
    narrowEligibilityFactor: 2)

  private init(opticalSafetyEnabled: Bool, sideSafetyPixels: CGFloat,
    endSafetyWidthFactor: CGFloat, endSafetyExtraPixels: CGFloat, narrowEligibilityFactor: CGFloat) {
    self.opticalSafetyEnabled = opticalSafetyEnabled
    self.sideSafetyPixels = sideSafetyPixels
    self.endSafetyWidthFactor = endSafetyWidthFactor
    self.endSafetyExtraPixels = endSafetyExtraPixels
    self.narrowEligibilityFactor = narrowEligibilityFactor
  }

  static func validated(
    opticalSafetyEnabled: Bool = PreviewOpticalTuning.defaults.opticalSafetyEnabled,
    sideSafetyPixels: CGFloat = PreviewOpticalTuning.defaults.sideSafetyPixels,
    endSafetyWidthFactor: CGFloat = PreviewOpticalTuning.defaults.endSafetyWidthFactor,
    endSafetyExtraPixels: CGFloat = PreviewOpticalTuning.defaults.endSafetyExtraPixels,
    narrowEligibilityFactor: CGFloat = PreviewOpticalTuning.defaults.narrowEligibilityFactor
  ) -> PreviewOpticalTuning {
    PreviewOpticalTuning(opticalSafetyEnabled: opticalSafetyEnabled,
      sideSafetyPixels: bounded(sideSafetyPixels, maximum: 8, fallback: defaults.sideSafetyPixels),
      endSafetyWidthFactor: bounded(endSafetyWidthFactor, maximum: 4, fallback: defaults.endSafetyWidthFactor),
      endSafetyExtraPixels: bounded(endSafetyExtraPixels, maximum: 32, fallback: defaults.endSafetyExtraPixels),
      narrowEligibilityFactor: bounded(narrowEligibilityFactor, maximum: 8, fallback: defaults.narrowEligibilityFactor))
  }

  private static func bounded(_ value: CGFloat, maximum: CGFloat, fallback: CGFloat) -> CGFloat {
    value.isFinite && value >= 0 && value <= maximum ? value : fallback
  }

  func insets(baseWidth: CGFloat, pixel: CGFloat) -> CGSize {
    CGSize(width: pixel * sideSafetyPixels,
      height: baseWidth * endSafetyWidthFactor + pixel * endSafetyExtraPixels)
  }
}

struct FittedPreviewGeometry: Equatable {
  let scale: CGFloat
  let size: CGSize
  /// Symmetric, fitted-space safety margins. Unlike text padding these do not
  /// disappear when a very tall source is uniformly scaled down.
  let opticalInsets: CGSize

  init(scale: CGFloat, size: CGSize, opticalInsets: CGSize = .zero) {
    self.scale = scale
    self.size = size
    self.opticalInsets = opticalInsets
  }

  var contentRect: CGRect {
    CGRect(x: opticalInsets.width, y: opticalInsets.height,
      width: max(0, size.width - opticalInsets.width * 2),
      height: max(0, size.height - opticalInsets.height * 2))
  }

  /// The presentation outline must use the same scale as the vector bubble.
  /// Applying the unscaled source radius to a miniature can turn it into a capsule.
  func scaledCornerRadius(_ cornerRadius: CGFloat) -> CGFloat {
    let radius = cornerRadius.isFinite ? max(0, cornerRadius) : 0
    return radius * scale
  }

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

  /// Only scaled, cap-sized strips need extra optical clearance. Reserve it
  /// BEFORE the final fit; never shift text into an unreported larger frame.
  static func fitPreview(
    natural: CGSize, available: CGSize, sourceCornerRadius: CGFloat,
    displayScale: CGFloat, tuning: PreviewOpticalTuning = .defaults
  ) -> FittedPreviewGeometry? {
    guard let base = fit(natural: natural, available: available),
      positiveFinite(displayScale) != nil,
      let pixel = positiveFinite(1 / displayScale) else { return nil }
    let radius = sourceCornerRadius.isFinite ? max(0, sourceCornerRadius) : 0
    let needsOpticalSafety = tuning.opticalSafetyEnabled && base.scale < 1 && base.size.width <= radius * tuning.narrowEligibilityFactor
    guard needsOpticalSafety else { return base }
    // Defaults: one physical pixel at each side. Each end clears the largest possible
    // resulting width (a conservative continuous-cap band), plus one pixel:
    // finalWidth <= baseWidth + 2 * pixel, so endInset >= finalWidth + pixel.
    var insets = tuning.insets(baseWidth: base.size.width, pixel: pixel)
    if insets.width * 2 >= available.width || insets.height * 2 >= available.height {
      // Oversized experiments cannot collapse an otherwise valid preview.
      // Resolve the stable default policy once, without another TextKit layout.
      let defaults = PreviewOpticalTuning.defaults
      guard tuning != defaults else { return nil }
      guard defaults.opticalSafetyEnabled && base.scale < 1 && base.size.width <= radius * defaults.narrowEligibilityFactor else { return base }
      insets = defaults.insets(baseWidth: base.size.width, pixel: pixel)
      guard insets.width * 2 < available.width && insets.height * 2 < available.height else { return nil }
    }
    let innerAvailable = CGSize(width: available.width - insets.width * 2,
      height: available.height - insets.height * 2)
    guard let content = fit(natural: natural, available: innerAvailable) else { return nil }
    let outerSize = CGSize(width: min(available.width, content.size.width + insets.width * 2),
      height: min(available.height, content.size.height + insets.height * 2))
    return FittedPreviewGeometry(scale: content.scale, size: outerSize, opticalInsets: insets)
  }
}
