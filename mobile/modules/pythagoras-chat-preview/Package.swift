// swift-tools-version: 5.9
import PackageDescription

// Foundation-only geometry tests, independent of UIKit/Expo; not an app dependency.
let package = Package(
  name: "PythagorasPreviewGeometry",
  products: [.library(name: "PreviewGeometry", targets: ["PreviewGeometry"])],
  targets: [
    .target(name: "PreviewGeometry", path: "ios",
      exclude: ["PythagorasChatPreviewModule.swift", "PythagorasFittedUserMessagePreview.swift", "PythagorasChatPreview.podspec"],
      sources: ["FittedPreviewGeometry.swift"]),
    .testTarget(name: "PreviewGeometryTests", dependencies: ["PreviewGeometry"], path: "tests")
  ]
)
