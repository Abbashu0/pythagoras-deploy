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
