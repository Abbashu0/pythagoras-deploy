import ExpoModulesCore
import ExpoUI

public final class PythagorasChatPreviewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PythagorasChatPreview")
    ExpoUIView(PythagorasFittedUserMessagePreview.self)
  }
}
