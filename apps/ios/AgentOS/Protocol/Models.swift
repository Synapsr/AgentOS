import Foundation

// The AgentOS wire protocol — data model.
//
// A Swift mirror of `packages/protocol/src/schemas.ts`, which is the source
// of truth. Timestamps are integer milliseconds on the wire (see `Wire`),
// optional values arrive as `null`.

/// Version of the protocol this client speaks.
let protocolVersion = 1

/// Id of the one conversation every computer always has.
let mainThread = "main"

/// Operating system of a computer running the AgentOS core.
enum Platform: String, Decodable, Sendable {
    case macos, windows, linux
}

/// Kind of client connecting to a computer.
enum ClientPlatform: String, Codable, Sendable {
    case ios, watchos, android, web, desktop, cli, node
}

/// How much the agent may do without asking.
enum Autonomy: String, Decodable, Sendable {
    case supervised, balanced, autonomous
}

/// Where speech is processed: on this phone, or on the computer.
enum VoiceSide: String, Decodable, Sendable {
    case device, server
}

/// How the computer wants speech to be recognised and synthesised.
struct VoiceCapabilities: Decodable, Hashable, Sendable {
    /// Provider id: `device`, `openai`, `elevenlabs`, …
    let provider: String
    let stt: VoiceSide
    let tts: VoiceSide
    /// Audio MIME type produced by `POST /v1/voice/speak`, when `tts` is `server`.
    let ttsMime: String?
}

/// A computer running the AgentOS core, and the agent that lives on it.
struct NodeInfo: Decodable, Hashable, Sendable {
    struct Agent: Decodable, Hashable, Sendable { let name: String }
    struct Owner: Decodable, Hashable, Sendable { let name: String }
    struct Capabilities: Decodable, Hashable, Sendable {
        let computer: Bool
        let engine: String
        let engineReady: Bool
        let voice: VoiceCapabilities
    }

    let id: String
    let name: String
    let platform: Platform
    let version: String
    let `protocol`: Int
    let agent: Agent
    let owner: Owner
    /// BCP‑47 language the agent speaks with its owner, e.g. "fr".
    let language: String
    let autonomy: Autonomy
    let onboarded: Bool
    let capabilities: Capabilities
}

/// What the computer is doing right now.
struct NodeStatus: Decodable, Hashable, Sendable {
    enum State: String, Decodable, Sendable { case idle, working, waiting }
    enum Mode: String, Decodable, Sendable { case desktop, os }

    let state: State
    /// Short present-tense phrase for humans, e.g. "Running the tests".
    let activity: String?
    let mode: Mode
    let pendingRequests: Int
    let workingThreads: Int
}

/// A paired client.
struct Device: Decodable, Hashable, Sendable {
    let id: String
    let name: String
    let platform: ClientPlatform
    let createdAt: Date
    let lastSeenAt: Date?
}

/// A conversation with the agent: the `main` one, or a background job.
struct ThreadInfo: Decodable, Hashable, Identifiable, Sendable {
    enum Kind: String, Decodable, Sendable { case main, job }
    enum State: String, Decodable, Sendable { case idle, working, waiting, error }

    let id: String
    let kind: Kind
    let title: String
    let parentId: String?
    let cwd: String?
    let state: State
    /// Last meaningful line, for lists.
    let preview: String?
    let createdAt: Date
    let updatedAt: Date
}

/// A stored binary (screenshot, image…), fetched at `GET /v1/files/:id`.
struct FileRef: Decodable, Hashable, Sendable {
    let id: String
    let mime: String
    let width: Int?
    let height: Int?
}

/// How a message was entered.
enum Via: String, Codable, Sendable {
    case text, voice
}

/// Something the owner or the agent said.
struct MessageItem: Decodable, Hashable, Sendable {
    enum Role: String, Decodable, Sendable { case user, agent }

    let id: String
    let threadId: String
    let at: Date
    let role: Role
    let text: String
    let via: Via
    let deviceId: String?
    let files: [FileRef]
}

/// Something the agent is doing or did: one line, human readable.
struct ActivityItem: Decodable, Hashable, Sendable {
    enum State: String, Decodable, Sendable { case running, done, failed }

    let id: String
    let threadId: String
    let at: Date
    let label: String
    let tool: String?
    let detail: String?
    let state: State
    let endedAt: Date?
}

/// The agent needs its owner: an `approval` the safety policy asked for, or
/// a `question` the agent chose to ask.
struct RequestItem: Decodable, Hashable, Identifiable, Sendable {
    enum Kind: String, Decodable, Sendable { case approval, question }
    enum Risk: String, Codable, Sendable { case low, medium, high }
    enum State: String, Decodable, Sendable { case pending, resolved, cancelled }

    struct Option: Decodable, Hashable, Identifiable, Sendable {
        enum Style: String, Decodable, Sendable { case primary, danger, `default` }

        /// Well-known option ids of `approval` requests.
        static let approve = "approve"
        static let deny = "deny"

        let id: String
        let label: String
        let style: Style
    }

    struct Resolution: Decodable, Hashable, Sendable {
        let optionId: String?
        let text: String?
        let deviceId: String?
        let at: Date
    }

    let id: String
    let threadId: String
    let at: Date
    let kind: Kind
    /// One short line: what is being asked.
    let title: String
    /// Optional context (the command, what will happen).
    let body: String?
    /// One sentence written to be spoken aloud.
    let spoken: String
    let risk: Risk
    /// What the agent sees, to decide with your own eyes.
    let screenshot: FileRef?
    let options: [Option]
    /// Whether a free-form answer is accepted instead of an option.
    let allowText: Bool
    let state: State
    let resolution: Resolution?
}

/// Anything that appears in a conversation's timeline.
enum Item: Decodable, Hashable, Identifiable, Sendable {
    case message(MessageItem)
    case activity(ActivityItem)
    case request(RequestItem)

    var id: String {
        switch self {
        case .message(let item): item.id
        case .activity(let item): item.id
        case .request(let item): item.id
        }
    }

    var threadId: String {
        switch self {
        case .message(let item): item.threadId
        case .activity(let item): item.threadId
        case .request(let item): item.threadId
        }
    }

    var at: Date {
        switch self {
        case .message(let item): item.at
        case .activity(let item): item.at
        case .request(let item): item.at
        }
    }

    init(from decoder: Decoder) throws {
        let type = try decoder.container(keyedBy: TypeKey.self).decode(String.self, forKey: .type)
        switch type {
        case "message": self = .message(try MessageItem(from: decoder))
        case "activity": self = .activity(try ActivityItem(from: decoder))
        case "request": self = .request(try RequestItem(from: decoder))
        default: throw DecodingError.unknownType(type, in: decoder)
        }
    }
}

/// One change on a computer. `seq` is its position in the computer's event
/// log; `0` marks an ephemeral event that is never replayed.
struct Event: Decodable, Sendable {
    enum Kind: Sendable {
        case nodeStatus(NodeStatus)
        case nodeUpdated(NodeInfo)
        case threadUpdated(ThreadInfo)
        case threadDeleted(threadId: String)
        case itemAdded(Item)
        case itemUpdated(Item)
        /// The agent is typing: `text` is appended to the message `messageId`.
        case messageDelta(threadId: String, messageId: String, text: String)
        /// The agent finished its turn; `text` is what to tell the owner.
        case turnCompleted(threadId: String, ok: Bool, text: String)
        /// An event type added after this client was built. Ignored.
        case unknown(String)
    }

    let seq: Int
    let at: Date
    let kind: Kind

    private enum CodingKeys: String, CodingKey {
        case seq, at, type, status, node, thread, threadId, item, messageId, text, ok
    }

    init(seq: Int, at: Date, kind: Kind) {
        self.seq = seq
        self.at = at
        self.kind = kind
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        seq = try c.decode(Int.self, forKey: .seq)
        at = try c.decode(Date.self, forKey: .at)
        let type = try c.decode(String.self, forKey: .type)
        switch type {
        case "node.status":
            kind = .nodeStatus(try c.decode(NodeStatus.self, forKey: .status))
        case "node.updated":
            kind = .nodeUpdated(try c.decode(NodeInfo.self, forKey: .node))
        case "thread.updated":
            kind = .threadUpdated(try c.decode(ThreadInfo.self, forKey: .thread))
        case "thread.deleted":
            kind = .threadDeleted(threadId: try c.decode(String.self, forKey: .threadId))
        case "item.added":
            kind = .itemAdded(try c.decode(Item.self, forKey: .item))
        case "item.updated":
            kind = .itemUpdated(try c.decode(Item.self, forKey: .item))
        case "message.delta":
            kind = .messageDelta(
                threadId: try c.decode(String.self, forKey: .threadId),
                messageId: try c.decode(String.self, forKey: .messageId),
                text: try c.decode(String.self, forKey: .text))
        case "turn.completed":
            kind = .turnCompleted(
                threadId: try c.decode(String.self, forKey: .threadId),
                ok: try c.decode(Bool.self, forKey: .ok),
                text: try c.decode(String.self, forKey: .text))
        default:
            kind = .unknown(type)
        }
    }
}

/// Frames sent by the computer on `WS /v1/events`.
enum ServerFrame: Decodable, Sendable {
    /// Sent once, after the events since `?since=` have been replayed.
    /// `reset` means: drop local state and reload over HTTP. (The frame's
    /// `local` flag is left unread: a phone is never the computer itself.)
    case ready(seq: Int, reset: Bool, node: NodeInfo, status: NodeStatus)
    case event(Event)
    case pong
    /// A frame type added after this client was built. Ignored.
    case unknown(String)

    private enum CodingKeys: String, CodingKey {
        case type, seq, reset, node, status, event
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(String.self, forKey: .type)
        switch type {
        case "ready":
            self = .ready(
                seq: try c.decode(Int.self, forKey: .seq),
                reset: try c.decode(Bool.self, forKey: .reset),
                node: try c.decode(NodeInfo.self, forKey: .node),
                status: try c.decode(NodeStatus.self, forKey: .status))
        case "event": self = .event(try c.decode(Event.self, forKey: .event))
        case "pong": self = .pong
        default: self = .unknown(type)
        }
    }
}

/// Frames sent by clients on `WS /v1/events`.
enum ClientFrame: Encodable, Sendable {
    case ping
    /// Whether the owner is looking at this client right now.
    case presence(active: Bool)

    private enum CodingKeys: String, CodingKey { case type, active }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .ping:
            try c.encode("ping", forKey: .type)
        case .presence(let active):
            try c.encode("presence", forKey: .type)
            try c.encode(active, forKey: .active)
        }
    }
}

/// JSON coding as the protocol defines it: timestamps in milliseconds.
enum Wire {
    static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        return try decoder.decode(type, from: data)
    }

    static func encode(_ value: some Encodable) throws -> Data {
        try JSONEncoder().encode(value)
    }
}

private enum TypeKey: String, CodingKey { case type }

private extension DecodingError {
    static func unknownType(_ type: String, in decoder: Decoder) -> DecodingError {
        .dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown type “\(type)”"))
    }
}
