import SwiftUI

// Small pieces of docs/DESIGN.md shared by the iPhone and the watch.

/// "Nova is asking": the presence's waiting glyph — the body, a small drop
/// raised above it, still — and the words, in amber.
struct AskingLabel: View {
    let agentName: String
    var glyph: CGFloat = Tokens.Stage.label

    var body: some View {
        HStack(spacing: Tokens.Space.s8) {
            PresenceGlyph(state: .waiting, size: glyph)
            Text("\(agentName) is asking")
                .type(.label)
                .foregroundStyle(Theme.waiting)
        }
        .accessibilityElement(children: .combine)
    }
}

/// "Worth a careful look": high risk only, in words, with an icon, in the
/// careful colour. A banner where there is room; a line on the watch.
struct CarefulBanner: View {
    var asLine = false

    var body: some View {
        HStack(spacing: asLine ? Tokens.Space.s8 : Tokens.Space.s12) {
            Image(systemName: "exclamationmark.triangle")
            Text("Worth a careful look")
        }
        .type(.label)
        .foregroundStyle(Theme.careful)
        .padding(.vertical, asLine ? 0 : Tokens.Space.s12)
        .padding(.horizontal, asLine ? 0 : Tokens.Space.s16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(asLine ? Theme.carefulFill.clear : Theme.carefulFill, in: RoundedRectangle(cornerRadius: Tokens.Radius.m, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// The round mark at the head of a receipt: what was answered.
struct ReceiptMark: View {
    enum Kind {
        /// Go ahead, or the agent's own yes.
        case go
        /// Stop, or another of the agent's options.
        case stop
        /// An answer in the owner's own words.
        case words
        /// No longer needed.
        case cancelled
    }

    let kind: Kind
    var size: CGFloat = 28

    var body: some View {
        let symbol = switch kind {
        case .go: "checkmark"
        case .stop: "hand.raised"
        case .words: "text.bubble"
        case .cancelled: "xmark"
        }
        Image(systemName: symbol)
            .font(.system(size: size * 0.46, weight: .semibold))
            .foregroundStyle(kind == .go ? Theme.go : Theme.text)
            .frame(width: size, height: size)
            .background(kind == .go ? Theme.goFill : Theme.fillStrong, in: Circle())
            .accessibilityHidden(true)
    }
}

/// What a request leaves once answered, for good: the mark, "You said
/// “Go ahead”", the question under it, and when.
struct ReceiptRow: View {
    let kind: ReceiptMark.Kind
    let said: Text
    let question: String
    var time: Date?

    var body: some View {
        HStack(alignment: .top, spacing: Tokens.Space.s12) {
            ReceiptMark(kind: kind)
            VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                said
                    .type(.bodyStrong)
                Text(question)
                    .type(.small)
                    .foregroundStyle(Theme.textDim)
            }
            Spacer(minLength: 0)
            if let time {
                Text(time, format: .dateTime.hour().minute())
                    .type(.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textFaint)
                    .padding(.top, Tokens.Space.s2)
            }
        }
        .padding(.vertical, Tokens.Space.s12)
        .padding(.horizontal, Tokens.Space.s16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.fill, in: RoundedRectangle(cornerRadius: Tokens.Radius.l, style: .continuous))
        .opacity(kind == .cancelled ? 0.7 : 1)
        .accessibilityElement(children: .combine)
    }
}

/// The receipt as a moment, right after the owner answered: a large mark,
/// what they said, and what it was about.
struct ReceiptMoment: View {
    let kind: ReceiptMark.Kind
    let said: Text
    var question: String?

    var body: some View {
        VStack(spacing: Tokens.Space.s12) {
            ReceiptMark(kind: kind, size: 56)
            said
                .type(.title)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if let question {
                Text(question)
                    .type(.small)
                    .foregroundStyle(Theme.textDim)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

/// The presence's light falling on its stage: its state colour, very low,
/// very wide (`stageLight`, about 2.2 times the stage). On light surfaces
/// only the coloured states give light; the ink ones give none.
struct StageLight: View {
    var state: Presence.State
    var stage: CGFloat

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let looks = switch state {
        case .idle: Tokens.Presence.idle
        case .working: Tokens.Presence.working
        case .waiting: Tokens.Presence.waiting
        case .listening: Tokens.Presence.listening
        case .speaking: Tokens.Presence.speaking
        case .offline: Tokens.Presence.offline
        }
        let look = colorScheme == .dark ? looks.dark : looks.light
        let strength = colorScheme == .dark || look.glow > 0 ? Tokens.Presence.stageLight : 0
        RadialGradient(colors: [look.from.opacity(strength), look.from.opacity(0)], center: .center, startRadius: 0, endRadius: stage * 1.1)
            .frame(width: stage * 2.2, height: stage * 2.2)
            .animation(Tokens.Motion.material.animation, value: state)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}
