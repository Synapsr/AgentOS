import SwiftUI

/// Home: the presence on its stage with the agent's name and its line, a
/// large "Tap to talk" and the composer. The computer is named at the top;
/// the conversation is one pull or tap away.
///
/// When the agent asks, the same screen becomes the request: the presence
/// steps aside, "Nova is asking" and the question come under it, then what
/// the agent sees, and the decision in the thumb zone. Once answered, the
/// request folds into its receipt for a moment, then home comes back.
struct HomeView: View {
    let store: ComputerStore
    /// The request in front of the owner, while this computer's agent is asking.
    var asking: RequestItem?
    var openConversation: (_ threadId: String) -> Void
    var openComputers: () -> Void

    @Environment(AppModel.self) private var model
    @State private var zoomed: UIImage?
    @FocusState private var isTyping: Bool
    /// The request on screen. It follows `asking`, but stays a beat once it
    /// is answered, so that the answer is seen landing.
    @State private var request: RequestItem?
    /// The request just answered, shown as its receipt for a moment.
    @State private var receipt: RequestItem?
    /// The owner chose to answer the request in their own words.
    @State private var inWords = false
    /// An answered request is folding into its receipt.
    @State private var isFolding = false

    /// How long a receipt stays, like a toast (docs/DESIGN.md, "Toast").
    private static let receiptTime = 2.4

    var body: some View {
        GeometryReader { screen in
            VStack(spacing: 0) {
                topBar
                GeometryReader { room in
                    ScrollView {
                        VStack(spacing: Tokens.Space.s16) {
                            presence(in: screen.size, room: room.size.height)
                            middle
                        }
                        // At home the figure keeps its place whatever is written under
                        // it; a request is centred, and scrolls when it does not fit.
                        .frame(maxWidth: .infinity, minHeight: room.size.height, alignment: isHome ? .top : .center)
                    }
                    .scrollBounceBehavior(.basedOnSize)
                    .scrollDismissesKeyboard(.interactively)
                }
                .padding(.bottom, Tokens.Space.s16)
                bottom
            }
            .padding(.horizontal, Tokens.Space.s16)
            .padding(.bottom, Tokens.Space.s8)
        }
        // The presence's light falls on the stage around it.
        .backgroundPreferenceValue(StageSpot.self) { spot in
            GeometryReader { proxy in
                if let spot {
                    StageLight(state: presenceState, stage: spot.stage)
                        .position(proxy[spot.center])
                }
            }
        }
        // A tap on the stage puts the keyboard away; pulling up anywhere
        // opens the conversation.
        .background {
            Color.clear.contentShape(Rectangle()).onTapGesture { isTyping = false }
        }
        .simultaneousGesture(DragGesture(minimumDistance: 24).onEnded { drag in
            if isHome, drag.translation.height < -64, abs(drag.translation.width) < 96 { openConversation(mainThread) }
        })
        .overlay {
            if let zoomed {
                ZoomedImage(image: zoomed) { self.zoomed = nil }
                    .transition(.opacity)
            }
        }
        .animation(.fade(Tokens.Motion.base), value: zoomed)
        .animation(Tokens.Motion.layout.animation, value: isTyping)
        .onChange(of: asking, initial: true) { _, next in follow(next) }
        .onChange(of: request?.id) {
            zoomed = nil
            inWords = false
            if request != nil { Haptics.play(Tokens.Haptic.requestArrives) }
        }
        // The line is news: read it out, unless it is already being said or heard.
        .onChange(of: line.text) { _, text in
            guard model.voice.activity == .idle, !line.isGrowing else { return }
            var words = AttributedString(text)
            words.accessibilitySpeechAnnouncementPriority = .low
            AccessibilityNotification.Announcement(words).post()
        }
    }

    /// Nothing asked, nothing just answered.
    private var isHome: Bool { request == nil && receipt == nil }

    /// Takes the request to show from `asking`. One that was just answered —
    /// here, on the watch or on the computer — first folds into its receipt.
    private func follow(_ next: RequestItem?) {
        if next?.id == request?.id {
            request = next
            return
        }
        // A receipt on its way or on screen finishes first; the next request comes after it.
        guard receipt == nil, !isFolding else { return }
        guard let leaving = request, let settled = store.settled(leaving) else {
            withAnimation(Tokens.Motion.gesture.animation) { request = next }
            return
        }
        isFolding = true
        Task {
            // The chosen button's check lands, then the request folds.
            try? await Task.sleep(for: .seconds(Tokens.Motion.resolveFold))
            withAnimation(Tokens.Motion.layout.animation) {
                request = nil
                receipt = settled
            }
            isFolding = false
            try? await Task.sleep(for: .seconds(Self.receiptTime))
            withAnimation(Tokens.Motion.layout.animation) {
                receipt = nil
                request = model.asking?.store === store ? model.asking?.request : nil
            }
        }
    }

    // MARK: The presence

    /// The presence with its label. The stage follows the room there is —
    /// less with the keyboard up — and steps aside for a request.
    private func presence(in box: CGSize, room: CGFloat) -> some View {
        let stage = isHome ? Tokens.Stage.home.size(in: box) : Tokens.Stage.homeAsking
        // At home the figure sits a little above the middle of what is left
        // once it and three lines of words have their room, and stays there
        // whatever is written under it.
        let above = isHome ? max(0, (room - stage - 120) * 0.4) : 0
        return PresenceWithLabel(
            name: isHome ? store.computer.agentName : nil,
            state: presenceState, line: isHome ? line.text : nil, lineIsGrowing: line.isGrowing,
            stage: stage, level: { model.voice.level }, pulse: store.presencePulse)
        // A tap, not a button: a pull that starts here must stay a pull.
        .contentShape(Rectangle())
        .onTapGesture {
            guard isHome else { return }
            // A request that was set aside comes back; otherwise, the conversation.
            if let waiting = store.state.pending.first {
                model.show(waiting)
            } else {
                openConversation(mainThread)
            }
        }
        .accessibilityAddTraits(isHome ? .isButton : [])
        .accessibilityHint(isHome ? Text("Opens the conversation") : Text(verbatim: ""))
        .padding(.top, above)
    }

    /// Under the presence: the request, its receipt, or what goes on.
    @ViewBuilder
    private var middle: some View {
        if let request {
            VStack(spacing: Tokens.Space.s16) {
                VStack(spacing: Tokens.Space.s8) {
                    AskingLabel(agentName: store.computer.agentName)
                        .arrive(0)
                    Text(request.title)
                        .type(.displayS)
                        .multilineTextAlignment(.center)
                        .accessibilityAddTraits(.isHeader)
                        .arrive(1)
                }
                RequestDetails(request: request, store: store, onScreen: true, arriving: 2) { zoomed = $0 }
            }
            .id(request.id)
            .transition(.arriveLeave)
        } else if let receipt {
            ReceiptMoment(kind: receipt.receiptKind, said: receipt.said, question: receipt.title)
                .padding(.top, Tokens.Space.s8)
                .transition(.arriveLeave)
        } else if !isTyping {
            VStack(spacing: Tokens.Space.s16) {
                if store.link == .offline {
                    Button("Try again") { store.retry() }
                        .buttonStyle(.capsule(.secondary))
                } else if store.presenceState != .offline {
                    // What is known of the jobs is only true while the computer answers.
                    VStack(spacing: Tokens.Space.s8) {
                        ForEach(jobs) { job in
                            JobChip(job: job) { openConversation(job.id) }
                        }
                    }
                }
            }
            .transition(.opacity)
        }
    }

    /// Background jobs: the ones at work or asking first, three at most.
    private var jobs: [ThreadInfo] {
        let jobs = store.state.jobs
        let busy = jobs.filter { $0.state == .working || $0.state == .waiting }
        return Array((busy + jobs.filter { $0.state != .working && $0.state != .waiting }).prefix(3))
    }

    // MARK: The bottom: the decision, or talking

    @ViewBuilder
    private var bottom: some View {
        if let request {
            VStack(spacing: Tokens.Space.s12) {
                Decision(request: request) { optionId in
                    await model.decide(.init(store: store, request: request), optionId: optionId)
                }
                if request.allowText {
                    if inWords {
                        Composer(prompt: "Answer in your own words…", isFocused: $isTyping) { text in
                            isTyping = false
                            Task { await model.answer(.init(store: store, request: request), text: text) }
                        }
                        .transition(.arriveLeave)
                    } else {
                        Button("Answer in your own words") {
                            withAnimation(Tokens.Motion.layout.animation) { inWords = true }
                            isTyping = true
                        }
                        .buttonStyle(.capsule(.quiet, wide: true))
                    }
                }
            }
            .id(request.id)
            .arrive(5)
            .transition(.arriveLeave)
        } else if receipt == nil {
            // Out of reach, nothing invites talking: the line says why, the
            // composer says so in its place.
            let canHear = store.presenceState != .offline
            VStack(spacing: Tokens.Space.s16) {
                if !isTyping {
                    TalkButton()
                        .transition(.opacity)
                }
                Composer(
                    prompt: canHear ? "Talk to \(store.computer.agentName)…" : "\(store.computer.agentName) can't hear you right now",
                    isFocused: $isTyping, agentName: store.computer.agentName,
                    stop: store.isWorking ? { Task { await model.stop(on: store) } } : nil
                ) { text in
                    isTyping = false
                    Task { await model.send(text, on: store) }
                }
            }
            .disabled(!canHear)
            .transition(.arriveLeave)
        }
    }

    // MARK: Top: the computer, the earbuds — or "Later"

    private var topBar: some View {
        HStack {
            if let request {
                Spacer()
                Button("Later") { model.answerLater(request) }
                    .buttonStyle(.capsule(.quiet, size: .sm))
            } else if receipt == nil {
                Button(action: openComputers) {
                    HStack(spacing: Tokens.Space.s8) {
                        Image(systemName: "display")
                        Text(verbatim: store.computer.name)
                        Image(systemName: "chevron.down")
                            .font(.system(size: Tokens.Size.iconDense * 0.75, weight: .semibold))
                    }
                }
                .buttonStyle(.capsule(.quiet, size: .sm))
                .accessibilityLabel("Your computers")
                .accessibilityValue(Text(verbatim: store.computer.name))
                Spacer()
                EarbudsButton()
                    .disabled(store.presenceState == .offline)
            }
        }
        .frame(minHeight: Tokens.Size.controlBig)
        // The bar stays a bar: its labels stop growing before they collide.
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }

    // MARK: What the presence shows and says

    /// Hearing and talking come first, on the computer the voice is for.
    private var presenceState: Presence.State {
        switch model.voice.activity {
        case .listening: .listening
        case .speaking: .speaking
        case .idle: store.presenceState
        }
    }

    /// The one sentence under the presence: something that just went wrong,
    /// what is being heard or said, otherwise what the agent is up to.
    /// `isGrowing` marks words still arriving, whose end matters most.
    private var line: (text: String, isGrowing: Bool) {
        let voice = model.voice
        if let notice = model.notice { return (String(localized: notice), false) }
        switch voice.activity {
        case .listening where voice.heard.isEmpty: return (String(localized: "I'm listening."), false)
        case .listening: return (voice.heard, true)
        case .speaking: return (voice.saying, false)
        case .idle: return (store.line, store.state.typing[mainThread] != nil && store.state.pending.isEmpty)
        }
    }
}

/// The presence with its label — the product's signature component: the
/// agent's name above, the stage the figure moves in with its light falling
/// around it, its line below.
struct PresenceWithLabel: View {
    var name: String?
    var state: Presence.State
    var line: String?
    /// Words still arriving: they just grow, and the end is what stays in view.
    var lineIsGrowing = false
    var stage: CGFloat
    var level: @MainActor () -> Double = { 0 }
    /// The last answer or reconnection attempt: the presence nods, lowers its hand, or lifts.
    var pulse: PresencePulse?

    var body: some View {
        VStack(spacing: 0) {
            if let name {
                Text(verbatim: name)
                    .type(.label)
                    .foregroundStyle(Theme.textDim)
            }
            PresenceView(state: state, size: stage, level: level, pulse: pulse)
                // Where its light falls: the screen draws it, beyond any scroll view's edge.
                .anchorPreference(key: StageSpot.self, value: .center) { StageSpot.Spot(center: $0, stage: stage) }
                // The body at rest fills half the stage: the name and the
                // line may sit within its outer edge.
                .padding(.vertical, -stage * 0.06)
            if let line {
                AgentLine(text: line, isGrowing: lineIsGrowing, type: .displayS, lineLimit: 4)
                    .minimumScaleFactor(0.8)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Where the presence stands, and how large its stage is.
private struct StageSpot: PreferenceKey {
    struct Spot {
        let center: Anchor<CGPoint>
        let stage: CGFloat
    }

    static var defaultValue: Spot? { nil }

    static func reduce(value: inout Spot?, nextValue: () -> Spot?) {
        value = value ?? nextValue()
    }
}

/// Talking: a tap starts listening and the next tap sends. Holding works
/// too — let go and it sends — but it is never the only way.
private struct TalkButton: View {
    @Environment(AppModel.self) private var model
    @Environment(\.isEnabled) private var isEnabled
    /// When the finger came down, while it is down.
    @State private var pressedAt: Date?
    /// This press started the listening (rather than ending it).
    @State private var pressStarted = false

    /// A press longer than this is a hold: letting go sends.
    private static let hold = 0.5

    var body: some View {
        let isListening = model.voice.activity == .listening
        let look: ButtonLook = isListening && isEnabled ? .primary : .secondary
        HStack(spacing: Tokens.Space.s8) {
            Image(systemName: isListening ? "arrow.up" : "mic")
                .contentTransition(.symbolEffect(.replace))
            Text(isListening ? "Tap to send" : "Tap to talk")
                .contentTransition(.opacity)
        }
        .type(.buttonBig)
        .foregroundStyle(!isEnabled ? Theme.textFaint : look == .primary ? Tokens.Colors.onPrimary : Theme.text)
        .frame(maxWidth: .infinity, minHeight: Tokens.Size.controlBig)
        .background { ButtonFace(look: look, shape: ButtonShape(), isPressed: pressedAt != nil) }
        .contentShape(Capsule())
        .scaleEffect(pressedAt != nil ? Tokens.Control.press : 1)
        .animation(pressedAt != nil ? .fade(Tokens.Motion.instant) : Tokens.Motion.press.animation, value: pressedAt != nil)
        .animation(Tokens.Motion.snappy.animation, value: isListening)
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    guard pressedAt == nil else { return }
                    pressedAt = .now
                    pressStarted = !isListening
                    if pressStarted { Task { await model.startTalking() } }
                }
                .onEnded { _ in
                    let held = pressedAt.map { Date.now.timeIntervalSince($0) } ?? 0
                    pressedAt = nil
                    // A tap that started listening keeps listening; any other press ends it and sends.
                    if !pressStarted || held >= Self.hold { Task { await model.stopTalking() } }
                },
            isEnabled: isEnabled)
        .sensoryFeedback(.impact(weight: .light), trigger: isListening)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(isListening ? Text("Tap to send") : Text("Tap to talk"))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction {
            Task { isListening ? await model.stopTalking() : await model.startTalking() }
        }
    }
}

/// The agent in your earbuds, one tap: talk and listen while the phone
/// stays in a pocket.
private struct EarbudsButton: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let state = model.live.state
        Button {
            Task { await model.toggleLive() }
        } label: {
            Label(state == .paused ? "Paused" : "Earbuds", systemImage: "headphones")
        }
        .buttonStyle(.capsule(state == .on ? .primary : .secondary, size: .sm))
        .sensoryFeedback(.selection, trigger: state)
        .accessibilityLabel("Talk through your earbuds")
        .accessibilityValue(state == .on ? "On" : state == .paused ? "Paused" : "Off")
        .animation(.fade(Tokens.Motion.base), value: state)
    }
}

/// A background job, as a chip: what it is, and how it stands.
private struct JobChip: View {
    let job: ThreadInfo
    var open: () -> Void

    var body: some View {
        Button(action: open) {
            // Its name is never cut: when what it is doing does not fit, a word says how it stands.
            ViewThatFits(in: .horizontal) {
                content(status)
                content(word)
            }
            .lineLimit(1)
            .padding(.leading, Tokens.Space.s12)
            .padding(.trailing, Tokens.Space.s16)
            .frame(minHeight: Tokens.Size.controlSm)
            .background(fill, in: Capsule())
            .overlay {
                if job.state != .working, job.state != .waiting {
                    Capsule().strokeBorder(Theme.ring, lineWidth: 1)
                }
            }
            // A 44 pt target around a 36 pt chip.
            .padding(.vertical, Tokens.Space.s4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var mark: some View {
        switch job.state {
        case .working: Circle().fill(Theme.working).frame(width: Tokens.Space.s8, height: Tokens.Space.s8)
        case .waiting: PresenceGlyph(state: .waiting, size: Tokens.Size.iconDense)
        case .error: Image(systemName: "exclamationmark.triangle").foregroundStyle(Theme.careful).font(.system(size: 13, weight: .semibold))
        case .idle: Image(systemName: "checkmark").foregroundStyle(Theme.go).font(.system(size: 13, weight: .semibold))
        }
    }

    private func content(_ status: Text) -> some View {
        HStack(spacing: Tokens.Space.s8) {
            mark
            Text(verbatim: job.title)
                .type(.label)
                .foregroundStyle(Theme.text)
            status
                .type(.small)
                .foregroundStyle(job.state == .waiting ? Theme.waiting : Theme.textDim)
        }
    }

    /// How it stands, in one word.
    private var word: Text {
        job.state == .working ? Text("Working") : status
    }

    private var status: Text {
        switch job.state {
        case .working: job.preview.map { Text(verbatim: $0) } ?? Text("Working")
        case .waiting: Text("Asking")
        case .error: Text("Stopped")
        case .idle: Text("job.done")
        }
    }

    private var fill: DesignColor {
        switch job.state {
        case .working: Theme.workingFill
        case .waiting: Theme.waitingFill
        case .error, .idle: Theme.fill
        }
    }
}

/// The composer: a capsule to write in, with a round button that sends —
/// or, while the agent works and nothing is written, stops it.
struct Composer: View {
    let prompt: LocalizedStringKey
    var isFocused: FocusState<Bool>.Binding
    /// Whose work `stop` stops.
    var agentName = ""
    /// What stops the agent, while there is something to stop.
    var stop: (() -> Void)?
    var send: (String) -> Void

    @State private var draft = ""

    var body: some View {
        let isEmpty = draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let stops = stop != nil && isEmpty
        HStack(alignment: .bottom, spacing: Tokens.Space.s4) {
            TextField(prompt, text: $draft, axis: .vertical)
                .type(.body)
                .lineLimit(1...5)
                .focused(isFocused)
                .padding(.leading, Tokens.Space.s20)
                .padding(.vertical, Tokens.Space.s16)
            // Both buttons stay in place; one turns into the other.
            ZStack {
                RoundButton(icon: "arrow.up", label: "Send", look: isEmpty ? .secondary : .primary) {
                    send(draft)
                    draft = ""
                }
                .disabled(isEmpty)
                .swapped(out: stops)
                if let stop {
                    RoundButton(icon: "stop.fill", label: "Stop \(agentName)", look: .secondary, action: stop)
                        .swapped(out: !stops)
                }
            }
            .padding(6)
        }
        .raised(in: RoundedRectangle(cornerRadius: Tokens.Size.controlBig / 2, style: .continuous))
        .animation(Tokens.Motion.snappy.animation, value: stops)
        .animation(.fade(Tokens.Motion.fast), value: isEmpty)
    }
}

private extension View {
    /// One half of an icon swap: the icon leaving shrinks into a blur.
    func swapped(out: Bool) -> some View {
        scaleEffect(out ? Tokens.Motion.iconSwapScale : 1)
            .blur(radius: out ? Tokens.Motion.arriveBlur : 0)
            .opacity(out ? 0 : 1)
            .allowsHitTesting(!out)
            .accessibilityHidden(out)
    }
}

extension RequestItem {
    /// The mark of its receipt.
    var receiptKind: ReceiptMark.Kind {
        guard state == .resolved, let resolution else { return .cancelled }
        if resolution.optionId == nil { return .words }
        if resolution.optionId == Option.approve { return .go }
        if kind == .question, options.first(where: { $0.id == resolution.optionId })?.style == .primary { return .go }
        return .stop
    }

    /// What the owner said: "You said “Go ahead”", "You answered “…”" — or "No longer needed".
    var said: Text {
        guard state == .resolved, let resolution else { return Text("No longer needed") }
        let option: String? = switch resolution.optionId {
        case Option.approve? where kind == .approval: String(localized: "Go ahead")
        case Option.deny? where kind == .approval: String(localized: "Stop")
        case let id?: options.first { $0.id == id }?.label
        case nil: nil
        }
        if let option { return Text("You said “\(option)”") }
        return Text("You answered “\(resolution.text ?? "")”")
    }
}
