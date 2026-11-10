import Foundation
import Testing
import UserNotifications
@testable import AgentOS

@Suite struct ProtocolTests {
    // MARK: Frames and events

    @Test func decodesEveryFrameOfARealSession() throws {
        let frames = try Fixture.frames("session.jsonl")
        #expect(frames.count == 157)

        var kinds: [String: Int] = [:]
        for frame in frames {
            switch frame {
            case .ready: kinds["ready", default: 0] += 1
            case .pong: kinds["pong", default: 0] += 1
            case .unknown(let type): Issue.record("unknown frame \(type)")
            case .event(let event):
                switch event.kind {
                case .nodeStatus: kinds["node.status", default: 0] += 1
                case .nodeUpdated: kinds["node.updated", default: 0] += 1
                case .threadUpdated: kinds["thread.updated", default: 0] += 1
                case .threadDeleted: kinds["thread.deleted", default: 0] += 1
                case .itemAdded: kinds["item.added", default: 0] += 1
                case .itemUpdated: kinds["item.updated", default: 0] += 1
                case .messageDelta: kinds["message.delta", default: 0] += 1
                case .turnCompleted: kinds["turn.completed", default: 0] += 1
                case .unknown(let type): Issue.record("unknown event \(type)")
                }
            }
        }
        #expect(kinds == [
            "ready": 1, "pong": 1, "node.status": 30, "node.updated": 2, "thread.updated": 29,
            "item.added": 27, "item.updated": 12, "message.delta": 48, "turn.completed": 7,
        ])
    }

    @Test func decodesReady() throws {
        guard case .ready(let seq, let reset, let node, let status) = try Fixture.frames("session.jsonl")[0] else {
            Issue.record("the first frame should be ready")
            return
        }
        #expect(seq == 4)
        #expect(!reset)
        #expect(node.name == "Mac mini")
        #expect(node.agent.name == "Nova")
        #expect(node.owner.name == "Alex")
        #expect(node.platform == .macos)
        #expect(node.protocol == protocolVersion)
        #expect(node.language == "en")
        #expect(node.autonomy == .balanced)
        #expect(node.capabilities.engine == "mock")
        #expect(node.capabilities.voice == VoiceCapabilities(provider: "device", stt: .device, tts: .device, ttsMime: nil))
        #expect(status == NodeStatus(state: .idle, activity: nil, mode: .desktop, pendingRequests: 0, workingThreads: 0))

        guard case .ready(_, let resetAfterGap, _, _) = try Fixture.frames("ready-reset.json")[0] else {
            Issue.record("expected ready")
            return
        }
        #expect(resetAfterGap)
    }

    @Test func decodesMessages() throws {
        let messages = try Fixture.events("session.jsonl").compactMap { event -> MessageItem? in
            if case .itemAdded(.message(let message)) = event.kind { message } else { nil }
        }
        let typed = try #require(messages.first)
        #expect(typed.role == .user)
        #expect(typed.text == "Hello there")
        #expect(typed.via == .text)
        #expect(typed.threadId == mainThread)
        #expect(typed.deviceId == nil)
        #expect(typed.files.isEmpty)
        // Timestamps are milliseconds since 1970.
        #expect(typed.at == Date(timeIntervalSince1970: 1_794_266_722.157))

        #expect(messages.contains { $0.role == .user && $0.via == .voice })
        let reply = try #require(messages.first { $0.role == .agent })
        #expect(reply.text.hasPrefix("You said “Hello there”."))
    }

    @Test func decodesActivities() throws {
        let events = try Fixture.events("session.jsonl")
        let started = try #require(events.lazy.compactMap { event -> ActivityItem? in
            if case .itemAdded(.activity(let activity)) = event.kind { activity } else { nil }
        }.first)
        #expect(started.label == "Thinking")
        #expect(started.state == .running)
        #expect(started.endedAt == nil)
        #expect(started.tool == nil)

        let ended = try #require(events.lazy.compactMap { event -> ActivityItem? in
            if case .itemUpdated(.activity(let activity)) = event.kind, activity.id == started.id { activity } else { nil }
        }.first)
        #expect(ended.state == .done)
        #expect(ended.endedAt != nil)

        // Some activities name the tool behind them, and may arrive already over.
        let reported = events.lazy.compactMap { event -> ActivityItem? in
            if case .itemAdded(.activity(let activity)) = event.kind, activity.state == .done { activity } else { nil }
        }.first
        #expect(reported?.label == "Finished: Practice run")
        #expect(reported?.tool == "job")
        #expect(reported?.detail == "All 3 steps are done.")
        #expect(reported?.endedAt != nil)
    }

    @Test func decodesRequests() throws {
        let events = try Fixture.events("session.jsonl")
        let asked = events.compactMap { event -> RequestItem? in
            if case .itemAdded(.request(let request)) = event.kind { request } else { nil }
        }
        let settled = events.compactMap { event -> RequestItem? in
            if case .itemUpdated(.request(let request)) = event.kind { request } else { nil }
        }
        #expect(asked.count == 3)
        #expect(asked.allSatisfy { $0.state == .pending && $0.resolution == nil })

        // The agent's own question, with what it sees and its own options.
        let question = try #require(asked.first { $0.kind == .question })
        #expect(question.title == "Everything looks good. Deploy to production?")
        #expect(question.spoken == question.title)
        #expect(question.body == nil)
        #expect(question.risk == .medium)
        #expect(question.allowText)
        #expect(question.screenshot == FileRef(id: "file_19dec4fd895112f6.jpg", mime: "image/jpeg", width: 1280, height: 829))
        #expect(question.options.map(\.id) == ["option_1", "option_2"])
        #expect(question.options.map(\.label) == ["Deploy", "Not now"])
        #expect(question.options.map(\.style) == [.primary, .default])

        // An approval the safety policy asked for: always approve / deny.
        let approval = try #require(asked.first { $0.kind == .approval })
        #expect(approval.options.map(\.id) == [RequestItem.Option.approve, RequestItem.Option.deny])
        #expect(approval.options.map(\.style) == [.primary, .danger])
        #expect(approval.title == "Nova wants to delete files")
        #expect(approval.body == "rm -rf ./build")
        #expect(approval.risk == .high)
        #expect(approval.screenshot == nil)
        // It is answered with a button; words go through the conversation.
        #expect(!approval.allowText)

        let answered = try #require(settled.first { $0.id == question.id })
        #expect(answered.state == .resolved)
        #expect(answered.resolution?.optionId == "option_1")
        #expect(answered.resolution?.text == nil)

        let refused = try #require(settled.first { $0.id == approval.id })
        #expect(refused.resolution?.optionId == RequestItem.Option.deny)
        #expect(refused.resolution?.text == "not now")

        let dropped = try #require(settled.first { $0.state == .cancelled })
        #expect(dropped.resolution == nil)
    }

    @Test func decodesTheOtherEvents() throws {
        let events = try Fixture.events("session.jsonl")

        let status = events.lazy.compactMap { event -> NodeStatus? in
            if case .nodeStatus(let status) = event.kind, status.state == .working { status } else { nil }
        }.first
        #expect(status?.workingThreads == 1)

        let job = events.lazy.compactMap { event -> ThreadInfo? in
            if case .threadUpdated(let thread) = event.kind, thread.kind == .job { thread } else { nil }
        }.first
        #expect(job?.title == "Practice run")
        #expect(job?.parentId == mainThread)

        let delta = try #require(events.first { if case .messageDelta = $0.kind { true } else { false } })
        #expect(delta.seq == 0)
        guard case .messageDelta(let threadId, let messageId, let text) = delta.kind else { return }
        #expect(threadId == mainThread)
        #expect(messageId.hasPrefix("msg_"))
        #expect(text == "You ")

        let turns = events.compactMap { event -> (ok: Bool, text: String)? in
            if case .turnCompleted(_, let ok, let text) = event.kind { (ok, text) } else { nil }
        }
        #expect(turns.contains { $0.ok && $0.text == "Done, it's live." })
        #expect(turns.contains { !$0.ok && $0.text == "Something went wrong on my side. Shall we try again?" })

        guard case .event(let deleted) = try Fixture.frames("thread-deleted.json")[0],
              case .threadDeleted(let deletedId) = deleted.kind else {
            Issue.record("expected thread.deleted")
            return
        }
        #expect(deletedId == "thr_0000000000000000")
    }

    @Test func toleratesWhatANewerComputerMightSend() throws {
        let frame = try Wire.decode(ServerFrame.self, from: Data(#"{"type":"hologram","depth":3}"#.utf8))
        guard case .unknown("hologram") = frame else {
            Issue.record("an unknown frame should decode as unknown")
            return
        }
        let event = try Wire.decode(Event.self, from: Data(#"{"type":"mood.changed","mood":"calm","seq":9,"at":1}"#.utf8))
        guard case .unknown("mood.changed") = event.kind else {
            Issue.record("an unknown event should decode as unknown")
            return
        }
        #expect(event.seq == 9)
        #expect(throws: DecodingError.self) {
            try Wire.decode(Item.self, from: Data(#"{"type":"poem","id":"x","threadId":"main","at":1}"#.utf8))
        }
    }

    // MARK: HTTP bodies

    @Test func decodesHello() throws {
        let hello = try Fixture.decode(HelloResponse.self, from: "hello.json")
        #expect(hello.app == "agentos")
        #expect(hello.protocol == protocolVersion)
        #expect(hello.node.id == "node_edf38b5bcc8dbd71")
        #expect(hello.node.agentName == "Nova")
    }

    @Test func decodesPairing() throws {
        let paired = try Fixture.decode(PairResponse.self, from: "pair.json")
        #expect(paired.token == "example-token-shown-only-once")
        #expect(paired.device.platform == .ios)
        #expect(paired.device.name == "iPhone")
        #expect(paired.device.lastSeenAt == nil)
        #expect(paired.node.id == "node_edf38b5bcc8dbd71")
    }

    @Test func decodesNodeThreadsAndTimelines() throws {
        let node = try Fixture.decode(NodeResponse.self, from: "node.json")
        #expect(node.node.onboarded)
        #expect(node.status.mode == .desktop)

        let threads = try Fixture.decode(ThreadsResponse.self, from: "threads.json").threads
        #expect(threads.map(\.kind) == [.main, .job])
        #expect(threads[0].id == mainThread)
        #expect(threads[1].state == .idle)

        let page = try Fixture.decode(ItemsResponse.self, from: "items.json")
        #expect(page.thread.id == mainThread)
        #expect(page.items.count == 22)
        #expect(!page.hasMore)

        let pending = try Fixture.decode(RequestsResponse.self, from: "requests.json").requests
        #expect(pending.map(\.state) == [.pending])

        let sent = try Fixture.decode(SendMessageResponse.self, from: "send.json").item
        #expect(sent.text == "Hello there")

        let resolved = try Fixture.decode(ResolveResponse.self, from: "resolve.json").request
        #expect(resolved.state == .resolved)
    }

    @Test func decodesErrors() throws {
        let error = try Fixture.decode(APIError.self, from: "error.json")
        #expect(error.error.code == "unauthorized")
        #expect(error.error.message == "This code is not valid any more. Show a new one.")
    }

    // MARK: Push notifications

    @Test func readsThePayloadOfAPush() throws {
        // As `packages/protocol/src/push.ts` describes it, after APNs.
        let push = try JSONSerialization.jsonObject(with: Data("""
            {
              "aps": {
                "alert": { "title": "Nova", "body": "I'd like to delete some files. Can I go ahead?" },
                "sound": "default", "category": "AGENTOS_APPROVAL", "thread-id": "main",
                "interruption-level": "time-sensitive", "mutable-content": 1
              },
              "agentos": {
                "version": 1, "nodeId": "node_edf38b5bcc8dbd71", "kind": "request",
                "threadId": "main", "requestId": "req_1", "screenshotId": null, "risk": "high"
              }
            }
            """.utf8)) as! [AnyHashable: Any]
        let payload = try #require(PushPayload(userInfo: push))
        #expect(payload == PushPayload(nodeId: "node_edf38b5bcc8dbd71", kind: .request, threadId: "main", requestId: "req_1", risk: .high))
        #expect(PushCategory.approval == "AGENTOS_APPROVAL")
        #expect(PushCategory.question == "AGENTOS_QUESTION")
        #expect(PushCategory.turn == "AGENTOS_TURN")
    }

    @Test func aNotificationPostedByTheAppCarriesTheSamePayload() throws {
        let posted = PushPayload(nodeId: "node_1", kind: .turn, threadId: "thr_2")
        #expect(PushPayload(userInfo: posted.userInfo) == posted)
        let asked = PushPayload(nodeId: "node_1", kind: .request, threadId: "main", requestId: "req_9", screenshotId: "file_3.jpg", risk: .medium)
        #expect(PushPayload(userInfo: asked.userInfo) == asked)
    }

    @Test func aPushWithoutRiskIsStillRead() {
        // From a computer that does not send it yet, or a finished turn (`risk: null`).
        let older = PushPayload(userInfo: ["agentos": ["version": 1, "nodeId": "n", "kind": "request", "threadId": "main", "requestId": "req_1"]])
        #expect(older?.requestId == "req_1")
        #expect(older?.risk == nil)
        let turn = PushPayload(userInfo: ["agentos": ["version": 1, "nodeId": "n", "kind": "turn", "threadId": "main", "requestId": NSNull(), "screenshotId": NSNull(), "risk": NSNull()]])
        #expect(turn?.kind == .turn)
        #expect(turn?.risk == nil)
    }

    /// At high risk the lock screen says so, and the safe answer comes first.
    @Test func aRiskyRequestIsDressedForTheLockScreen() {
        let content = UNMutableNotificationContent()
        content.title = "Nova"
        content.categoryIdentifier = PushCategory.approval
        RequestNotification.dress(content, agentName: "Nova", risk: .high)
        #expect(content.title == String(localized: "\("Nova") is asking"))
        #expect(content.subtitle == String(localized: "Worth a careful look"))
        #expect(content.categoryIdentifier == RequestNotification.carefulApproval)

        let calm = UNMutableNotificationContent()
        calm.categoryIdentifier = PushCategory.approval
        RequestNotification.dress(calm, agentName: "Nova", risk: .medium)
        #expect(calm.subtitle.isEmpty)
        #expect(calm.categoryIdentifier == PushCategory.approval)

        let question = UNMutableNotificationContent()
        question.categoryIdentifier = PushCategory.question
        RequestNotification.dress(question, agentName: "Nova", risk: .high)
        #expect(question.categoryIdentifier == PushCategory.question)
    }

    @Test func stopComesFirstOnlyAtHighRisk() async {
        let categories = await UNUserNotificationCenter.current().notificationCategories()
        let careful = categories.first { $0.identifier == RequestNotification.carefulApproval }
        let usual = categories.first { $0.identifier == PushCategory.approval }
        #expect(careful?.actions.map(\.identifier) == [RequestItem.Option.deny, RequestItem.Option.approve])
        #expect(usual?.actions.map(\.identifier) == [RequestItem.Option.approve, RequestItem.Option.deny])
        // Stop is the safe answer: never painted as danger.
        #expect(careful?.actions.allSatisfy { !$0.options.contains(.destructive) } == true)
    }

    @Test func ignoresPushesItDoesNotUnderstand() {
        #expect(PushPayload(userInfo: [:]) == nil)
        #expect(PushPayload(userInfo: ["agentos": "soon"]) == nil)
        #expect(PushPayload(userInfo: ["agentos": ["version": 2, "nodeId": "n", "kind": "request", "threadId": "main"]]) == nil)
        #expect(PushPayload(userInfo: ["agentos": ["version": 1, "nodeId": "n", "kind": "confetti", "threadId": "main"]]) == nil)
    }

    // MARK: What the phone sends

    /// Whoever holds a locked phone must not be able to tell the computer anything.
    /// The app registered its categories as it launched: this reads them back.
    @Test func everyNotificationActionAsksForAnUnlockedPhone() async {
        let categories = await UNUserNotificationCenter.current().notificationCategories()
        let actions = categories.filter { $0.identifier.hasPrefix("AGENTOS_") }.flatMap(\.actions)
        #expect(actions.count >= 4)
        for action in actions {
            #expect(action.options.contains(.authenticationRequired), "\(action.identifier) can be used on a locked phone")
        }
    }

    @Test func aMessageThatNamesARequestComesBackWithThatRequest() throws {
        // What the computer answers without `requestId`…
        #expect(try Fixture.decode(SendMessageResponse.self, from: "send.json").request == nil)
        // …and with it: the request as it stands afterwards.
        var answer = try #require(try JSONSerialization.jsonObject(with: Fixture.data("send.json")) as? [String: Any])
        let resolved = try #require(try JSONSerialization.jsonObject(with: Fixture.data("resolve.json")) as? [String: Any])
        answer["request"] = resolved["request"]
        let response = try Wire.decode(SendMessageResponse.self, from: JSONSerialization.data(withJSONObject: answer))
        #expect(response.request?.state == .resolved)
    }

    @Test func encodesRequestsAsTheProtocolExpects() throws {
        #expect(try json(PairRequest(code: "abc", device: .init(name: "iPhone", platform: .ios)))
            == ["code": "abc", "device": ["name": "iPhone", "platform": "ios"]])
        // Without a request to answer, `requestId` is left out: the computer reads that as null.
        #expect(try json(SendMessageRequest(text: "Hi", via: .voice, requestId: nil)) == ["text": "Hi", "via": "voice"])
        #expect(try json(SendMessageRequest(text: "Yes", via: .voice, requestId: "req_1"))
            == ["text": "Yes", "via": "voice", "requestId": "req_1"])
        #expect(try json(ResolveRequest(optionId: "approve", text: nil)) == ["optionId": "approve"])
        #expect(try json(ResolveRequest(optionId: nil, text: "yes")) == ["text": "yes"])
        #expect(try json(SpeakRequest(text: "Hello")) == ["text": "Hello"])
        #expect(try json(ClientFrame.ping) == ["type": "ping"])
        #expect(try json(ClientFrame.presence(active: true)) == ["type": "presence", "active": true])
        #expect(try json(PushRegistration(kind: .apns, token: "0a1b", sandbox: true))
            == ["kind": "apns", "token": "0a1b", "sandbox": true])
        // `token` is nullable but required: it must be present as null.
        #expect(try json(PushRegistration(kind: .none, token: nil, sandbox: false))
            == ["kind": "none", "token": NSNull(), "sandbox": false])
    }

    private func json(_ value: some Encodable) throws -> NSDictionary {
        try #require(try JSONSerialization.jsonObject(with: Wire.encode(value)) as? NSDictionary)
    }
}
