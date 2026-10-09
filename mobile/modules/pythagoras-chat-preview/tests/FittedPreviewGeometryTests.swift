import Foundation
import XCTest
@testable import PreviewGeometry

final class FittedPreviewGeometryTests: XCTestCase {
  func testShortIsUnscaled() throws {
    let fit = try XCTUnwrap(FittedPreviewGeometry.fit(natural: CGSize(width: 95, height: 48), available: CGSize(width: 320, height: 500)))
    XCTAssertEqual(fit.scale, 1)
    XCTAssertEqual(fit.size, CGSize(width: 95, height: 48))
  }

  func testCornerRadiusKeepsItsSourceProportionAtEveryFitScale() throws {
    for height in [CGFloat(48), CGFloat(950), CGFloat(15000), CGFloat(1000000)] {
      let fit = try XCTUnwrap(FittedPreviewGeometry.fit(natural: CGSize(width: 320, height: height), available: CGSize(width: 320, height: 400)))
      XCTAssertEqual(fit.scaledCornerRadius(24), 24 * fit.scale)
      XCTAssertEqual(fit.scaledCornerRadius(24) / fit.size.width, 24 / 320, accuracy: 0.000001)
      XCTAssertLessThan(fit.scaledCornerRadius(24), fit.size.width / 2)
      for invalid in [CGFloat(-1), CGFloat.nan, CGFloat.infinity] {
        XCTAssertEqual(fit.scaledCornerRadius(invalid), 0)
      }
    }
  }

  func testMediumLongAndExtremeAreUniformAndFinite() throws {
    for height in [CGFloat(950), CGFloat(15000), CGFloat(1000000)] {
      let natural = CGSize(width: 320, height: height)
      let fit = try XCTUnwrap(FittedPreviewGeometry.fit(natural: natural, available: CGSize(width: 300, height: 400)))
      XCTAssertLessThanOrEqual(fit.size.width, 300)
      XCTAssertLessThanOrEqual(fit.size.height, 400)
      XCTAssertTrue(fit.size.height.isFinite)
      XCTAssertEqual(fit.size.width / fit.size.height, natural.width / natural.height, accuracy: 0.000001)
      XCTAssertEqual(fit.size.height, natural.height * fit.scale)
    }
  }

  func testOpticalFitKeepsShortAndWidePreviewsUnchanged() throws {
    let available = CGSize(width: 320, height: 400)
    for natural in [CGSize(width: 90, height: 48), CGSize(width: 320, height: 800)] {
      XCTAssertEqual(FittedPreviewGeometry.fitPreview(natural: natural, available: available,
        sourceCornerRadius: 24, displayScale: 3), FittedPreviewGeometry.fit(natural: natural, available: available))
    }
  }

  func testNarrowMiniatureKeepsItsCompleteContentOutsideBothCapBands() throws {
    let available = CGSize(width: 300, height: 400)
    for displayScale in [CGFloat(1), CGFloat(2), CGFloat(3)] {
      for height in [CGFloat(3000), CGFloat(20000), CGFloat(1000000)] {
        let natural = CGSize(width: 320, height: height)
        let fit = try XCTUnwrap(FittedPreviewGeometry.fitPreview(natural: natural, available: available,
          sourceCornerRadius: 24, displayScale: displayScale))
        let pixel = 1 / displayScale
        XCTAssertEqual(fit.opticalInsets.width, pixel)
        XCTAssertGreaterThanOrEqual(fit.contentRect.minY, fit.size.width + pixel)
        XCTAssertGreaterThanOrEqual(fit.size.height - fit.contentRect.maxY, fit.size.width + pixel)
        XCTAssertEqual(fit.contentRect.width, natural.width * fit.scale, accuracy: 0.000001)
        XCTAssertEqual(fit.contentRect.height, natural.height * fit.scale, accuracy: 0.000001)
        XCTAssertEqual(fit.contentRect.width / fit.contentRect.height, natural.width / natural.height, accuracy: 0.000001)
        XCTAssertLessThanOrEqual(fit.size.width, available.width)
        XCTAssertLessThanOrEqual(fit.size.height, available.height)
      }
    }
  }

  func testOpticalFitRejectsUnavailablePixelMetricsOrInsufficientSpace() {
    for displayScale in [CGFloat(0), CGFloat(-1), CGFloat.nan, CGFloat.infinity] {
      XCTAssertNil(FittedPreviewGeometry.fitPreview(natural: CGSize(width: 320, height: 20000),
        available: CGSize(width: 300, height: 400), sourceCornerRadius: 24, displayScale: displayScale))
    }
    XCTAssertNil(FittedPreviewGeometry.fitPreview(natural: CGSize(width: 320, height: 20000),
      available: CGSize(width: 1, height: 1), sourceCornerRadius: 24, displayScale: 3))
  }

  func testTuningDefaultsAndInvalidNativeNumbersNormalizeToTheOriginalPolicy() {
    XCTAssertEqual(PreviewOpticalTuning.validated(), .defaults)
    for value in [CGFloat(-1), CGFloat.nan, CGFloat.infinity, CGFloat(1000000)] {
      XCTAssertEqual(PreviewOpticalTuning.validated(sideSafetyPixels: value,
        endSafetyWidthFactor: value, endSafetyExtraPixels: value, narrowEligibilityFactor: value), .defaults)
    }
  }

  func testChangedTuningRefitsTheSameSourceAndOversizedExperimentsUseDefaults() throws {
    let natural = CGSize(width: 320, height: 20000)
    let available = CGSize(width: 300, height: 400)
    let defaults = try XCTUnwrap(FittedPreviewGeometry.fitPreview(natural: natural, available: available,
      sourceCornerRadius: 24, displayScale: 3))
    let tuned = try XCTUnwrap(FittedPreviewGeometry.fitPreview(natural: natural, available: available,
      sourceCornerRadius: 24, displayScale: 3, tuning: .validated(sideSafetyPixels: 2,
        endSafetyWidthFactor: 1.5, endSafetyExtraPixels: 6, narrowEligibilityFactor: 3)))
    XCTAssertNotEqual(tuned, defaults)
    XCTAssertEqual(tuned.contentRect.width / tuned.contentRect.height, natural.width / natural.height, accuracy: 0.000001)
    let disabled = FittedPreviewGeometry.fitPreview(natural: natural, available: available,
      sourceCornerRadius: 24, displayScale: 3, tuning: .validated(opticalSafetyEnabled: false))
    XCTAssertEqual(disabled, FittedPreviewGeometry.fit(natural: natural, available: available))
    let tight = CGSize(width: 300, height: 20)
    XCTAssertEqual(FittedPreviewGeometry.fitPreview(natural: natural, available: tight,
      sourceCornerRadius: 24, displayScale: 3, tuning: .validated(sideSafetyPixels: 8,
        endSafetyWidthFactor: 4, endSafetyExtraPixels: 32, narrowEligibilityFactor: 8)),
      FittedPreviewGeometry.fitPreview(natural: natural, available: tight, sourceCornerRadius: 24, displayScale: 3))
  }

  func testNilAndChangingProposalsRetainWindowBudget() {
    let viewport = CGSize(width: 390, height: 760)
    let baseline = FittedPreviewGeometry.budget(viewport: viewport, horizontalMargins: 32, verticalMargins: 20, menuLineHeight: 22)
    XCTAssertEqual(baseline, CGSize(width: 358, height: 494))
    for _ in 0..<20 {
      XCTAssertEqual(FittedPreviewGeometry.budget(viewport: viewport, horizontalMargins: 32, verticalMargins: 20, menuLineHeight: 22), baseline)
    }
    XCTAssertNil(FittedPreviewGeometry.budget(viewport: nil, horizontalMargins: 0, verticalMargins: 0, menuLineHeight: 22))
  }

  func testInvalidGeometryFailsClosed() {
    for value in [CGFloat(0), CGFloat(-1), CGFloat.nan, CGFloat.infinity] {
      XCTAssertNil(FittedPreviewGeometry.fit(natural: CGSize(width: 300, height: value), available: CGSize(width: 300, height: 400)))
    }
  }

  func testLandscapeAndLargeDynamicTypeReserveMenuSpace() throws {
    let size = try XCTUnwrap(FittedPreviewGeometry.budget(viewport: CGSize(width: 700, height: 250), horizontalMargins: 32, verticalMargins: 20, menuLineHeight: 60))
    XCTAssertEqual(size.height, 50)
    XCTAssertTrue(size.width.isFinite && size.height.isFinite)
  }
}
