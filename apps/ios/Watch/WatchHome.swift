import SwiftUI

/// What the watch shows: one page per computer — its presence, the question
/// it is asking, or, for a moment, the receipt of the answer just given.
struct WatchHome: View {
    @Environment(WatchModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if model.snapshot.computers.isEmpty {
                VStack(spacing: Tokens.Space.s8) {
                    PresenceView(state: .offline, size: 64, rate: 30)
                    Text(model.isReachable ? "Open AgentOS on your iPhone to add your computer." : "I can't reach your iPhone.")
                        .type(.small)
                        .foregroundStyle(Theme.textDim)
                        .multilineTextAlignment(.center)
                }
            } else {
                TabView {
                    ForEach(model.snapshot.computers) { computer in
                        Group {
                            if let receipt = model.receipts[computer.id] {
                                ReceiptPage(receipt: receipt)
                            } else if let request = computer.request {
                                RequestPage(computer: computer, request: request)
                                    .id(request.id)
                            } else {
                                PresencePage(computer: computer)
                            }
                        }
                        .transition(.arriveLeave)
                    }
                }
                .tabViewStyle(.verticalPage)
                .animation(Tokens.Motion.layout.animation, value: model.receipts)
            }
        }
        .presenceSurface()
        // While the owner is looking, ask again now and then: each question
        // also keeps the iPhone app awake and following the computers.
        .task(id: scenePhase) {
            while scenePhase == .active, !Task.isCancelled {
                await model.refresh()
                try? await Task.sleep(for: .seconds(10))
            }
        }
    }
}

/// The presence with its label, and a way to talk.
private struct PresencePage: View {
    let computer: WatchComputer

    @Environment(WatchModel.self) private var model
    @Environment(\.isLuminanceReduced) private var isDimmed

    var body: some View {
        // A short line fits with the rest; a long one is read with the crown.
        ScrollView {
            VStack(spacing: Tokens.Space.s4) {
                Text(verbatim: computer.agentName)
                    .type(.label)
                    .foregroundStyle(Theme.textDim)
                // 30 frames a second are plenty on a wrist; a dimmed display
                // holds a calm frame. The stage keeps its room: the drops never
                // reach the name.
                PresenceView(state: computer.state, size: Tokens.Stage.watch, rate: 30, isDimmed: isDimmed)
                AgentLine(text: computer.line, type: .body)
                TextFieldLink(prompt: Text("Talk to \(computer.agentName)…")) {
                    Label("Talk", systemImage: "mic")
                } onSubmit: { text in
                    Task { await model.say(text, to: computer) }
                }
                .buttonStyle(.capsule(wide: true))
                // Nothing invites talking to a computer that cannot hear: the line says why.
                .disabled(!model.isReachable || computer.state == .offline)
                .padding(.top, Tokens.Space.s8)
            }
            .padding(.horizontal, Tokens.Space.s4)
        }
        .accessibilityElement(children: .contain)
    }
}

/// "Nova is asking": who asks, how careful to be, the question, and the
/// answers stacked full width — Go ahead on top, Stop under it. At high
/// risk Go ahead asks once more, on a page that reads the question back;
/// Stop is always one tap.
private struct RequestPage: View {
    let computer: WatchComputer
    let request: WatchComputer.Request

    @Environment(WatchModel.self) private var model
    @State private var isSure = false
    @State private var chosen: String?
    @State private var failed = false
    /// Buttons that decide never take a tap meant for what was there before.
    @State private var isReady = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Space.s8) {
                if isSure {
                    Text("Just to be sure")
                        .type(.small)
                        .foregroundStyle(Theme.textDim)
                } else {
                    AskingLabel(agentName: computer.agentName, glyph: Tokens.Stage.watchAsking)
                    if request.isHighRisk {
                        CarefulBanner(asLine: true)
                    }
                }
                Text(request.question)
                    .type(.title)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, Tokens.Space.s4)
                answers
                if failed {
                    Text("Couldn't reach your computer. Try again.")
                        .type(.small)
                        .foregroundStyle(Theme.careful)
                }
                if request.hasPicture, !isSure {
                    Text("Picture on your iPhone")
                        .type(.small)
                        .foregroundStyle(Theme.textDim)
                        .frame(maxWidth: .infinity)
                        .padding(.top, Tokens.Space.s4)
                }
            }
            .padding(.horizontal, Tokens.Space.s4)
        }
        .disabled(!model.isReachable)
        .task {
            Haptics.play(Tokens.Haptic.requestArrives)
            try? await Task.sleep(for: .seconds(Tokens.Control.touchGuard))
            isReady = true
        }
        #if DEBUG
        .onAppear { if model.startsSure { isSure = true } }
        #endif
    }

    @ViewBuilder
    private var answers: some View {
        if request.isApproval {
            VStack(spacing: Tokens.Space.s8) {
                let goAhead = button(Text("Go ahead"), RequestItemOption.approve, .primary, icon: "checkmark", said: String(localized: "Go ahead"), isYes: true)
                // Double tap answers Go ahead — below high risk only.
                if request.isHighRisk {
                    goAhead
                } else {
                    goAhead.handGestureShortcut(.primaryAction)
                }
                button(Text("Stop"), RequestItemOption.deny, .secondary, icon: "hand.raised", said: String(localized: "Stop"), isYes: false)
            }
        } else {
            VStack(spacing: Tokens.Space.s8) {
                // The primary answer on top, always.
                ForEach(request.options.filter { $0.style == "primary" } + request.options.filter { $0.style != "primary" }) { option in
                    let look: ButtonLook = option.style == "primary" ? .primary : option.style == "danger" ? .careful : .secondary
                    button(Text(verbatim: option.label), option.id, look, said: option.label, isYes: option.style == "primary")
                }
            }
        }
    }

    private func button(_ title: Text, _ option: String, _ look: ButtonLook, icon: String? = nil, said: String, isYes: Bool) -> some View {
        Button {
            choose(option, said: said, isYes: isYes)
        } label: {
            HStack(spacing: Tokens.Space.s8) {
                if let icon {
                    Image(systemName: icon)
                        .foregroundStyle(look == .primary ? AnyShapeStyle(Theme.primaryCheck) : AnyShapeStyle(.foreground))
                }
                title
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.capsule(look, size: .lg, wide: true))
        .opacity(chosen == nil || chosen == option ? 1 : Tokens.Control.disabled)
        .allowsHitTesting(isReady && chosen == nil)
    }

    private func choose(_ option: String, said: String, isYes: Bool) {
        // At high risk, Go ahead first reads the question back.
        if option == RequestItemOption.approve, request.isHighRisk, !isSure {
            withAnimation(Tokens.Motion.layout.animation) { isSure = true }
            return
        }
        chosen = option
        failed = false
        Task {
            let isDone = await model.answer(request, with: option, said: said, isYes: isYes, on: computer)
            chosen = nil
            if isDone {
                Haptics.play(option == RequestItemOption.deny ? Tokens.Haptic.stopped : Tokens.Haptic.approved)
            } else {
                failed = true
                Haptics.play(Tokens.Haptic.failed)
            }
        }
    }
}

/// The receipt of an answer given here: the mark, what was said, and what about.
private struct ReceiptPage: View {
    let receipt: WatchModel.Receipt

    var body: some View {
        ScrollView {
            ReceiptMoment(kind: receipt.isYes ? .go : .stop, said: Text("You said “\(receipt.said)”"), question: receipt.question)
                .padding(.horizontal, Tokens.Space.s4)
        }
    }
}

/// The option ids of an approval, as the protocol names them (`approve`, `deny`).
private enum RequestItemOption {
    static let approve = "approve"
    static let deny = "deny"
}
