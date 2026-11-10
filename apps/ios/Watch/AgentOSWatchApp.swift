import SwiftUI

/// AgentOS on the wrist: the presence with the agent's name and its line,
/// a request to answer with two buttons, and dictation to talk to the
/// agent. Everything goes through the iPhone app (see `WatchMessages.swift`).
@main
struct AgentOSWatchApp: App {
    @State private var model = WatchModel()

    var body: some Scene {
        WindowGroup {
            #if DEBUG
            // `-demo gallery`: every state of the presence, to check it against the web.
            if WatchModel.demo == "gallery" {
                PresenceGallery(stage: 72, columns: 2)
            } else {
                home
            }
            #else
            home
            #endif
        }
    }

    private var home: some View {
        WatchHome()
            .environment(model)
            .task { model.start() }
    }
}
