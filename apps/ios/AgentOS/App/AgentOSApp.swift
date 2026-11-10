import SwiftUI

@main
struct AgentOSApp: App {
    @UIApplicationDelegateAdaptor private var delegate: AppDelegate
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            #if DEBUG
            // `-demo gallery`: every state of the presence, to check it against the web.
            if Demo.scene == "gallery" {
                PresenceGallery(columns: 3)
            } else {
                root
            }
            #else
            root
            #endif
        }
    }

    private var root: some View {
        RootView()
            .environment(delegate.model)
            // The link in the computer's QR code, opened from the camera or pasted in a browser.
            .onOpenURL { url in
                delegate.model.pair(with: url.absoluteString)
            }
            .onChange(of: scenePhase, initial: true) { _, phase in
                delegate.model.sceneChanged(to: phase)
            }
    }
}

/// Owns the model, so that it exists even when iOS starts the app in the
/// background to deliver an answer given from a notification.
final class AppDelegate: NSObject, UIApplicationDelegate {
    let model = AppModel()

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        model.registered(pushToken: deviceToken)
    }

    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any]) async -> UIBackgroundFetchResult {
        model.notifier.received(remote: userInfo)
        return .noData
    }
}
