import SwiftUI

/// A conversation with the agent — the main one, or a background job:
/// what was said, what the agent did as quiet single lines, and what it
/// asked as cards. A utility surface: it follows the system's appearance.
///
/// Nothing here moves in a loop: the presence, pinned above, is what shows
/// that the agent is alive.
struct ConversationView: View {
    let store: ComputerStore
    let threadId: String

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @FocusState private var isTyping: Bool

    private var thread: ThreadInfo? { store.state.threads[threadId] }

    /// What is drawn: the timeline, with consecutive activities as one group.
    private enum Block: Identifiable {
        case message(MessageItem)
        case activities([ActivityItem])
        case request(RequestItem)

        var id: String {
            switch self {
            case .message(let item): item.id
            case .activities(let items): items[0].id
            case .request(let item): item.id
            }
        }
    }

    private var blocks: [Block] {
        var blocks: [Block] = []
        for item in store.state.items[threadId] ?? [] {
            switch (item, blocks.last) {
            case (.message(let message), _): blocks.append(.message(message))
            case (.activity(let activity), .activities(let group)): blocks[blocks.count - 1] = .activities(group + [activity])
            case (.activity(let activity), _): blocks.append(.activities([activity]))
            case (.request(let request), _): blocks.append(.request(request))
            }
        }
        return blocks
    }

    var body: some View {
        let blocks = blocks
        let typing = store.state.typing[threadId]
        // The agent's turn: from the moment a message is sent there is a row
        // for it at the end — "I'm on it." until an activity, a question or
        // its words take the place.
        let isTurn = thread?.state == .working && typing == nil && Self.leavesTheTurnOpen(blocks.last)
        VStack(spacing: 0) {
            header
            ScrollView {
                // Not lazy: a page of the conversation is short, and its end must stay in view as it grows.
                VStack(alignment: .leading, spacing: Tokens.Space.s16) {
                    if store.state.hasEarlier[threadId] == true {
                        Button("Show earlier") { Task { await store.loadEarlier(in: threadId) } }
                            .buttonStyle(.capsule(.quiet, size: .sm))
                            .frame(maxWidth: .infinity)
                    }
                    if blocks.isEmpty, typing == nil, !isTurn {
                        Suggestions(agentName: store.computer.agentName) { text in
                            Task { await model.send(text, to: threadId, on: store) }
                        }
                        .disabled(store.presenceState == .offline)
                    }
                    ForEach(blocks) { block in
                        switch block {
                        case .message(let message): MessageRow(message: message)
                        case .activities(let activities): Activities(items: activities, isTurn: isTurn && block.id == blocks.last?.id)
                        case .request(let request): RequestCard(request: request, store: store, look: look)
                        }
                    }
                    if let typing {
                        AgentText(text: typing.text)
                    } else if isTurn, case .activities? = blocks.last {
                        // The row is the group's last line.
                    } else if isTurn {
                        ActivityLine(state: .running, label: String(localized: "I'm on it."))
                            .transition(.arriveLeave)
                    }
                }
                .padding(Tokens.Space.s16)
                .animation(Tokens.Motion.layout.animation, value: isTurn)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            // The top of the conversation fades out instead of ending on a hard edge.
            .mask {
                VStack(spacing: 0) {
                    LinearGradient(colors: [.black.opacity(0), .black], startPoint: .top, endPoint: .bottom)
                        .frame(height: Tokens.Space.s44)
                    Color.black
                }
            }
            Composer(
                prompt: store.presenceState == .offline ? "\(store.computer.agentName) can't hear you right now" : "Talk to \(store.computer.agentName)…",
                isFocused: $isTyping, agentName: store.computer.agentName,
                stop: thread?.state == .working ? { Task { await model.stop(threadId, on: store) } } : nil
            ) { text in
                Task { await model.send(text, to: threadId, on: store) }
            }
            // Out of reach, nothing is sent: the composer says so instead of inviting words.
            .disabled(store.presenceState == .offline)
            .padding(.horizontal, Tokens.Space.s16)
            .padding(.vertical, Tokens.Space.s8)
        }
        .background(Theme.surface)
        .foregroundStyle(Theme.text)
        .task { await store.open(threadId) }
    }

    /// Whether the agent, at work, still owes a sign of life after `last`:
    /// not while its words, a running activity or a question are the last thing said.
    private static func leavesTheTurnOpen(_ last: Block?) -> Bool {
        switch last {
        case .message(let message): message.role != .agent
        case .activities(let items): !items.contains { $0.state == .running }
        case .request(let request): request.state != .pending
        case nil: true
        }
    }

    /// A small presence next to the name and what it is about: it stays in
    /// view while the conversation scrolls.
    private var header: some View {
        HStack(spacing: Tokens.Space.s12) {
            PresenceView(state: store.presenceState, size: Tokens.Stage.panelAsking)
            VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                Text(verbatim: store.computer.agentName)
                    .type(.bodyStrong)
                Text(verbatim: thread?.kind == .job ? thread?.title ?? "" : store.computer.name)
                    .type(.small)
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }
            Spacer()
            RoundButton(icon: "xmark", label: "Close") { dismiss() }
        }
        .padding(.horizontal, Tokens.Space.s16)
        .padding(.top, Tokens.Space.s20)
        .padding(.bottom, Tokens.Space.s8)
        // The conversation passes under it, never over it.
        .background(Theme.surface)
        .zIndex(1)
        .accessibilityElement(children: .contain)
    }

    /// Brings a waiting request in front of the owner, where its picture can be looked at closely.
    private func look(at request: RequestItem) {
        model.show(request)
        dismiss()
    }
}

/// An empty conversation is an invitation: what the agent can do, and
/// three first requests to send with a tap.
private struct Suggestions: View {
    let agentName: String
    var send: (String) -> Void

    var body: some View {
        VStack(spacing: Tokens.Space.s16) {
            Text("What can \(agentName) do for you?")
                .type(.title)
                .multilineTextAlignment(.center)
            VStack(spacing: Tokens.Space.s8) {
                ForEach([
                    String(localized: "Tidy my Downloads folder"),
                    String(localized: "Pay this week's bills"),
                    String(localized: "Back up my photos"),
                ], id: \.self) { suggestion in
                    Button(suggestion) { send(suggestion) }
                        .buttonStyle(.capsule(.secondary, size: .sm))
                }
            }
        }
        .padding(.vertical, Tokens.Space.s24)
        .padding(.horizontal, Tokens.Space.s16)
        .frame(maxWidth: .infinity)
        .raised(in: RoundedRectangle(cornerRadius: Tokens.Radius.xl, style: .continuous))
        .padding(.top, Tokens.Space.s44)
    }
}

/// The owner's words in a bubble on the right; the agent's as plain text.
private struct MessageRow: View {
    let message: MessageItem

    var body: some View {
        if message.role == .agent {
            AgentText(text: message.text)
        } else {
            HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.s8) {
                if message.via == .voice {
                    // The speaking presence as three strokes: this was said aloud.
                    Image(systemName: "waveform")
                        .font(.system(size: Tokens.Size.iconDense))
                        .foregroundStyle(Theme.textDim)
                        .accessibilityLabel("Said aloud")
                }
                Text(message.text)
                    .type(.body)
            }
            .padding(.horizontal, Tokens.Space.s16)
            .padding(.vertical, Tokens.Space.s12)
            .raised(in: RoundedRectangle(cornerRadius: Tokens.Radius.l, style: .continuous))
            .padding(.leading, Tokens.Space.s44)
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }
}

/// What the agent says, with the inline formatting it likes to use.
struct AgentText: View {
    let text: String

    var body: some View {
        Text(Self.formatted(text))
            .type(.bodyL)
            .textSelection(.enabled)
            .padding(.trailing, Tokens.Space.s24)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The agent's words with their inline formatting. A link stays a link
    /// only when it leads to the web: nothing the agent writes — or was
    /// made to write — may open another app, or this one's pairing.
    nonisolated static func formatted(_ text: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        var words = (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
        for run in words.runs {
            guard let link = run.link, !["http", "https"].contains(link.scheme?.lowercased() ?? "") else { continue }
            words[run.range].link = nil
        }
        return words
    }
}

/// What the agent did: one quiet line each while it happens, folded into
/// one once there are several.
private struct Activities: View {
    let items: [ActivityItem]
    /// The agent is still at work, between two activities.
    let isTurn: Bool

    @State private var isOpen = false

    var body: some View {
        let finished = items.filter { $0.state != .running }
        VStack(alignment: .leading, spacing: Tokens.Space.s8) {
            if finished.count > 1 {
                Button {
                    withAnimation(Tokens.Motion.layout.animation) { isOpen.toggle() }
                } label: {
                    HStack(spacing: Tokens.Space.s8) {
                        ActivityLine(state: finished.contains { $0.state == .failed } ? .failed : .done, label: String(localized: "\(finished.count) steps"))
                        Image(systemName: "chevron.right")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.textFaint)
                            .rotationEffect(.degrees(isOpen ? 90 : 0))
                    }
                    .frame(minHeight: Tokens.Size.control)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.vertical, -Tokens.Space.s12)
                .accessibilityValue(isOpen ? Text("On") : Text("Off"))
            }
            if finished.count == 1 || isOpen {
                ForEach(finished, id: \.id) { ActivityLine(state: $0.state, label: $0.label, detail: isOpen ? $0.detail : nil) }
                    .transition(.arriveLeave)
            }
            ForEach(items.filter { $0.state == .running }, id: \.id) { ActivityLine(state: .running, label: $0.label) }
            if isTurn {
                ActivityLine(state: .running, label: String(localized: "I'm on it."))
            }
        }
    }
}

/// One thing the agent is doing or did. The dot of a running one is still:
/// the presence is what moves.
private struct ActivityLine: View {
    let state: ActivityItem.State
    let label: String
    var detail: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.s8) {
            Group {
                switch state {
                case .running: Circle().fill(Theme.working).frame(width: 8, height: 8).alignmentGuide(.firstTextBaseline) { $0.height + 1 }
                case .done: Image(systemName: "checkmark").foregroundStyle(Theme.go)
                case .failed: Image(systemName: "exclamationmark.triangle").foregroundStyle(Theme.careful)
                }
            }
            .font(.system(size: 13, weight: .semibold))
            .frame(width: Tokens.Size.iconDense)
            VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                Text(label)
                    .lineLimit(1)
                if let detail {
                    Text(detail)
                        .type(.code)
                        .foregroundStyle(Theme.textFaint)
                        .lineLimit(3)
                }
            }
        }
        .type(.small)
        .foregroundStyle(Theme.textDim)
        .accessibilityElement(children: .combine)
    }
}

/// "Nova is asking" in the conversation: a card lit by the presence while
/// it waits; once answered, the receipt it leaves for good.
private struct RequestCard: View {
    let request: RequestItem
    let store: ComputerStore
    var look: (RequestItem) -> Void

    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Group {
            if request.state == .pending {
                card
                    .transition(.arriveLeave)
            } else {
                ReceiptRow(kind: request.receiptKind, said: request.said, question: request.title, time: request.resolution?.at)
                    .transition(.arriveLeave)
            }
        }
        .animation(Tokens.Motion.layout.animation, value: request.state)
    }

    private var card: some View {
        let shape = RoundedRectangle(cornerRadius: Tokens.Radius.xl, style: .continuous)
        let light = Tokens.Colors.askingLight.color(colorScheme)
        return VStack(alignment: .leading, spacing: 0) {
            HStack {
                AskingLabel(agentName: store.computer.agentName)
                Spacer()
                Text(request.at, format: .dateTime.hour().minute())
                    .type(.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textFaint)
            }
            .padding(.horizontal, Tokens.Space.s20)
            .padding(.top, Tokens.Space.s20)
            Text(request.title)
                .type(.title)
                .padding(.horizontal, Tokens.Space.s20)
                .padding(.top, Tokens.Space.s12)
            RequestDetails(request: request, store: store) { _ in look(request) }
                .padding(.horizontal, Tokens.Space.s12)
                .padding(.top, Tokens.Space.s16)
            Decision(request: request, stacked: false) { optionId in
                await model.decide(.init(store: store, request: request), optionId: optionId)
            }
            .padding(Tokens.Space.s12)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // Lit by the presence, not outlined as a warning: a warm wash in the
        // corner and a light along the top edge.
        .background {
            RadialGradient(colors: [light.opacity(0.07), light.opacity(0)], center: .topLeading, startRadius: 0, endRadius: 280)
                .clipShape(shape)
        }
        .overlay(alignment: .top) {
            LinearGradient(
                stops: [.init(color: .clear, location: 0.1), .init(color: light.opacity(0.55), location: 0.5), .init(color: .clear, location: 0.9)],
                startPoint: .leading, endPoint: .trailing)
                .frame(height: 1)
        }
        .raised(in: shape)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("\(store.computer.agentName) is asking"))
    }
}
