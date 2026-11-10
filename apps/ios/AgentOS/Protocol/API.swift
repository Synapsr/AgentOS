import Foundation

// The AgentOS wire protocol — HTTP bodies.
//
// A Swift mirror of the parts of `packages/protocol/src/api.ts` a phone
// uses. Routes marked *local* there are for the computer itself.

/// Body of every non-2xx answer, with the HTTP status it came with.
struct APIError: Error, Decodable, Equatable, Sendable {
    struct Detail: Decodable, Equatable, Sendable {
        /// `unauthorized`, `not_found`, `invalid`, `conflict`, `unavailable`…
        let code: String
        let message: String
    }

    let error: Detail
    var status = 0

    private enum CodingKeys: String, CodingKey { case error }
}

/// `GET /v1/hello` — is this an AgentOS computer, and which one?
struct HelloResponse: Decodable, Sendable {
    struct Node: Decodable, Sendable {
        let id: String
        let name: String
        let agentName: String
    }

    let app: String
    let version: String
    let `protocol`: Int
    let node: Node
    let onboarded: Bool
}

/// `POST /v1/pair` — exchange a pairing code for a device token.
struct PairRequest: Encodable, Sendable {
    struct Device: Encodable, Sendable {
        let name: String
        let platform: ClientPlatform
    }

    let code: String
    let device: Device
}

struct PairResponse: Decodable, Sendable {
    /// Keep it secret (Keychain). Shown only once.
    let token: String
    let device: Device
    let node: NodeInfo
}

/// `GET /v1/node`. Its `local` flag (is the caller the computer itself?) is
/// left unread: a phone never is.
struct NodeResponse: Decodable, Sendable {
    let node: NodeInfo
    let status: NodeStatus
}

/// `GET /v1/threads`
struct ThreadsResponse: Decodable, Sendable {
    let threads: [ThreadInfo]
}

/// `GET /v1/threads/:id/items` — timeline, newest last.
struct ItemsResponse: Decodable, Sendable {
    let thread: ThreadInfo
    let items: [Item]
    /// True when older items exist before the first one returned.
    let hasMore: Bool
}

/// `POST /v1/threads/:id/messages`
struct SendMessageRequest: Encodable, Sendable {
    let text: String
    let via: Via
    /// Set when these words are the owner's reply to that pending request.
    /// A message without it never answers anything.
    let requestId: String?
}

struct SendMessageResponse: Decodable, Sendable {
    let item: MessageItem
    /// The request named by `requestId`, as it stands after the message:
    /// still pending means the words were not taken as an answer.
    let request: RequestItem?
}

/// `GET /v1/requests` — the requests waiting for the owner.
struct RequestsResponse: Decodable, Sendable {
    let requests: [RequestItem]
}

/// `POST /v1/requests/:id/resolve` — an option, a free-form answer, or both.
struct ResolveRequest: Encodable, Sendable {
    let optionId: String?
    let text: String?
}

struct ResolveResponse: Decodable, Sendable {
    let request: RequestItem
}

/// `PUT /v1/devices/me/push`
struct PushRegistration: Encodable, Sendable {
    enum Kind: String, Encodable, Sendable { case apns, fcm, none }

    let kind: Kind
    let token: String?
    /// APNs environment the token belongs to.
    let sandbox: Bool

    private enum CodingKeys: String, CodingKey { case kind, token, sandbox }

    // `token` is nullable but required: it must be sent as `null`, not left out.
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(kind, forKey: .kind)
        try c.encode(token, forKey: .token)
        try c.encode(sandbox, forKey: .sandbox)
    }
}

/// `POST /v1/voice/transcribe`
struct TranscribeResponse: Decodable, Sendable {
    let text: String
}

/// `POST /v1/voice/speak`
struct SpeakRequest: Encodable, Sendable {
    let text: String
}
