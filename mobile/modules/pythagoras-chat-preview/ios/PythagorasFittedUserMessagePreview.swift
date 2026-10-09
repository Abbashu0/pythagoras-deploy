import ExpoModulesCore
import ExpoUI
import SwiftUI
import UIKit

enum PreviewFontStyle: String, Enumerable {
  case body
  var native: UIFont.TextStyle { .body }
}

final class FittedUserMessageProps: UIBaseViewProps {
  @Field var source: String = ""
  @Field var logicalMaxWidth: CGFloat = 0
  @Field var foregroundColor: UIColor = .label
  @Field var backgroundColor: UIColor = .secondarySystemBackground
  @Field var borderColor: UIColor = .separator
  @Field var direction: String = "rtl"
  @Field var fontStyle: PreviewFontStyle = .body
  @Field var lineSpacing: CGFloat = 3
  @Field var horizontalPadding: CGFloat = 15
  @Field var verticalPadding: CGFloat = 11
  @Field var borderWidth: CGFloat = 0.8
  @Field var cornerRadius: CGFloat = 24
  @Field var opticalSafetyEnabled: Bool = PreviewOpticalTuning.defaults.opticalSafetyEnabled
  @Field var sideSafetyPixels: CGFloat = PreviewOpticalTuning.defaults.sideSafetyPixels
  @Field var endSafetyWidthFactor: CGFloat = PreviewOpticalTuning.defaults.endSafetyWidthFactor
  @Field var endSafetyExtraPixels: CGFloat = PreviewOpticalTuning.defaults.endSafetyExtraPixels
  @Field var narrowEligibilityFactor: CGFloat = PreviewOpticalTuning.defaults.narrowEligibilityFactor

  var activeOpticalTuning: PreviewOpticalTuning {
    #if DEBUG
    return .validated(opticalSafetyEnabled: opticalSafetyEnabled, sideSafetyPixels: sideSafetyPixels,
      endSafetyWidthFactor: endSafetyWidthFactor, endSafetyExtraPixels: endSafetyExtraPixels,
      narrowEligibilityFactor: narrowEligibilityFactor)
    #else
    return .defaults
    #endif
  }
}

struct PythagorasFittedUserMessagePreview: ExpoSwiftUI.View {
  @ObservedObject var props: FittedUserMessageProps
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(\.colorScheme) private var colorScheme

  init(props: FittedUserMessageProps) { self.props = props }

  var body: some SwiftUI.View {
    FittedPreviewSurface(input: PreviewInput(
      source: props.source, logicalMaxWidth: props.logicalMaxWidth,
      foreground: props.foregroundColor, background: props.backgroundColor, border: props.borderColor,
      rtl: props.direction == "rtl", fontStyle: props.fontStyle.native, lineSpacing: props.lineSpacing,
      horizontalPadding: props.horizontalPadding, verticalPadding: props.verticalPadding,
      borderWidth: props.borderWidth, cornerRadius: props.cornerRadius,
      category: contentCategory(dynamicTypeSize), appearance: colorScheme == .dark ? .dark : .light,
      opticalTuning: props.activeOpticalTuning
    ))
  }
}

private func contentCategory(_ size: DynamicTypeSize) -> UIContentSizeCategory {
  switch size {
  case .xSmall: return .extraSmall
  case .small: return .small
  case .medium: return .medium
  case .large: return .large
  case .xLarge: return .extraLarge
  case .xxLarge: return .extraExtraLarge
  case .xxxLarge: return .extraExtraExtraLarge
  case .accessibility1: return .accessibilityMedium
  case .accessibility2: return .accessibilityLarge
  case .accessibility3: return .accessibilityExtraLarge
  case .accessibility4: return .accessibilityExtraExtraLarge
  case .accessibility5: return .accessibilityExtraExtraExtraLarge
  @unknown default: return .large
  }
}

struct PreviewInput: Equatable {
  let source: String
  let logicalMaxWidth: CGFloat
  let foreground: UIColor
  let background: UIColor
  let border: UIColor
  let rtl: Bool
  let fontStyle: UIFont.TextStyle
  let lineSpacing: CGFloat
  let horizontalPadding: CGFloat
  let verticalPadding: CGFloat
  let borderWidth: CGFloat
  let cornerRadius: CGFloat
  let category: UIContentSizeCategory
  let appearance: UIUserInterfaceStyle
  var opticalTuning: PreviewOpticalTuning = .defaults
}

// Local SwiftUI sizing state, never a JS event or transcript measurement.
// An explicit fitted frame makes recovery a SwiftUI layout change, rather than
// relying on UIKit intrinsic invalidation being forwarded by the representable.
final class PreviewSizingState: ObservableObject {
  private struct Recovery: Equatable {
    let input: PreviewInput
    let geometry: FittedPreviewGeometry
  }
  @Published private var recovery: Recovery?
  @Published private(set) var failure: PreviewFitStatus?
  weak var view: VectorPreviewView?

  func recoveredSize(for input: PreviewInput) -> CGSize? {
    recovery?.input == input ? recovery?.geometry.size : nil
  }

  func recoveredCornerRadius(for input: PreviewInput) -> CGFloat? {
    guard let recovery, recovery.input == input else { return nil }
    return recovery.geometry.scaledCornerRadius(input.cornerRadius)
  }

  func bind(_ view: VectorPreviewView) {
    self.view = view
    view.onSizingRecovery = { [weak self, weak view] input, size in
      guard let fit = view?.fit, fit.size == size else { return }
      // The UIView emits once per valid fit/lifecycle, including a reopen whose
      // dimensions happen to equal the prior presentation. Still invalidate it.
      self?.recovery = Recovery(input: input, geometry: fit)
      if self?.failure != nil { self?.failure = nil }
    }
    view.onSizingFailure = { [weak self, weak view] _, status in
      guard view?.fit == nil, view?.fitStatus == status else { return }
      // No older successful same-input frame may survive failed/unavailable geometry.
      if self?.recovery != nil { self?.recovery = nil }
      let failure: PreviewFitStatus? = status == .unavailableGeometry ? nil : status
      if self?.failure != failure { self?.failure = failure }
    }
  }

  func beginPresentation() { view?.beginPresentation() }

  func endPresentation() {
    view?.endPresentation()
    if recovery != nil { recovery = nil }
    if failure != nil { failure = nil }
  }
}

struct FittedPreviewSurface: SwiftUI.View {
  let input: PreviewInput
  var allowsKeyWindowFallback = true
  @StateObject private var sizing = PreviewSizingState()

  init(input: PreviewInput, allowsKeyWindowFallback: Bool = true) {
    self.input = input
    self.allowsKeyWindowFallback = allowsKeyWindowFallback
  }

  var body: some SwiftUI.View {
    let recovered = sizing.recoveredSize(for: input)
    VectorPreviewRepresentable(input: input, sizing: sizing,
      allowsKeyWindowFallback: allowsKeyWindowFallback)
      .frame(width: recovered?.width, height: recovered?.height)
      // This specifies the lift outline, NOT a guarantee about the system's
      // fully presented custom-preview mask. App ink is verified independently.
      .contentShape(.contextMenuPreview, RoundedRectangle(
        cornerRadius: sizing.recoveredCornerRadius(for: input) ?? 0, style: .continuous))
      .onAppear(perform: sizing.beginPresentation)
      .onDisappear(perform: sizing.endPresentation)
  }
}

private struct VectorPreviewRepresentable: UIViewRepresentable {
  let input: PreviewInput
  let sizing: PreviewSizingState
  let allowsKeyWindowFallback: Bool

  func makeUIView(context: Context) -> VectorPreviewView {
    let view = VectorPreviewView(frame: .zero)
    view.allowsKeyWindowFallback = allowsKeyWindowFallback
    sizing.bind(view)
    view.configure(input)
    return view
  }

  func updateUIView(_ uiView: VectorPreviewView, context: Context) {
    uiView.configure(input)
  }

  func sizeThatFits(_ proposal: ProposedViewSize, uiView: VectorPreviewView, context: Context) -> CGSize? {
    uiView.fittedSize(proposal: proposal)
  }

  static func dismantleUIView(_ uiView: VectorPreviewView, coordinator: ()) {
    uiView.dispose()
  }
}

/// The canvas bounds are the FITTED size, never the natural text height.
/// TextKit retains vector glyph layout; CGContext scales glyph drawing directly
/// into that bounded canvas. There is no full-height bitmap or hosting snapshot.
enum PreviewFitStatus: Equatable {
  case unavailableGeometry
  case invalidTextLayout
  case noVerifiedInkFit
  case fitted
  case suspended
}

final class VectorPreviewView: UIView {
  private struct WindowGeometry: Equatable {
    let identity: ObjectIdentifier
    let size: CGSize
    let safeInsets: UIEdgeInsets
    let margins: UIEdgeInsets
    let displayScale: CGFloat
  }
  // Test hosts may disable ambient fallback; production prefers its own window.
  var allowsKeyWindowFallback = true
  var onSizingRecovery: ((PreviewInput, CGSize) -> Void)?
  var onSizingFailure: ((PreviewInput, PreviewFitStatus) -> Void)?
  private var pendingInput: PreviewInput?
  private var snapshot: PreviewInput?
  private var storage: NSTextStorage?
  private var manager: NSLayoutManager?
  private var container: NSTextContainer?
  private var glyphRange = NSRange(location: 0, length: 0)
  private var glyphOrigin = CGPoint.zero
  private var naturalInkRects: [CGRect] = []
  private(set) var inkLayout: FittedPreviewInkLayout?
  private(set) var lastDrawingContainedInk = false
  private(set) var fitStatus: PreviewFitStatus = .unavailableGeometry
  // Hosted-test injection only; production always uses the actual window scale.
  private let testDisplayScale: CGFloat?
  private(set) var naturalSize: CGSize?
  private(set) var fit: FittedPreviewGeometry?
  private var measurementAttempted = false
  private var measuredWindowGeometry: WindowGeometry?
  private var presentationActive = false
  private var presentationEnded = false
  private var notifiedFit = false
  private var notifiedFailure = false

  override convenience init(frame: CGRect) {
    self.init(frame: frame, testDisplayScale: nil)
  }

  init(frame: CGRect, testDisplayScale: CGFloat?) {
    self.testDisplayScale = testDisplayScale
    super.init(frame: frame)
    backgroundColor = .clear
    isOpaque = false
    isUserInteractionEnabled = false
    clipsToBounds = true
    contentMode = .redraw
    isAccessibilityElement = true
    accessibilityTraits = .staticText
    // Only the verified CGContext path rounds/clips ink. A second implicit
    // Core Animation rounded mask has no exposed path to prove equivalence.
    layer.cornerRadius = 0
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  func configure(_ input: PreviewInput) {
    // Genuine source/style/environment changes invalidate even if SwiftUI keeps
    // the same preview host across openings. Identical updates never reset it.
    guard pendingInput != input else { return }
    resetPresentation()
    pendingInput = input
    invalidateIntrinsicContentSize()
  }

  override var intrinsicContentSize: CGSize { fittedSize(proposal: .unspecified) }

  private func measurementWindow() -> UIWindow? {
    if let window { return window }
    guard allowsKeyWindowFallback else { return nil }
    let keys = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
      .filter { $0.activationState == .foregroundActive }
      .flatMap { $0.windows }.filter { $0.isKeyWindow }
    return keys.count == 1 ? keys[0] : nil
  }

  private func safeViewport(of window: UIWindow) -> CGSize {
    let safe = window.safeAreaLayoutGuide.layoutFrame
    // Read native keyboard geometry once; install no listener and change no
    // transcript/composer inset. A hidden keyboard overlaps no safe content.
    let overlap = safe.intersection(window.keyboardLayoutGuide.layoutFrame)
    let height = overlap.isNull ? safe.height : max(0, overlap.minY - safe.minY)
    return CGSize(width: safe.width, height: height)
  }

  func fittedSize(proposal _: ProposedViewSize) -> CGSize {
    guard !presentationEnded else { return .zero }
    let currentWindow = measurementWindow()
    let geometry = currentWindow.map { windowGeometry(of: $0) }
    if measuredWindowGeometry != geometry { resetPresentation() }
    measuredWindowGeometry = geometry
    if let fit { return fit.size }
    if measurementAttempted { return .zero }
    guard let input = pendingInput else { return .zero }
    let traits = UITraitCollection(traitsFrom: [
      traitCollection, UITraitCollection(preferredContentSizeCategory: input.category),
      UITraitCollection(userInterfaceStyle: input.appearance)
    ])
    let font = UIFont.preferredFont(forTextStyle: input.fontStyle, compatibleWith: traits)
    let viewport = currentWindow.map { safeViewport(of: $0) }
    let margins = currentWindow?.layoutMargins ?? .zero
    guard let available = FittedPreviewGeometry.budget(
      viewport: viewport, horizontalMargins: margins.left + margins.right,
      verticalMargins: margins.top + margins.bottom, menuLineHeight: font.lineHeight
    ) else { return .zero }
    let sourceWidth = min(available.width, FittedPreviewGeometry.positiveFinite(input.logicalMaxWidth) ?? available.width)
    guard let displayScale = FittedPreviewGeometry.positiveFinite(testDisplayScale ?? currentWindow?.screen.scale) else { return .zero }
    measurementAttempted = true
    guard let natural = measure(input: input, traits: traits, font: font, width: sourceWidth) else {
      fitStatus = .invalidTextLayout
      return .zero
    }
    guard let validated = FittedPreviewInkLayout.resolve(natural: natural, available: available,
        inkRects: naturalInkRects, sourceCornerRadius: input.cornerRadius,
        sourceBorderWidth: input.borderWidth, displayScale: displayScale, tuning: input.opticalTuning) else {
      fitStatus = .noVerifiedInkFit
      return .zero
    }
    let resolved = validated.geometry
    snapshot = input
    naturalSize = natural
    fit = resolved
    inkLayout = validated
    fitStatus = .fitted
    accessibilityLabel = input.source
    setNeedsDisplay()
    return resolved.size
  }

  private func nonnegative(_ value: CGFloat) -> CGFloat { value.isFinite ? max(0, value) : 0 }

  private func measure(input: PreviewInput, traits: UITraitCollection, font: UIFont, width: CGFloat) -> CGSize? {
    let horizontal = nonnegative(input.horizontalPadding)
    let vertical = nonnegative(input.verticalPadding)
    let textWidth = max(1, width - horizontal * 2)
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineSpacing = nonnegative(input.lineSpacing)
    paragraph.lineBreakMode = .byWordWrapping
    paragraph.baseWritingDirection = .natural
    // First pass measures occupied width without a right-alignment offset.
    // Alignment does not change line-breaking metrics.
    paragraph.alignment = .left
    let textStorage = NSTextStorage(string: input.source, attributes: [
      .font: font, .paragraphStyle: paragraph,
      .foregroundColor: input.foreground.resolvedColor(with: traits)
    ])
    let layout = NSLayoutManager()
    let textContainer = NSTextContainer(size: CGSize(width: textWidth, height: .greatestFiniteMagnitude))
    textContainer.lineFragmentPadding = 0
    textContainer.maximumNumberOfLines = 0
    textContainer.lineBreakMode = .byWordWrapping
    layout.addTextContainer(textContainer)
    textStorage.addLayoutManager(layout)
    layout.ensureLayout(for: textContainer)
    let usedWidth = layout.usedRect(for: textContainer).maxX
    guard usedWidth.isFinite else { textStorage.removeLayoutManager(layout); return nil }
    let occupiedWidth = min(textWidth, max(1, usedWidth.rounded(.up)))
    textContainer.size.width = occupiedWidth
    paragraph.alignment = input.rtl ? .right : .left
    textStorage.addAttribute(.paragraphStyle, value: paragraph, range: NSRange(location: 0, length: textStorage.length))
    layout.ensureLayout(for: textContainer)
    let allGlyphs = layout.glyphRange(for: textContainer)
    let covered = layout.characterRange(forGlyphRange: allGlyphs, actualGlyphRange: nil)
    guard covered.location == 0, NSMaxRange(covered) == textStorage.length else { textStorage.removeLayoutManager(layout); return nil }
    var inkRects: [CGRect] = []
    var validInk = true
    var coveredGlyphs = 0
    layout.enumerateLineFragments(forGlyphRange: allGlyphs) { _, _, _, range, _ in
      coveredGlyphs += range.length
      // Includes rendered marks outside the line-fragment rectangle. Envelopes
      // are per line, not one huge union that invents ink in empty corner areas.
      let ink = layout.boundingRect(forGlyphRange: range, in: textContainer)
      if !FittedPreviewInkLayout.finite(ink) { validInk = false }
      else if !ink.isEmpty { inkRects.append(ink) }
    }
    guard validInk, coveredGlyphs == allGlyphs.length else { textStorage.removeLayoutManager(layout); return nil }
    let ink = inkRects.reduce(CGRect.null) { $0.union($1) }
    let left = ink.isNull ? 0 : min(0, ink.minX)
    let top = ink.isNull ? 0 : min(0, ink.minY)
    let right = ink.isNull ? occupiedWidth : max(occupiedWidth, ink.maxX)
    var bottom = layout.usedRect(for: textContainer).maxY
    if layout.extraLineFragmentTextContainer === textContainer {
      bottom = max(bottom, layout.extraLineFragmentRect.maxY) // retain trailing blank lines
    }
    if !ink.isNull { bottom = max(bottom, ink.maxY) }
    // Source-space overhang correction comes from actual ink, not extra padding.
    glyphOrigin = CGPoint(x: horizontal - left, y: vertical - top)
    naturalInkRects = inkRects.map { $0.offsetBy(dx: glyphOrigin.x, dy: glyphOrigin.y) }
    let measured = CGSize(width: (right - left).rounded(.up) + horizontal * 2,
      height: (max(font.lineHeight, bottom) - top).rounded(.up) + vertical * 2)
    guard FittedPreviewGeometry.positiveFinite(measured.width) != nil,
      FittedPreviewGeometry.positiveFinite(measured.height) != nil else { textStorage.removeLayoutManager(layout); return nil }
    storage = textStorage
    manager = layout
    container = textContainer
    glyphRange = allGlyphs
    return measured
  }

  /// Read-only native diagnostic for actual glyph placement, including Arabic
  /// marks and trailing lines; no transcript measurement or JS callback.
  var fittedGlyphBounds: CGRect? {
    guard let inkLayout else { return nil }
    return inkLayout.inkBounds
  }

  /// Hosted endpoint probes use actual composed-character glyph ranges, not a
  /// possibly blank trailing line. Never a JS prop or a second layout owner.
  func fittedInkBounds(forCharacters range: NSRange) -> CGRect? {
    guard let fit, let manager, let container, let storage,
      range.location >= 0, range.location <= storage.length,
      range.length > 0, range.length <= storage.length - range.location else { return nil }
    let glyphs = manager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
    let ink = manager.boundingRect(forGlyphRange: glyphs, in: container)
    guard FittedPreviewInkLayout.finite(ink), !ink.isEmpty else { return nil }
    return ink.offsetBy(dx: glyphOrigin.x, dy: glyphOrigin.y)
      .applying(CGAffineTransform(scaleX: fit.scale, y: fit.scale))
      .offsetBy(dx: fit.opticalInsets.width, dy: fit.opticalInsets.height)
  }

  override func draw(_ rect: CGRect) {
    guard let context = UIGraphicsGetCurrentContext() else { return }
    lastDrawingContainedInk = renderPreview(in: context, canvas: bounds, clipInk: true)
  }

  /// Same vector draw used by production and bounded hosted raster comparisons.
  /// Disabling ONLY ink clipping supplies the reference image, not another
  /// renderer or a full-height bitmap. This is never an Expo/JS property.
  @discardableResult
  func renderPreview(in context: CGContext, canvas: CGRect, clipInk: Bool) -> Bool {
    guard let fit, let input = snapshot, let manager, let inkLayout,
      inkLayout.containsInk(in: canvas) else { return false }
    let traits = UITraitCollection(userInterfaceStyle: input.appearance)
    let sourceRect = CGRect(origin: .zero, size: fit.size)
    let radius = fit.scaledCornerRadius(input.cornerRadius)
    let shape = inkLayout.outline
    context.saveGState()
    defer { context.restoreGState() }
    context.translateBy(x: canvas.midX - fit.size.width / 2, y: canvas.midY - fit.size.height / 2)
    context.addPath(shape)
    context.setFillColor(input.background.resolvedColor(with: traits).cgColor)
    context.fillPath()
    context.saveGState()
    if clipInk { context.addPath(shape); context.clip() }
    context.translateBy(x: fit.opticalInsets.width, y: fit.opticalInsets.height)
    context.scaleBy(x: fit.scale, y: fit.scale)
    manager.drawGlyphs(forGlyphRange: glyphRange, at: glyphOrigin)
    context.restoreGState()
    let border = nonnegative(input.borderWidth) * fit.scale
    if border > 0 {
      let borderPath = RoundedRectangle(cornerRadius: max(0, radius - border / 2), style: .continuous)
        .path(in: sourceRect.insetBy(dx: border / 2, dy: border / 2)).cgPath
      context.addPath(borderPath)
      context.setStrokeColor(input.border.resolvedColor(with: traits).cgColor)
      context.setLineWidth(border)
      context.strokePath()
    }
    return true
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if let window {
      contentScaleFactor = testDisplayScale ?? window.screen.scale
      presentationEnded = false
      recoverSizingIfNeeded()
    } else {
      endPresentation()
    }
  }

  override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    recoverSizingIfNeeded()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    // A window can attach with zero bounds and acquire valid bounds later.
    // This is a guarded native geometry event, not a self-scheduling layout loop.
    recoverSizingIfNeeded()
  }

  private func windowGeometry(of window: UIWindow) -> WindowGeometry {
    WindowGeometry(identity: ObjectIdentifier(window), size: window.bounds.size,
      safeInsets: window.safeAreaInsets, margins: window.layoutMargins, displayScale: testDisplayScale ?? window.screen.scale)
  }

  private func recoverSizingIfNeeded() {
    guard !presentationEnded else { return }
    guard let window, let input = pendingInput else { return }
    let geometry = windowGeometry(of: window)
    if measuredWindowGeometry == geometry &&
      ((fit != nil && notifiedFit) || (fit == nil && measurementAttempted && notifiedFailure)) { return }
    let size = fittedSize(proposal: .unspecified)
    guard fit != nil else {
      notifiedFailure = true
      onSizingFailure?(input, fitStatus)
      return // failed/unavailable geometry is NOT a successful zero fit
    }
    notifiedFit = true
    invalidateIntrinsicContentSize()
    onSizingRecovery?(input, size) // @Published -> SwiftUI frame -> representable sizing
  }

  func beginPresentation() {
    guard !presentationActive else { return }
    presentationActive = true
    presentationEnded = false
    recoverSizingIfNeeded()
  }

  func endPresentation() {
    presentationActive = false
    presentationEnded = true
    resetPresentation()
    fitStatus = .suspended
    invalidateIntrinsicContentSize()
  }

  private func resetPresentation() {
    if let storage, let manager { storage.removeLayoutManager(manager) }
    storage = nil
    manager = nil
    container = nil
    naturalSize = nil
    fit = nil
    inkLayout = nil
    naturalInkRects = []
    glyphOrigin = .zero
    lastDrawingContainedInk = false
    fitStatus = .unavailableGeometry
    measurementAttempted = false
    measuredWindowGeometry = nil
    notifiedFit = false
    notifiedFailure = false
    snapshot = nil
    accessibilityLabel = nil
    glyphRange = NSRange(location: 0, length: 0)
  }

  func dispose() {
    onSizingRecovery = nil
    onSizingFailure = nil
    endPresentation()
    pendingInput = nil
    accessibilityLabel = nil
  }
}
