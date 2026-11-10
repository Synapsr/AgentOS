import Foundation
import Testing
@testable import AgentOS

/// The event reducer: `ComputerState` kept current by events.
@Suite struct StoreTests {
    // MARK: A real session

    @Test func replayingARealSessionRebuildsWhatTheComputerHolds() throws {
        var state = ComputerState()
        for frame in try Fixture.frames("session.jsonl") {
            switch frame {
            case .ready(let seq, let reset, let node, let status): state.ready(seq: seq, reset: reset, node: node, status: status)
            case .event(let event): state.apply(event)
            case .pong, .unknown: break
            }
        }
        // Events alone lead to exactly what the HTTP API then answers.
        let threads = try Fixture.decode(ThreadsResponse.self, from: "threads.json").threads
        let main = try Fixture.decode(ItemsResponse.self, from: "items.json")
        let job = try Fixture.decode(ItemsResponse.self, from: "job-items.json")
        #expect(state.threads == Dictionary(uniqueKeysWithValues: threads.map { ($0.id, $0) }))
        #expect(state.items[mainThread] == main.items)
        #expect(state.items[job.thread.id] == job.items)
        #expect(state.jobs.map(\.title) == ["Practice run"])

        #expect(state.seq == 111)
        #expect(state.status?.state == .idle)
        #expect(state.node?.autonomy == .balanced)
        // Everything asked was answered or dropped; nothing is half-typed.
        #expect(state.pending.isEmpty)
        #expect(state.typing.isEmpty)
    }

    @Test func aRequestIsPendingFromTheMomentItIsAskedUntilItIsSettled() throws {
        var state = ComputerState()
        var waiting: [Int] = []
        for event in try Fixture.events("session.jsonl") {
            state.apply(event)
            waiting.append(state.pending.count)
        }
        // Three requests, one at a time.
        #expect(waiting.max() == 1)
        #expect(waiting.reduce(into: (previous: 0, asked: 0)) { run, count in
            if count > run.previous { run.asked += 1 }
            run.previous = count
        }.asked == 3)
    }

    // MARK: Replay

    @Test func eventsAlreadyAppliedAreIgnored() throws {
        let events = try Fixture.events("session.jsonl")
        var once = ComputerState()
        events.forEach { once.apply($0) }

        // Reconnecting with an overlapping `since` replays some of them.
        var twice = once
        events.filter { $0.seq > 0 }.suffix(40).forEach { twice.apply($0) }
        #expect(twice.items == once.items)
        #expect(twice.threads == once.threads)
        #expect(twice.seq == once.seq)
    }

    @Test func catchingUpAfterAGapGivesTheSameStateAsNeverLeaving() throws {
        let events = try Fixture.events("session.jsonl")
        var always = ComputerState()
        events.forEach { always.apply($0) }

        // Leave in the middle of the session; on return the computer
        // replays what is stored (deltas are not).
        var away = ComputerState()
        events.prefix(60).forEach { away.apply($0) }
        events.filter { $0.seq > away.seq }.forEach { away.apply($0) }
        #expect(away.items == always.items)
        #expect(away.threads == always.threads)
        #expect(away.pending == always.pending)
        #expect(away.typing.isEmpty)
    }

    // MARK: Deltas

    @Test func deltasBuildTheMessageBeingTyped() {
        var state = ComputerState()
        state.apply(delta("msg_1", "Done"))
        state.apply(delta("msg_1", " — want me"))
        state.apply(delta("msg_1", " to deploy?"))
        #expect(state.typing[mainThread] == .init(messageId: "msg_1", text: "Done — want me to deploy?"))
        #expect(state.seq == 0)

        // The whole message replaces what was being typed.
        state.apply(Event(seq: 1, at: .now, kind: .itemAdded(.message(message("msg_1", "Done — want me to deploy?")))))
        #expect(state.typing[mainThread] == nil)
        #expect(state.items[mainThread]?.count == 1)

        // A straggler for a message that has arrived changes nothing.
        state.apply(delta("msg_1", "?"))
        #expect(state.typing[mainThread] == nil)
    }

    @Test func aNewMessageStartsAfresh() {
        var state = ComputerState()
        state.apply(delta("msg_1", "First"))
        state.apply(delta("msg_2", "Second"))
        #expect(state.typing[mainThread] == .init(messageId: "msg_2", text: "Second"))

        state.apply(delta("msg_9", "Elsewhere", in: "thr_job"))
        #expect(state.typing.count == 2)

        // The end of the turn clears what an interrupted message left behind.
        state.apply(Event(seq: 1, at: .now, kind: .turnCompleted(threadId: mainThread, ok: false, text: "")))
        #expect(state.typing[mainThread] == nil)
        #expect(state.typing["thr_job"] != nil)
    }

    // MARK: Requests

    @Test func resolvingARequestUpdatesItInPlace() throws {
        let asked = try Fixture.decode(RequestsResponse.self, from: "requests.json").requests[0]
        let answered = try Fixture.decode(ResolveResponse.self, from: "resolve.json").request
        #expect(asked.id == answered.id)

        var state = ComputerState()
        state.apply(Event(seq: 1, at: .now, kind: .itemAdded(.request(asked))))
        #expect(state.pending == [asked])

        // The answer the phone gets back over HTTP is applied at once…
        state.upsert(.request(answered))
        #expect(state.pending.isEmpty)
        #expect(state.items[mainThread] == [.request(answered)])

        // …and the event that follows changes nothing.
        state.apply(Event(seq: 2, at: .now, kind: .itemUpdated(.request(answered))))
        #expect(state.pending.isEmpty)
        #expect(state.items[mainThread] == [.request(answered)])
    }

    @Test func attentionIsWhatTheOwnerShouldHearAbout() throws {
        let asked = try Fixture.decode(RequestsResponse.self, from: "requests.json").requests[0]
        let answered = try Fixture.decode(ResolveResponse.self, from: "resolve.json").request

        guard case .request(let request) = Attention(Event(seq: 1, at: .now, kind: .itemAdded(.request(asked)))) else {
            Issue.record("a new request deserves attention")
            return
        }
        #expect(request == asked)
        guard case .settled(asked.id) = Attention(Event(seq: 2, at: .now, kind: .itemUpdated(.request(answered)))) else {
            Issue.record("an answered request should be withdrawn")
            return
        }
        guard case .turn(mainThread, "Done.") = Attention(Event(seq: 3, at: .now, kind: .turnCompleted(threadId: mainThread, ok: true, text: "Done."))) else {
            Issue.record("the end of a turn deserves attention")
            return
        }
        // A turn the owner stopped has nothing to say.
        #expect(Attention(Event(seq: 4, at: .now, kind: .turnCompleted(threadId: mainThread, ok: false, text: ""))) == nil)
        #expect(Attention(delta("msg_1", "Hi")) == nil)
    }

    // MARK: Reset

    @Test func aResetDropsEverything() throws {
        var state = ComputerState()
        try Fixture.events("session.jsonl").forEach { state.apply($0) }
        state.typing[mainThread] = .init(messageId: "msg_x", text: "half a sen")
        #expect(state.items[mainThread]?.isEmpty == false)

        guard case .ready(let seq, let reset, let node, let status) = try Fixture.frames("ready-reset.json")[0] else { return }
        state.ready(seq: seq, reset: reset, node: node, status: status)
        #expect(state.items.isEmpty)
        #expect(state.threads.isEmpty)
        #expect(state.pending.isEmpty)
        #expect(state.typing.isEmpty)
        #expect(state.hasEarlier.isEmpty)
        #expect(state.seq == seq)
        #expect(state.node == node)

        // What is loaded next is all there is.
        let page = try Fixture.decode(ItemsResponse.self, from: "items.json")
        state.load(threads: try Fixture.decode(ThreadsResponse.self, from: "threads.json").threads)
        state.load(page)
        #expect(state.items[mainThread] == page.items)
        #expect(state.hasEarlier[mainThread] == false)
    }

    @Test func readyWithoutResetKeepsWhatIsThere() throws {
        var state = ComputerState()
        try Fixture.events("session.jsonl").forEach { state.apply($0) }
        let items = state.items
        guard case .ready(_, _, let node, let status) = try Fixture.frames("session.jsonl")[0] else { return }
        state.ready(seq: state.seq, reset: false, node: node, status: status)
        #expect(state.items == items)
        #expect(state.seq == 111)
    }

    // MARK: Threads and pages

    @Test func deletingAThreadForgetsAllOfIt() throws {
        var state = ComputerState()
        try Fixture.events("session.jsonl").forEach { state.apply($0) }
        let job = try #require(state.jobs.first)
        state.typing[job.id] = .init(messageId: "msg_x", text: "…")
        state.hasEarlier[job.id] = false

        state.apply(Event(seq: 500, at: .now, kind: .threadDeleted(threadId: job.id)))
        #expect(state.threads[job.id] == nil)
        #expect(state.items[job.id] == nil)
        #expect(state.typing[job.id] == nil)
        #expect(state.hasEarlier[job.id] == nil)
        #expect(state.jobs.isEmpty)
        #expect(state.items[mainThread]?.isEmpty == false)
    }

    @Test func loadingAPageKeepsWhatArrivedMeanwhile() throws {
        let page = try Fixture.decode(ItemsResponse.self, from: "items.json")
        var state = ComputerState()
        // An event lands between asking for the page and getting it.
        let late = message("msg_late", "One more thing", at: page.items.last!.at.addingTimeInterval(1))
        state.apply(Event(seq: 200, at: .now, kind: .itemAdded(.message(late))))
        state.load(page)
        #expect(state.items[mainThread] == page.items + [.message(late)])
    }

    @Test func anOlderPageGoesInFrontWithoutDuplicates() throws {
        let all = try Fixture.decode(ItemsResponse.self, from: "items.json")
        let recent = Array(all.items.suffix(5))
        var state = ComputerState()
        state.load(ItemsResponse(thread: all.thread, items: recent, hasMore: true))
        #expect(state.hasEarlier[mainThread] == true)

        // The older page overlaps the newest by two items.
        let older = Array(all.items.dropLast(3))
        state.load(ItemsResponse(thread: all.thread, items: older, hasMore: false), older: true)
        #expect(state.items[mainThread] == all.items)
        #expect(state.hasEarlier[mainThread] == false)
    }

    // MARK: Helpers

    private func delta(_ messageId: String, _ text: String, in threadId: String = mainThread) -> Event {
        Event(seq: 0, at: .now, kind: .messageDelta(threadId: threadId, messageId: messageId, text: text))
    }

    private func message(_ id: String, _ text: String, at: Date = .now) -> MessageItem {
        MessageItem(id: id, threadId: mainThread, at: at, role: .agent, text: text, via: .text, deviceId: nil, files: [])
    }
}
