#if DEBUG
import SwiftUI

/// Every state of the presence side by side, for checking it against the
/// web's `?demo=presence`: launch a debug build with `-demo gallery`. The
/// voice states hear a made-up voice. The appearance follows the system's.
struct PresenceGallery: View {
    var stage: CGFloat = 150
    var columns = 2

    var body: some View {
        let grid = Array(repeating: GridItem(.flexible()), count: columns)
        ScrollView {
            LazyVGrid(columns: grid, spacing: 8) {
                ForEach(Presence.State.allCases, id: \.self) { state in
                    VStack(spacing: 2) {
                        PresenceView(state: state, size: stage, level: { Self.voice(Date.now.timeIntervalSinceReferenceDate) }, rate: columns > 2 ? 60 : 30)
                        Text(verbatim: "\(state)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .padding(8)
        }
        .background(Theme.surfaceStage)
    }

    /// A voice-like level: syllables in bursts, with pauses (as the web playground's).
    private static func voice(_ t: Double) -> Double {
        let syllables = pow(abs(sin(t * 2.9) * sin(t * 7.3 + 1)), 0.7)
        let phrase = sin(t * 0.55) > -0.6 ? 0.55 + 0.45 * sin(t * 0.9) : 0
        return min(1, syllables * phrase * 1.3)
    }
}
#endif
