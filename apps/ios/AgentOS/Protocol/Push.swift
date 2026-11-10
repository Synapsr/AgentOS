import Foundation

// The AgentOS wire protocol — push notifications.
//
// A Swift mirror of `packages/protocol/src/push.ts`. The same payload is put
// on the notifications the app posts itself, so one piece of code answers
// both.

/// The custom part of a notification: the value of `agentos` in its payload.
struct PushPayload: Codable, Equatable, Sendable {
    enum Kind: String, Codable, Sendable {
        /// The agent needs its owner.
        case request
        /// The agent finished and has something to say.
        case turn
        /// A request was answered or cancelled elsewhere: remove its notification.
        case resolved
    }

    /// Key of the custom part in the notification payload.
    static let key = "agentos"
    /// Version of the custom part. A notification of another version is ignored.
    static let version = 1

    var version = PushPayload.version
    /// The computer that sent it: which of the app's pairings this is about.
    let nodeId: String
    let kind: Kind
    let threadId: String
    /// The request, for `request` and `resolved`; nil for `turn`. It is
    /// also the notification's identifier.
    let requestId: String?
    /// `FileRef.id` of what the agent sees, when the request has it.
    let screenshotId: String?
    /// The request's risk, so that the lock screen can say "Worth a careful
    /// look" before the app is opened; nil for `turn` (and from a computer
    /// older than the field).
    let risk: RequestItem.Risk?

    /// Reads the payload of a notification, if it carries one this app understands.
    init?(userInfo: [AnyHashable: Any]) {
        guard let custom = userInfo[Self.key], JSONSerialization.isValidJSONObject(custom),
              let data = try? JSONSerialization.data(withJSONObject: custom),
              let payload = try? Wire.decode(PushPayload.self, from: data), payload.version == Self.version else {
            return nil
        }
        self = payload
    }

    init(nodeId: String, kind: Kind, threadId: String, requestId: String? = nil, screenshotId: String? = nil, risk: RequestItem.Risk? = nil) {
        self.nodeId = nodeId
        self.kind = kind
        self.threadId = threadId
        self.requestId = requestId
        self.screenshotId = screenshotId
        self.risk = risk
    }

    /// The payload as it sits in a notification's `userInfo`.
    var userInfo: [AnyHashable: Any] {
        let custom = (try? Wire.encode(self)).flatMap { try? JSONSerialization.jsonObject(with: $0) }
        return [Self.key: custom ?? [:]]
    }
}

/// Notification categories (`aps.category`), each with its own buttons.
enum PushCategory {
    /// "Go ahead" and "Stop".
    static let approval = "AGENTOS_APPROVAL"
    /// A text reply.
    static let question = "AGENTOS_QUESTION"
    /// Nothing to answer; a reply is a new message.
    static let turn = "AGENTOS_TURN"
}
