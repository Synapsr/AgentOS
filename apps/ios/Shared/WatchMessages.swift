import Foundation

// What the iPhone and the Apple Watch say to each other.
//
// The watch does not talk to computers itself: watchOS gives an ordinary
// app no WebSocket, and a computer usually lives on a home network or a
// Tailscale address a watch cannot reach on its own. So the iPhone app,
// which already follows every computer, tells the watch what to show, and
// the watch tells the iPhone what its owner said or decided
// (WatchConnectivity carries both).

/// One computer as the watch shows it.
struct WatchComputer: Codable, Identifiable, Equatable, Sendable {
    /// A request waiting for the owner.
    struct Request: Codable, Identifiable, Equatable, Sendable {
        struct Option: Codable, Identifiable, Equatable, Sendable {
            let id: String
            let label: String
            /// `primary`, `danger` or `default`, as the agent styled it.
            let style: String
        }

        let id: String
        let question: String
        /// An approval is answered with *Go ahead* or *Stop*; a question with the agent's own options.
        let isApproval: Bool
        let options: [Option]
        /// Worth a careful look: said in words, and Go ahead asks once more.
        let isHighRisk: Bool
        /// The agent shows what it sees: the watch says it is on the iPhone.
        let hasPicture: Bool
    }

    /// The computer's node id.
    let id: String
    let agentName: String
    let state: Presence.State
    /// The agent's current line.
    let line: String
    let request: Request?
}

/// Everything the watch shows, as last told by the iPhone.
struct WatchSnapshot: Codable, Equatable, Sendable {
    var computers: [WatchComputer] = []
    /// When the iPhone made it. Snapshots travel by more than one road and
    /// may arrive out of order: the watch keeps the newest.
    var at = Date.distantPast
}

/// What the watch asks of the iPhone. Every command is answered with a fresh `WatchSnapshot`.
enum WatchCommand: Codable, Sendable {
    /// Look at the computers again.
    case refresh
    /// The owner said something to the agent of a computer.
    case say(computer: String, text: String)
    /// The owner answered a request with one of its options.
    case answer(computer: String, request: String, option: String)
}
