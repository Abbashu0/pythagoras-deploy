import UIKit
import PythagorasChatPreview

// TEST ONLY. No React root, Metro, application data, or network startup.
@main
final class PreviewTestAppDelegate: UIResponder, UIApplicationDelegate {
  func application(_ application: UIApplication,
    configurationForConnecting session: UISceneSession,
    options: UIScene.ConnectionOptions) -> UISceneConfiguration {
    let configuration = UISceneConfiguration(name: "Preview Tests", sessionRole: session.role)
    configuration.delegateClass = PreviewTestSceneDelegate.self
    return configuration
  }
}

final class PreviewTestSceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
    options: UIScene.ConnectionOptions) {
    guard let scene = scene as? UIWindowScene else { preconditionFailure("Tests require UIWindowScene") }
    let window = UIWindow(windowScene: scene)
    let controller = UIViewController()
    // A real reference to the production module forces static pod linkage.
    controller.title = String(reflecting: PythagorasChatPreviewModule.self)
    window.rootViewController = controller
    self.window = window
    window.makeKeyAndVisible()
  }
}
