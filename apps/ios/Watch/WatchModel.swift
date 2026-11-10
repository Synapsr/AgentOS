import Observation
import WatchConnectivity

/// The watch's side of the link to the iPhone: what the iPhone last said
/// about the computers, and the way to ask it for something.
@MainActor @Observable
final class WatchModel: NSObject {
    /// What to show.
    private(set) var snapshot = WatchSnapshot()
    /// Whether the iPhone can be asked right now.
    private(set) var isReachable = false
    /// What the owner just answered here, per computer: shown for a moment
    /// as its receipt, then the presence comes back.
    private(set) var receipts: [String: Receipt] = [:]

    /// The receipt of an answer given on the watch.
    struct Receipt: Equatable {
        /// The answer, as its button said it.
        let said: String
        /// Go ahead (or the agent's own yes), rather than Stop.
        let isYes: Bool
        let question: String
    }

    @ObservationIgnored private let session = WCSession.default

    func start() {
        #if DEBUG
        if let scene = Self.demo { return showDemo(scene) }
        #endif
        session.delegate = self
        session.activate()
    }

    /// Asks the iPhone to look at the computers again.
    func refresh() async {
        await ask(.refresh)
    }

    /// Says something to the agent of a computer.
    func say(_ text: String, to computer: WatchComputer) async {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        await ask(.say(computer: computer.id, text: text))
    }

    /// Answers a request with one of its options. True once the computer
    /// has the answer: the request no longer waits there.
    func answer(_ request: WatchComputer.Request, with option: String, said: String, isYes: Bool, on computer: WatchComputer) async -> Bool {
        #if DEBUG
        if Self.demo != nil {
            try? await Task.sleep(for: .milliseconds(600))
            return settle(computer.id, Receipt(said: said, isYes: isYes, question: request.question))
        }
        #endif
        guard let after = await ask(.answer(computer: computer.id, request: request.id, option: option)),
              after.computers.first(where: { $0.id == computer.id })?.request?.id != request.id else { return false }
        return settle(computer.id, Receipt(said: said, isYes: isYes, question: request.question))
    }

    /// Keeps the receipt of an answer on screen for a moment, as long as a toast.
    private func settle(_ computer: String, _ receipt: Receipt) -> Bool {
        receipts[computer] = receipt
        Task {
            try? await Task.sleep(for: .seconds(2.4))
            if receipts[computer] == receipt { receipts[computer] = nil }
        }
        return true
    }

    /// Sends a command; the iPhone answers with how things stand after it.
    @discardableResult
    private func ask(_ command: WatchCommand) async -> WatchSnapshot? {
        guard session.activationState == .activated, session.isReachable, let data = try? JSONEncoder().encode(command) else { return nil }
        // The answer comes back on a queue of WatchConnectivity's own: these
        // closures must not be taken for main-actor ones.
        let reply: Data? = await withCheckedContinuation { answered in
            session.sendMessageData(data) { @Sendable reply in
                answered.resume(returning: reply)
            } errorHandler: { @Sendable _ in
                answered.resume(returning: nil)
            }
        }
        guard let reply else { return nil }
        show(reply)
        return try? JSONDecoder().decode(WatchSnapshot.self, from: reply)
    }

    private func show(_ data: Data) {
        guard let snapshot = try? JSONDecoder().decode(WatchSnapshot.self, from: data), snapshot.at > self.snapshot.at else { return }
        self.snapshot = snapshot
    }

    #if DEBUG
    /// A made-up computer, for screenshots: launch with `-demo <scene>` —
    /// `presence`, `working`, `request` (high risk), `sure`, `answered`, `question`, `offline`.
    static let demo: String? = {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-demo"), arguments.indices.contains(index + 1) else { return nil }
        return arguments[index + 1]
    }()

    /// Starts on the "Just to be sure" page of the demo's request.
    var startsSure: Bool { Self.demo == "sure" }

    private func showDemo(_ scene: String) {
        let french = Locale.preferredLanguages.first?.hasPrefix("fr") == true
        func say(_ english: String, _ inFrench: String) -> String { french ? inFrench : english }
        let payment = WatchComputer.Request(
            id: "req_pay", question: say("Pay €240.00 to Durand Plomberie?", "Payer 240,00 € à Durand Plomberie ?"), isApproval: true,
            options: [], isHighRisk: true, hasPicture: true)
        let deploy = WatchComputer.Request(
            id: "req_deploy", question: say("Everything looks good. Deploy to production?", "Tout est prêt. Je mets en production ?"), isApproval: false,
            options: [.init(id: "deploy", label: say("Deploy", "Mettre en ligne"), style: "primary"), .init(id: "later", label: say("Not yet", "Pas encore"), style: "default")],
            isHighRisk: false, hasPicture: true)
        let (state, line, request): (Presence.State, String, WatchComputer.Request?) = switch scene {
        case "working": (.working, say("Running the tests", "Lancement des tests"), nil)
        case "request", "sure": (.waiting, payment.question, payment)
        case "question": (.waiting, deploy.question, deploy)
        case "answered": (.working, say("Confirming the transfer", "Confirmation du virement"), nil)
        case "offline": (.offline, say("I can't reach Studio Mac. Check that it's awake.", "Je n'arrive pas à joindre Studio Mac. Vérifiez qu'il est allumé."), nil)
        default: (.idle, say("Good morning, Alex.", "Bonjour, Alex."), nil)
        }
        snapshot = WatchSnapshot(computers: [WatchComputer(id: "node_studio", agentName: "Nova", state: state, line: line, request: request)], at: .now)
        isReachable = true
        if scene == "answered" {
            receipts["node_studio"] = Receipt(said: say("Go ahead", "Allez-y"), isYes: true, question: payment.question)
        }
    }
    #endif
}

extension WatchModel: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        // What the iPhone left for us while the watch app was not running.
        let waiting = session.receivedApplicationContext["snapshot"] as? Data
        let reachable = session.isReachable
        Task { @MainActor in
            if let waiting { show(waiting) }
            isReachable = reachable
            await refresh()
        }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        let reachable = session.isReachable
        Task { @MainActor in
            isReachable = reachable
            if reachable { await refresh() }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        guard let data = applicationContext["snapshot"] as? Data else { return }
        Task { @MainActor in show(data) }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessageData messageData: Data) {
        Task { @MainActor in show(messageData) }
    }
}
