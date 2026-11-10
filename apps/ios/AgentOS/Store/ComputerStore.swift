import Foundation
import Observation

/// Something the owner should hear about even when not looking at the phone.
enum Attention: Sendable {
    /// The agent is asking.
    case request(RequestItem)
    /// The agent finished its turn; `text` is what to tell the owner.
    case turn(threadId: String, text: String)
    /// A request no longer needs an answer: someone gave one, or the agent moved on.
    case settled(requestId: String)

    init?(_ event: Event) {
        switch event.kind {
        case .itemAdded(.request(let request)) where request.state == .pending:
            self = .request(request)
        case .itemUpdated(.request(let request)) where request.state != .pending:
            self = .settled(requestId: request.id)
        case .turnCompleted(let threadId, _, let text) where !text.isEmpty:
            self = .turn(threadId: threadId, text: text)
        default:
            return nil
        }
    }
}

/// One computer, live: what the phone knows about it, the connection that
/// keeps that current, and what the owner can do to it.
@MainActor @Observable
final class ComputerStore: Identifiable {
    enum Link: Sendable {
        case connecting, online, offline
        /// The computer no longer accepts this phone's token.
        case unpaired
        /// What answers at the computer's address is not the computer that was added.
        case impostor
        /// Nothing protects the addresses this phone knows: it was added
        /// before the computer spoke TLS on the local network.
        case unprotected
    }

    private(set) var computer: Computer
    private(set) var state = ComputerState()
    private(set) var link = Link.connecting
    /// The last answer the owner gave here, or the last attempt to reach the computer again: the presence answers it with its body.
    private(set) var presencePulse: PresencePulse?

    /// Called when the agent asks, is answered or finishes a turn — as it
    /// happens, or on reconnecting for what was missed.
    @ObservationIgnored var onAttention: (Attention) -> Void = { _ in }

    nonisolated let id: String
    private var client: NodeClient
    private var socket: EventSocket?
    private var connection: Task<Void, Never>?
    private var isActive = false
    private var loadingEarlier: Set<String> = []
    private let files = NSCache<NSString, NSData>()
    #if DEBUG
    /// The script of a computer made up for the demo (`-demo`, see Demo.swift).
    @ObservationIgnored private var demo: Demo.Script?
    #endif

    init(_ computer: Computer) {
        self.id = computer.id
        self.computer = computer
        self.client = NodeClient(baseURL: computer.lastURL ?? computer.urls[0], token: computer.token, fingerprint: computer.fingerprint)
    }

    // MARK: What the owner can do

    /// Says something to the agent. With `requestId`, the words are the
    /// owner's reply to that pending request — only then may the computer
    /// read them as an answer. Returns that request as it stands
    /// afterwards: still pending when the words were not a clear answer.
    @discardableResult
    func send(_ text: String, via: Via = .text, to threadId: String = mainThread, answering requestId: String? = nil) async throws -> RequestItem? {
        #if DEBUG
        if let demo { return await demo.send(text, via: via, to: threadId, on: self) }
        #endif
        let sent = try await client.send(text, via: via, to: threadId, answering: requestId)
        state.upsert(.message(sent.item))
        if let request = sent.request { state.upsert(.request(request)) }
        return sent.request
    }

    /// Answers a request with one of its options, with words, or both.
    /// Someone else answering first is not an error: the first answer wins
    /// and the event stream brings it.
    func resolve(_ requestId: String, optionId: String? = nil, text: String? = nil) async throws {
        #if DEBUG
        if let demo {
            await demo.resolve(requestId, optionId: optionId, text: text, on: self)
            return answered(optionId)
        }
        #endif
        do {
            state.upsert(.request(try await client.resolve(requestId: requestId, optionId: optionId, text: text)))
            answered(optionId)
        } catch let error as APIError where error.error.code == "conflict" {}
    }

    /// Once the computer has the answer, the presence nods after "go ahead" and lowers its hand after "stop".
    private func answered(_ optionId: String?) {
        if optionId == RequestItem.Option.approve { presencePulse = PresencePulse(.approved) }
        if optionId == RequestItem.Option.deny { presencePulse = PresencePulse(.denied) }
    }

    /// Stops what the agent is doing in a conversation.
    func interrupt(_ threadId: String = mainThread) async throws {
        try await client.interrupt(threadId: threadId)
    }

    /// Loads a conversation's latest page, if it has not been opened yet.
    func open(_ threadId: String) async {
        guard state.hasEarlier[threadId] == nil, let page = try? await client.items(threadId: threadId) else { return }
        state.load(page)
    }

    /// Loads the page before the oldest item shown.
    func loadEarlier(in threadId: String) async {
        guard state.hasEarlier[threadId] == true, let oldest = state.items[threadId]?.first,
              loadingEarlier.insert(threadId).inserted else { return }
        defer { loadingEarlier.remove(threadId) }
        guard let page = try? await client.items(threadId: threadId, before: oldest.id) else { return }
        state.load(page, older: true)
    }

    /// The bytes of a screenshot, fetched once.
    func data(for file: FileRef) async -> Data? {
        if let cached = files.object(forKey: file.id as NSString) { return cached as Data }
        guard let data = try? await client.file(file.id).data else { return nil }
        files.setObject(data as NSData, forKey: file.id as NSString)
        return data
    }

    /// Tells the computer where to send push notifications for this phone.
    func registerPush(token: String, sandbox: Bool) async {
        try? await client.registerPush(.init(kind: .apns, token: token, sandbox: sandbox))
    }

    /// Removes this phone from the computer: its token stops working there.
    func unpair() async {
        try? await client.unpair()
    }

    /// The client currently in use, for the voice routes.
    var api: NodeClient { client }

    // MARK: Connection

    /// Starts following the computer, and keeps reconnecting until `disconnect()`.
    func connect() {
        #if DEBUG
        guard demo == nil else { return }
        #endif
        guard connection == nil else { return }
        connection = Task { await run() }
    }

    func disconnect() {
        connection?.cancel()
        connection = nil
        socket = nil
    }

    /// Tries to reach the computer again now, rather than at the next attempt.
    func retry() {
        disconnect()
        link = .connecting
        connect()
    }

    /// Tells the computer whether the owner is looking at this phone, and
    /// retries at once when they come back to a computer that was out of reach.
    func setActive(_ active: Bool) {
        isActive = active
        if active, link == .offline {
            disconnect()
            connect()
        } else if let socket {
            Task { try? await socket.send(.presence(active: active)) }
        }
    }

    private func run() async {
        var delay = Duration.seconds(1)
        while !Task.isCancelled {
            var failure = Link.offline
            do {
                client = try await reach()
                // Also proves the token is still accepted.
                let snapshot = try await client.node()
                state.node = snapshot.node
                state.status = snapshot.status
                let socket = try client.events(since: state.seq > 0 ? state.seq : nil)
                self.socket = socket
                // Events replayed before `ready` are what we missed, not news.
                var missed: [Attention]? = []
                for try await frame in socket.frames() {
                    try await handle(frame, missed: &missed)
                    delay = .seconds(1)
                }
            } catch let error as APIError where error.status == 401 {
                link = .unpaired
                return
            } catch NodeClient.Refusal.notTheComputer {
                // Never talked to, however often it is found there.
                failure = .impostor
            } catch NodeClient.Refusal.unprotected {
                failure = .unprotected
            } catch {}
            guard !Task.isCancelled else { return }
            socket = nil
            // A connection that was working is retried at once, before the
            // owner is told anything; after that, less and less often.
            if link == .online {
                link = .connecting
                continue
            }
            link = failure
            try? await Task.sleep(for: delay)
            delay = min(delay * 2, .seconds(15))
            // Each new attempt lifts the offline dash once: still trying.
            presencePulse = PresencePulse(.retry)
        }
    }

    /// Finds the address the computer answers at right now, and remembers it.
    private func reach() async throws -> NodeClient {
        let found = try await NodeClient.reach(nodeId: computer.id, at: computer.urls, fingerprint: computer.fingerprint, token: computer.token)
        if computer.lastURL != found.baseURL {
            computer.lastURL = found.baseURL
            computer.save()
        }
        return found
    }

    private func handle(_ frame: ServerFrame, missed: inout [Attention]?) async throws {
        switch frame {
        case .ready(let seq, let reset, let node, let status):
            let needsLoad = reset || state.hasEarlier[mainThread] == nil
            state.ready(seq: seq, reset: reset, node: node, status: status)
            if needsLoad { try await reload() }
            remember(node)
            link = .online
            try? await socket?.send(.presence(active: isActive))
            // Of what was missed, only what still matters: requests that are
            // still waiting, and the agent's last word.
            let waiting = Set(state.pending.map(\.id))
            var lastTurn: Attention?
            for attention in missed ?? [] {
                switch attention {
                case .request(let request): if waiting.contains(request.id) { onAttention(attention) }
                case .settled: onAttention(attention)
                case .turn: lastTurn = attention
                }
            }
            if let lastTurn { onAttention(lastTurn) }
            missed = nil
        case .event(let event):
            guard event.seq == 0 || event.seq > state.seq else { return }
            state.apply(event)
            guard let attention = Attention(event) else { return }
            // Jobs report to the main conversation, which tells the owner itself.
            if case .turn(let threadId, _) = attention, threadId != mainThread { return }
            if missed == nil { onAttention(attention) } else { missed?.append(attention) }
        case .pong, .unknown:
            break
        }
    }

    /// Loads what events cannot rebuild: the conversations, the main
    /// timeline and the requests still waiting.
    private func reload() async throws {
        let client = client
        async let threads = client.threads()
        async let page = client.items(threadId: mainThread)
        async let pending = client.pendingRequests()
        state.load(threads: try await threads)
        state.load(try await page)
        state.pending = try await pending.sorted { $0.at < $1.at }
    }

    private func remember(_ node: NodeInfo) {
        guard computer.name != node.name || computer.agentName != node.agent.name else { return }
        computer.name = node.name
        computer.agentName = node.agent.name
        computer.save()
    }
}

#if DEBUG
extension ComputerStore {
    /// A computer made up for the demo: nothing is fetched, nothing leaves the phone.
    convenience init(demo computer: Computer, state: ComputerState, pictures: [String: Data], script: Demo.Script) {
        self.init(computer)
        self.state = state
        link = .online
        demo = script
        for (id, data) in pictures { files.setObject(data as NSData, forKey: id as NSString) }
    }

    /// The demo's script moves things along as a computer would.
    func play(_ change: (inout ComputerState) -> Void) {
        change(&state)
    }

    /// The demo's computer goes out of reach.
    func goOffline() {
        link = .offline
        state.status = nil
    }
}
#endif

// MARK: What a computer shows

extension ComputerStore {
    /// What this computer's presence should show.
    var presenceState: Presence.State {
        switch link {
        case .offline, .unpaired, .impostor, .unprotected: return .offline
        case .connecting where state.status == nil: return .offline
        case .connecting, .online: break
        }
        if !state.pending.isEmpty { return .waiting }
        switch state.status?.state {
        case .working: return .working
        case .waiting: return .waiting
        case .idle, nil: return .idle
        }
    }

    /// Whether the main conversation has work that can be stopped.
    var isWorking: Bool {
        link == .online && state.threads[mainThread]?.state == .working
    }

    /// What the agent is up to, in one sentence.
    var line: String {
        let name = computer.name
        switch link {
        case .unpaired: return String(localized: "\(name) doesn't know this phone any more. Add it again from your computer.")
        case .offline: return String(localized: "I can't reach \(name). Check that it's awake.")
        case .impostor: return String(localized: "What answers at \(name)'s address is not the computer you added.")
        case .unprotected: return String(localized: "I can't reach \(name) safely any more. Add it again from your computer.")
        case .connecting where state.status == nil: return String(localized: "Looking for \(name)…")
        case .connecting, .online: break
        }
        if let asking = state.pending.first { return asking.title }
        if let typing = state.typing[mainThread] { return typing.text }
        // Right after a Stop, until the agent does or says anything else:
        // never "I'm on it.", the opposite of what was just said.
        if case .request(let last)? = state.items[mainThread]?.last, last.state == .resolved,
           last.resolution?.optionId == RequestItem.Option.deny {
            return String(localized: "Okay, I won't.")
        }
        if state.status?.state == .working {
            // Only a background job at work: say whose work it is, not as the agent's answer.
            if state.threads[mainThread]?.state != .working, let job = state.jobs.first(where: { $0.state == .working }) {
                return String(localized: "\(job.title): \(job.preview ?? state.status?.activity ?? String(localized: "I'm on it."))")
            }
            return state.status?.activity ?? String(localized: "I'm on it.")
        }
        for case .message(let message) in (state.items[mainThread] ?? []).reversed() where message.role == .agent {
            return message.text
        }
        return Self.greeting(state.node?.owner.name ?? "")
    }

    /// The same greeting as on the computer's own screen.
    private static func greeting(_ owner: String, at date: Date = .now) -> String {
        let hour = Calendar.current.component(.hour, from: date)
        switch (hour, owner.isEmpty) {
        case (5..<12, false): return String(localized: "Good morning, \(owner).")
        case (12..<18, false): return String(localized: "Good afternoon, \(owner).")
        case (_, false): return String(localized: "Good evening, \(owner).")
        case (5..<12, true): return String(localized: "Good morning.")
        case (12..<18, true): return String(localized: "Good afternoon.")
        case (_, true): return String(localized: "Good evening.")
        }
    }

    /// A request that no longer waits, as it ended: answered — here or
    /// elsewhere — or no longer needed. Nil while it still waits.
    func settled(_ request: RequestItem) -> RequestItem? {
        for case .request(let item) in state.items[request.threadId] ?? [] where item.id == request.id && item.state != .pending {
            return item
        }
        return nil
    }

    /// Whether the owner's last message in a conversation was spoken into
    /// this phone — in which case the answer is worth saying aloud.
    func lastWordWasSpoken(in threadId: String) -> Bool {
        for case .message(let message) in (state.items[threadId] ?? []).reversed() where message.role == .user {
            return message.via == .voice && message.deviceId == computer.deviceId
        }
        return false
    }
}
