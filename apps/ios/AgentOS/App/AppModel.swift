import Observation
import OSLog
import SwiftUI

/// The app as a whole: the computers this phone has been added to, which
/// one is on screen, and the voice, Live mode and notifications they share.
@MainActor @Observable
final class AppModel {
    /// A pairing in progress, or the reason the last one failed.
    enum Pairing: Equatable {
        /// A code was read — scanned, pasted, or opened from another app:
        /// nothing is sent anywhere until the owner has seen whose it is.
        case confirming(PairingLink)
        case adding(name: String)
        case failed(LocalizedStringResource)
    }

    /// A request shown to the owner, with the computer it comes from.
    struct Asking: Identifiable {
        let store: ComputerStore
        let request: RequestItem
        var id: String { request.id }
    }

    private(set) var stores: [ComputerStore] = []
    private(set) var pairing: Pairing?
    /// A short line about something that just went wrong, shown for a moment.
    private(set) var notice: LocalizedStringResource?

    let voice = Voice()
    let live: LiveMode
    let notifier = Notifier()
    private var watch: WatchLink?

    private var selectedID = UserDefaults.standard.string(forKey: "selected")
    private var later: Set<String> = []
    private var isActive = false
    private var pushToken: String?
    private var noticeTimer: Task<Void, Never>?
    private var lingering = UIBackgroundTaskIdentifier.invalid
    private static let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "AgentOS", category: "app")

    init() {
        live = LiveMode(voice: voice)
        notifier.store = { [unowned self] id in stores.first { $0.id == id } }
        notifier.onOpen = { [unowned self] store in select(store) }
        notifier.start()
        live.onTrouble = { [unowned self] in
            Task { await notifier.post(notice: String(localized: "The conversation in your earbuds has paused. Open AgentOS to carry on.")) }
        }
        #if DEBUG
        // A made-up computer instead of the real ones (see Demo.swift).
        if let demo = Demo.scene {
            stores = Demo.stores(for: demo)
            pairing = Demo.pairing(for: demo)
            later = Demo.setAside(for: demo)
            if demo == "notification", let store = stores.first, let request = store.state.pending.first {
                // The request again, as the lock screen shows it, once the app has gone to the background.
                Task {
                    await notifier.enable()
                    try? await Task.sleep(for: .seconds(5))
                    await notifier.post(request, from: store)
                }
            }
            return
        }
        #endif
        for computer in Computer.loadAll() { add(computer) }
        watch = WatchLink(model: self)
        watch?.start()
    }

    // MARK: Computers

    /// The computer on screen.
    var selected: ComputerStore? {
        stores.first { $0.id == selectedID } ?? stores.first
    }

    func select(_ store: ComputerStore) {
        selectedID = store.id
        UserDefaults.standard.set(store.id, forKey: "selected")
    }

    /// Adds the computer a pairing link points to: tries each of its
    /// addresses until the right computer answers, then trades the code for
    /// a token.
    func pair(with text: String) {
        // While a computer is being added, another code waits for nobody.
        if case .adding = pairing { return }
        guard let link = PairingLink(text) else {
            pairing = .failed("That isn't the code of an AgentOS computer.")
            return
        }
        pairing = .confirming(link)
    }

    /// True when this phone already knows the computer of `link`: adding it
    /// again replaces how it is reached, which the owner must be told.
    func knows(_ link: PairingLink) -> Bool {
        stores.contains { $0.id == link.nodeId }
    }

    /// The owner said yes: adds the computer whose code is being confirmed.
    func confirmPairing() async {
        guard case .confirming(let link) = pairing else { return }
        pairing = .adding(name: link.name)
        do {
            let client = try await NodeClient.reach(nodeId: link.nodeId, at: link.urls, fingerprint: link.fingerprint)
            let paired = try await client.pair(code: link.code, deviceName: UIDevice.current.name)
            let computer = Computer(
                id: link.nodeId, name: paired.node.name, agentName: paired.node.agent.name,
                urls: link.urls, fingerprint: link.fingerprint, lastURL: client.baseURL, deviceId: paired.device.id,
                token: paired.token, addedAt: stores.first { $0.id == link.nodeId }?.computer.addedAt ?? .now)
            computer.save()
            if let before = stores.first(where: { $0.id == computer.id }) {
                // The new pairing replaces the old one: its token must not outlive it.
                discard(before)
                Task { await before.unpair() }
            }
            select(add(computer))
            pairing = nil
        } catch let error as APIError where error.status == 401 {
            pairing = .failed("This code is no longer valid. Show a new one on your computer.")
        } catch is APIError {
            pairing = .failed("Something went wrong on your computer. Try again.")
        } catch NodeClient.Refusal.notTheComputer {
            pairing = .failed("This is not the computer that showed the code. Nothing was sent to it.")
        } catch NodeClient.Refusal.unprotected(relay: true) {
            pairing = .failed("I can't reach \(link.name) safely: its relay address starts with http. Give the relay an https address, then show a new code.")
        } catch is NodeClient.Refusal {
            pairing = .failed("I can't reach \(link.name) safely from this network. Update AgentOS on your computer, then show a new code.")
        } catch {
            pairing = .failed("I can't reach \(link.name). Check that your phone is on the same network as your computer.")
        }
    }

    func dismissPairing() {
        pairing = nil
    }

    /// Forgets a computer, and has the computer forget this phone.
    func remove(_ store: ComputerStore) {
        discard(store)
        store.computer.delete()
        Task { await store.unpair() }
    }

    @discardableResult
    private func add(_ computer: Computer) -> ComputerStore {
        let store = ComputerStore(computer)
        store.onAttention = { [unowned self, unowned store] attention in handle(attention, from: store) }
        stores.append(store)
        store.setActive(isActive)
        store.connect()
        Task { await notifier.enable() }
        if let pushToken { Task { await store.registerPush(token: pushToken, sandbox: Self.isSandbox) } }
        return store
    }

    private func discard(_ store: ComputerStore) {
        store.disconnect()
        stores.removeAll { $0 === store }
    }

    // MARK: The watch

    /// What the Apple Watch shows of each computer.
    var watchSnapshot: WatchSnapshot {
        let computers = stores.map { store in
            WatchComputer(
                id: store.id, agentName: store.computer.agentName, state: store.presenceState, line: store.line,
                request: store.state.pending.first.map { request in
                    .init(
                        id: request.id, question: request.title, isApproval: request.kind == .approval,
                        options: request.options.map { .init(id: $0.id, label: $0.label, style: $0.style.rawValue) },
                        isHighRisk: request.risk == .high, hasPicture: request.screenshot != nil)
                })
        }
        return WatchSnapshot(computers: computers, at: .now)
    }

    /// Waits, briefly, to know where every computer stands: the watch asks
    /// when its owner looks at it, and this app may just have been woken
    /// to answer, with its connections still being made.
    func settle() async {
        for _ in 0..<30 where stores.contains(where: { $0.link == .connecting }) {
            try? await Task.sleep(for: .milliseconds(100))
        }
    }

    // MARK: Talking to the agent

    /// Sends what the owner typed or said to a conversation.
    func send(_ text: String, via: Via = .text, to threadId: String = mainThread, on store: ComputerStore) async {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        await attempt { try await store.send(text, via: via, to: threadId) }
    }

    /// Stops what the agent is doing in a conversation.
    func stop(_ threadId: String = mainThread, on store: ComputerStore) async {
        voice.stopSpeaking()
        await attempt { try await store.interrupt(threadId) }
    }

    /// Talking starts: a tap, or a press held.
    func startTalking() async {
        guard let selected else { return }
        await attempt { try await voice.startListening(for: selected) }
    }

    /// Talking ends — the next tap, or letting go: what was heard goes to the agent.
    func stopTalking() async {
        guard let selected else { return }
        await attempt {
            let text = try await voice.stopListening()
            guard !text.isEmpty else { return }
            try await selected.send(text, via: .voice)
        }
    }

    func toggleLive() async {
        switch live.state {
        case .off: await attempt { try await live.start(computerTalks: stores.contains { $0.state.node?.capabilities.voice.tts == .server }) }
        case .paused: live.resume()
        case .on: live.stop()
        }
    }

    // MARK: Requests

    /// The request to put in front of the owner now: the oldest one waiting
    /// that they have not set aside, on the computer on screen first.
    var asking: Asking? {
        let ordered = stores.sorted { first, _ in first === selected }
        for store in ordered {
            if let request = store.state.pending.first(where: { !later.contains($0.id) }) {
                return Asking(store: store, request: request)
            }
        }
        return nil
    }

    /// Answers a request with one of its options. True once the computer
    /// has the answer; when it does not, the decision itself says so.
    func decide(_ asking: Asking, optionId: String) async -> Bool {
        do {
            try await asking.store.resolve(asking.request.id, optionId: optionId)
            return true
        } catch {
            Self.log.error("\(error)")
            return false
        }
    }

    /// Answers a request in the owner's own words.
    func answer(_ asking: Asking, text: String) async {
        await attempt { try await asking.store.resolve(asking.request.id, text: text) }
    }

    /// Sets a request aside: it stays in the conversation, waiting.
    func answerLater(_ request: RequestItem) {
        later.insert(request.id)
    }

    /// Brings a request that was set aside back in front.
    func show(_ request: RequestItem) {
        later.remove(request.id)
    }

    // MARK: Life cycle

    /// Follows the scene: the computers learn whether the owner is looking.
    /// Going to the background without Live mode, the app asks for a little
    /// more time, so that an answer about to arrive still becomes a
    /// notification.
    func sceneChanged(to phase: ScenePhase) {
        isActive = phase == .active
        for store in stores { store.setActive(isActive) }
        if isActive { UNUserNotificationCenter.current().removeAllDeliveredNotifications() }
        linger(phase == .background && live.state == .off)
    }

    private func linger(_ wanted: Bool) {
        let application = UIApplication.shared
        if wanted, lingering == .invalid {
            lingering = application.beginBackgroundTask { [unowned self] in linger(false) }
        } else if !wanted, lingering != .invalid {
            application.endBackgroundTask(lingering)
            lingering = .invalid
        }
    }

    /// The token Apple gave this phone for pushes, shared with every computer.
    func registered(pushToken: Data) {
        let token = pushToken.map { String(format: "%02x", $0) }.joined()
        self.pushToken = token
        for store in stores {
            Task { await store.registerPush(token: token, sandbox: Self.isSandbox) }
        }
    }

    /// Builds run from Xcode get tokens for Apple's sandbox push servers.
    private static var isSandbox: Bool {
        #if DEBUG
        true
        #else
        false
        #endif
    }

    // MARK: Attention

    /// The agent asked, was answered or finished: tell the owner in the way
    /// that suits where they are — aloud in Live mode, a notification when
    /// the app is not on screen, nothing more when they are looking at it.
    private func handle(_ attention: Attention, from store: ComputerStore) {
        switch attention {
        case .request(let request):
            if !isActive { Task { await notifier.post(request, from: store) } }
            live.announce(request.spoken, replyTo: request.threadId, answering: request.id, on: store)
        case .settled(let requestId):
            later.remove(requestId)
            notifier.withdraw(requestId: requestId)
        case .turn(let threadId, let text):
            if !isActive { Task { await notifier.post(turn: text, in: threadId, from: store) } }
            if !live.announce(text, replyTo: threadId, on: store), isActive, store === selected, store.lastWordWasSpoken(in: threadId) {
                // A question asked aloud gets its answer aloud.
                Task { await voice.speak(text, for: store) }
            }
        }
    }

    private func attempt(_ action: () async throws -> Void) async {
        do {
            try await action()
        } catch {
            Self.log.error("\(error)")
            let notice: LocalizedStringResource = switch error {
            case VoiceError.microphoneDenied: "I need the microphone to hear you. You can allow it in Settings."
            case VoiceError.noMicrophone: "I can't hear anything: no microphone is available."
            case VoiceError.unsupportedLanguage: "I can't listen in this language on this iPhone yet."
            default: "That didn't go through. Try again."
            }
            show(notice: notice)
        }
    }

    private func show(notice: LocalizedStringResource) {
        self.notice = notice
        noticeTimer?.cancel()
        noticeTimer = Task {
            try? await Task.sleep(for: .seconds(5))
            if !Task.isCancelled { self.notice = nil }
        }
    }
}
