import Observation
import WatchConnectivity

/// The iPhone's side of the link to the Apple Watch: it keeps the watch
/// told of what every computer is doing, and carries out what the owner
/// says or decides there. A message from the watch wakes this app in the
/// background, so the watch works with the phone in a pocket.
@MainActor
final class WatchLink: NSObject {
    private unowned let model: AppModel
    private let session = WCSession.default
    private var told: [WatchComputer]?

    init(model: AppModel) {
        self.model = model
    }

    func start() {
        guard WCSession.isSupported() else { return }
        session.delegate = self
        session.activate()
        follow()
    }

    /// Tells the watch whenever what it shows has changed, twice a second at most.
    private func follow() {
        let snapshot = withObservationTracking {
            model.watchSnapshot
        } onChange: { [weak self] in
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(500))
                self?.follow()
            }
        }
        guard snapshot.computers != told, session.activationState == .activated, let data = try? JSONEncoder().encode(snapshot) else { return }
        told = snapshot.computers
        // What the watch finds when it wakes, and — when it is awake — right now.
        try? session.updateApplicationContext(["snapshot": data])
        if session.isReachable { session.sendMessageData(data, replyHandler: nil) }
    }

    /// Does what the watch asked, and answers with how things stand after it.
    private func carryOut(_ data: Data) async -> Data {
        switch try? JSONDecoder().decode(WatchCommand.self, from: data) {
        case .refresh, nil:
            await model.settle()
        case .say(let computer, let text):
            _ = try? await model.stores.first { $0.id == computer }?.send(text, via: .voice)
        case .answer(let computer, let request, let option):
            try? await model.stores.first { $0.id == computer }?.resolve(request, optionId: option)
        }
        return (try? JSONEncoder().encode(model.watchSnapshot)) ?? Data()
    }
}

extension WatchLink: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in
            told = nil
            follow()
        }
    }

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}

    /// The owner switched to another watch: link to that one.
    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    nonisolated func session(_ session: WCSession, didReceiveMessageData messageData: Data, replyHandler: @escaping (Data) -> Void) {
        nonisolated(unsafe) let reply = replyHandler
        Task { @MainActor in
            reply(await carryOut(messageData))
        }
    }
}
