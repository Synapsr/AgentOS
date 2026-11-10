import LocalAuthentication
import SwiftUI

/// The decision: *Go ahead* and *Stop* for an approval, the agent's own
/// options for a question. The buttons never swap and never move: on the
/// phone's screen they are stacked, Go ahead on top and Stop under it; in a
/// card they sit side by side, Stop leading, as long as they fit.
///
/// An answer counts once the computer has it: until then the chosen button
/// waits and the others step back; then its icon turns into a check and the
/// haptic says how it went. Saying yes to something risky asks for Face ID
/// (or the passcode) first; stopping never asks for anything more.
struct Decision: View {
    let request: RequestItem
    /// One above the other, full width — or, in a card, side by side when they fit.
    var stacked = true
    /// Sends the answer; true once the computer has it.
    var answer: (_ optionId: String) async -> Bool

    @State private var chosen: String?
    @State private var done: String?
    @State private var isSlow = false
    @State private var failed = false
    /// Buttons that decide never take a tap meant for what was there before.
    @State private var isReady = false

    private struct Choice: Identifiable {
        let id: String
        let label: Text
        let look: ButtonLook
        var icon: String?
        var says: Text?
    }

    /// In the order they are stacked: the primary answer on top, always.
    /// A row puts them the other way round, so that it is always last there.
    private var choices: [Choice] {
        if request.kind == .approval {
            return [
                Choice(id: RequestItem.Option.approve, label: Text("Go ahead"), look: .primary, icon: "checkmark", says: Text("Go ahead: \(request.title)")),
                Choice(id: RequestItem.Option.deny, label: Text("Stop"), look: .secondary, icon: "hand.raised", says: Text("Stop: \(request.title)")),
            ]
        }
        let options = request.options.filter { $0.style == .primary } + request.options.filter { $0.style != .primary }
        return options.map { option in
            let look: ButtonLook = switch option.style {
            case .primary: .primary
            case .danger: .careful
            case .default: .secondary
            }
            return Choice(id: option.id, label: Text(verbatim: option.label), look: look)
        }
    }

    /// Saying yes to this asks for the owner's face, finger or passcode.
    private var asksForTrust: Bool { request.kind == .approval && request.risk == .high }

    var body: some View {
        VStack(spacing: Tokens.Space.s12) {
            // On the phone the line goes above the buttons, so that they never move.
            if stacked { status }
            let choices = choices
            AnswerLayout(gap: Tokens.Space.s12, stacks: stacked, leadsWithLast: choices.first?.look == .primary) {
                ForEach(choices) { button($0) }
            }
            if !stacked { status }
        }
        .animation(.fade(Tokens.Motion.base), value: isSlow)
        .animation(.fade(Tokens.Motion.base), value: failed)
        .task(id: request.id) {
            isReady = false
            try? await Task.sleep(for: .seconds(Tokens.Control.touchGuard))
            isReady = true
        }
    }

    private func button(_ choice: Choice) -> some View {
        let isChosen = chosen == choice.id
        return Button {
            choose(choice)
        } label: {
            HStack(spacing: Tokens.Space.s8) {
                if let icon = choice.icon {
                    Image(systemName: done == choice.id ? "checkmark" : icon)
                        .contentTransition(.symbolEffect(.replace))
                        // The computer has it: the check answers once.
                        .symbolEffect(.bounce, value: done == choice.id)
                        .foregroundStyle(choice.look == .primary ? AnyShapeStyle(Theme.primaryCheck) : AnyShapeStyle(.foreground))
                        .accessibilityHidden(true)
                }
                choice.label
                    .opacity(isChosen && done == nil ? 0.8 : 1)
                if asksForTrust(choice), !stacked { trustGlyph }
            }
            .frame(maxWidth: .infinity)
            .overlay(alignment: .trailing) {
                // Says, before the tap, that this one asks for Face ID: at the
                // far end of a wide button, beside the word in a narrow one.
                if asksForTrust(choice), stacked { trustGlyph }
            }
        }
        .buttonStyle(.capsule(choice.look, size: stacked ? .big : .lg, wide: true, inCard: !stacked))
        .opacity(chosen == nil || isChosen ? 1 : Tokens.Control.disabled)
        .allowsHitTesting(isReady && chosen == nil)
        .accessibilityLabel(choice.says ?? choice.label)
    }

    private func asksForTrust(_ choice: Choice) -> Bool {
        choice.id == RequestItem.Option.approve && asksForTrust
    }

    private var trustGlyph: some View {
        Image(systemName: Trust.glyph)
            .opacity(0.55)
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private var status: some View {
        if failed {
            Text("Couldn't reach your computer. Try again.")
                .type(.small)
                .foregroundStyle(Theme.careful)
                .multilineTextAlignment(.center)
                .transition(.opacity)
        } else if isSlow {
            Text("Sending to your computer…")
                .type(.small)
                .foregroundStyle(Theme.textDim)
                .transition(.opacity)
        }
    }

    private func choose(_ choice: Choice) {
        guard chosen == nil else { return }
        chosen = choice.id
        failed = false
        Task {
            if choice.id == RequestItem.Option.approve, asksForTrust {
                let trusted = await Trust.confirm(String(localized: "Go ahead: \(request.title)"))
                guard trusted else {
                    chosen = nil
                    return
                }
            }
            // Nothing is said about a computer that answers at once.
            let slow = Task {
                try await Task.sleep(for: .seconds(1.5))
                isSlow = true
            }
            let isDone = await answer(choice.id)
            slow.cancel()
            isSlow = false
            if isDone {
                withAnimation(Tokens.Motion.snappy.animation) { done = choice.id }
                Haptics.play(choice.id == RequestItem.Option.deny ? Tokens.Haptic.stopped : Tokens.Haptic.approved)
            } else {
                chosen = nil
                failed = true
                Haptics.play(Tokens.Haptic.failed)
            }
        }
    }
}

/// The device's own trust gesture: Face ID, Touch ID, or the passcode.
enum Trust {
    /// Asks for it. True when the owner gave it — or when this phone has no
    /// passcode at all, so there is nothing to ask for.
    @MainActor
    static func confirm(_ reason: String) async -> Bool {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            return (error as? LAError)?.code == .passcodeNotSet
        }
        return (try? await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)) ?? false
    }

    /// The symbol of the gesture this phone will ask for.
    static var glyph: String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        return switch context.biometryType {
        case .faceID: "faceid"
        case .touchID: "touchid"
        case .opticID: "opticid"
        default: "lock"
        }
    }
}

/// What goes with the question: the detail of a question, "Worth a careful
/// look" at high risk, what the agent sees, and — for an approval — the raw
/// input, behind "Details". Plain sentence on top, the machine underneath.
struct RequestDetails: View {
    let request: RequestItem
    let store: ComputerStore
    /// The phone's screen: the detail centred, the picture larger.
    var onScreen = false
    /// The order of the first chunk, for the arrival.
    var arriving = 0
    /// Called with the picture when the owner wants to look closer.
    var zoom: (UIImage) -> Void

    @State private var screenshot: UIImage?

    var body: some View {
        VStack(alignment: onScreen ? .center : .leading, spacing: Tokens.Space.s12) {
            if request.kind == .question, let detail = request.body {
                Text(detail)
                    .type(.small)
                    .foregroundStyle(Theme.textDim)
                    .multilineTextAlignment(onScreen ? .center : .leading)
                    // In a card, words sit 20 from the edge, the rest 12.
                    .padding(.horizontal, onScreen ? 0 : Tokens.Space.s8)
                    .arrive(arriving)
            }
            // Only high risk is called out: a warning on every request is a warning on none.
            if request.risk == .high {
                CarefulBanner()
                    .arrive(arriving + 1)
            }
            if let screenshot {
                Picture(image: screenshot, radius: onScreen ? Tokens.Radius.l : Tokens.Radius.m, agentName: store.computer.agentName) {
                    zoom(screenshot)
                }
                .arrive(arriving + 2)
            }
            if request.kind == .approval, let input = request.body {
                DetailsDisclosure(text: input)
                    .arrive(arriving + 3)
            }
        }
        .task(id: request.screenshot?.id) {
            guard let file = request.screenshot, let data = await store.data(for: file) else { return }
            screenshot = UIImage(data: data)
        }
    }
}

/// What the agent sees, at its own aspect ratio, with "Look closer" on it.
private struct Picture: View {
    let image: UIImage
    let radius: CGFloat
    let agentName: String
    var open: () -> Void

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        Button(action: open) {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .clipShape(shape)
                .overlay(shape.strokeBorder(Theme.outline, lineWidth: 1))
                .overlay(alignment: .bottomLeading) {
                    Label("Look closer", systemImage: "plus.magnifyingglass")
                        .type(.label)
                        .foregroundStyle(Theme.text)
                        .padding(.horizontal, Tokens.Space.s12)
                        .frame(height: Tokens.Size.controlSm)
                        .glassEffect(.regular, in: Capsule())
                        .padding(Tokens.Space.s12)
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("What \(agentName) sees. Tap to look closer.")
    }
}

/// "Details": the raw command, path or input, for those who want it. Closed
/// until asked for.
struct DetailsDisclosure: View {
    let text: String
    /// Where "Details" sits: leading in a request, centred under a centred title.
    var alignment = HorizontalAlignment.leading

    @State private var isOpen = false
    @State private var copied = false

    var body: some View {
        VStack(alignment: alignment, spacing: Tokens.Space.s8) {
            Button {
                withAnimation(Tokens.Motion.layout.animation) { isOpen.toggle() }
            } label: {
                HStack(spacing: Tokens.Space.s8) {
                    Text("Details")
                    Image(systemName: "chevron.down")
                        .font(.system(size: Tokens.Size.iconDense * 0.8, weight: .semibold))
                        .rotationEffect(.degrees(isOpen ? 180 : 0))
                        .accessibilityHidden(true)
                }
                .type(.small)
                .foregroundStyle(Theme.textDim)
                .padding(.horizontal, Tokens.Space.s8)
                .frame(minHeight: Tokens.Size.control)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(isOpen ? Text("On") : Text("Off"))
            if isOpen {
                VStack(alignment: .leading, spacing: Tokens.Space.s12) {
                    Text(verbatim: text)
                        .type(.code)
                        .foregroundStyle(Theme.text)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button {
                        UIPasteboard.general.string = text
                        copied = true
                    } label: {
                        Label("Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                            .contentTransition(.symbolEffect(.replace))
                    }
                    .buttonStyle(.capsule(.secondary, size: .sm))
                }
                .padding(Tokens.Space.s12)
                .background(Theme.fill, in: RoundedRectangle(cornerRadius: Tokens.Radius.m, style: .continuous))
                .transition(.arriveLeave)
            }
        }
        .frame(maxWidth: .infinity, alignment: Alignment(horizontal: alignment, vertical: .center))
        .task(id: copied) {
            guard copied else { return }
            try? await Task.sleep(for: .seconds(2))
            withAnimation(Tokens.Motion.snappy.animation) { copied = false }
        }
    }
}

/// The screenshot, full screen: pinch or double-tap to look closer.
struct ZoomedImage: View {
    let image: UIImage
    var close: () -> Void

    @State private var scale = 1.0
    @State private var offset = CGSize.zero
    @GestureState private var pinch = 1.0
    @GestureState private var drag = CGSize.zero

    var body: some View {
        Image(uiImage: image)
            .resizable()
            .scaledToFit()
            .scaleEffect(scale * pinch)
            .offset(x: offset.width + drag.width, y: offset.height + drag.height)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.black)
            .ignoresSafeArea()
            .gesture(
                MagnifyGesture()
                    .updating($pinch) { value, pinch, _ in pinch = value.magnification }
                    .onEnded { value in settle(scale: scale * value.magnification) }
                    .simultaneously(with: DragGesture()
                        .updating($drag) { value, drag, _ in drag = scale > 1 ? value.translation : .zero }
                        .onEnded { value in
                            guard scale > 1 else { return }
                            offset.width += value.translation.width
                            offset.height += value.translation.height
                        }))
            .onTapGesture(count: 2) { settle(scale: scale > 1 ? 1 : 3) }
            .onTapGesture { if scale == 1 { close() } }
            .overlay(alignment: .topTrailing) {
                RoundButton(icon: "xmark", label: "Close", action: close)
                    .padding(Tokens.Space.s16)
            }
            .environment(\.colorScheme, .dark)
            .statusBarHidden()
            .accessibilityAddTraits(.isModal)
    }

    private func settle(scale target: Double) {
        withAnimation(Tokens.Motion.layout.animation) {
            scale = min(max(target, 1), 6)
            if scale == 1 { offset = .zero }
        }
    }
}
