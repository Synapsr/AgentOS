import SwiftUI

/// The agent's line: one sentence, first person. A new one replaces the old
/// one in two beats — the old one fades out, then the new one fades in — so
/// that two sentences are never on screen at once.
struct AgentLine: View {
    private let asked: Shown
    /// What is on screen, which lags behind what was asked for by one fade.
    @State private var shown: Shown
    @State private var isOut = false

    private struct Shown: Equatable {
        var text: String
        var isGrowing: Bool
        var type: TypeSpec
        var lineLimit: Int?
    }

    /// - Parameter isGrowing: words still arriving, heard or being written: they just grow, and their end is what stays in view.
    init(text: String, isGrowing: Bool = false, type: TypeSpec = .displayS, lineLimit: Int? = nil) {
        asked = Shown(text: text, isGrowing: isGrowing, type: type, lineLimit: lineLimit)
        _shown = State(initialValue: asked)
    }

    var body: some View {
        Text(shown.text)
            .type(shown.type)
            .multilineTextAlignment(.center)
            .lineLimit(shown.lineLimit)
            .truncationMode(shown.isGrowing ? .head : .tail)
            .frame(maxWidth: .infinity)
            .opacity(isOut ? 0 : 1)
            .task(id: asked) {
                // Words that grow just grow; a new sentence, or the same one set as a question, takes two beats.
                let isGrowth = asked.isGrowing && shown.isGrowing || asked.text == shown.text
                if !isGrowth || asked.type != shown.type {
                    withAnimation(.fade(Tokens.Motion.lineOut, leaving: true)) { isOut = true }
                    try? await Task.sleep(for: .seconds(Tokens.Motion.lineOut))
                    // A newer line is already on its way: it will take the place.
                    if Task.isCancelled { return }
                }
                // Always ends in view — also when the words came back to what was
                // shown before the old line had finished leaving.
                shown = asked
                if isOut { withAnimation(.fade(Tokens.Motion.lineIn)) { isOut = false } }
            }
    }
}

extension TypeSpec: Equatable {
    static func == (a: TypeSpec, b: TypeSpec) -> Bool {
        a.size == b.size && a.line == b.line && a.weight == b.weight && a.tracking == b.tracking && a.style == b.style && a.design == b.design
    }
}
