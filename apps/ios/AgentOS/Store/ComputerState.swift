import Foundation

/// Everything the phone knows about one computer. It starts from what the
/// HTTP API returns and is then kept current by applying events in order.
struct ComputerState: Sendable {
    /// Agent text that is still being typed.
    struct Typing: Equatable, Sendable {
        let messageId: String
        var text: String
    }

    var node: NodeInfo?
    var status: NodeStatus?
    var threads: [String: ThreadInfo] = [:]
    /// Timeline of each conversation that has been opened, oldest first.
    var items: [String: [Item]] = [:]
    /// Whether older items exist on the computer, per loaded conversation.
    var hasEarlier: [String: Bool] = [:]
    /// In-progress agent message per conversation.
    var typing: [String: Typing] = [:]
    /// Requests waiting for the owner, oldest first, from every conversation.
    var pending: [RequestItem] = []
    /// Position of the last stored event applied.
    var seq = 0

    /// Background jobs, most recently active first.
    var jobs: [ThreadInfo] {
        threads.values.filter { $0.kind == .job }.sorted { $0.updatedAt > $1.updatedAt }
    }

    /// Applies one event. Stored events that were already applied (a replay
    /// overlapping what we have) are ignored; ephemeral ones always apply.
    mutating func apply(_ event: Event) {
        if event.seq > 0 {
            guard event.seq > seq else { return }
            seq = event.seq
        }
        switch event.kind {
        case .nodeStatus(let status):
            self.status = status
        case .nodeUpdated(let node):
            self.node = node
        case .threadUpdated(let thread):
            threads[thread.id] = thread
        case .threadDeleted(let threadId):
            threads[threadId] = nil
            items[threadId] = nil
            hasEarlier[threadId] = nil
            typing[threadId] = nil
            pending.removeAll { $0.threadId == threadId }
        case .itemAdded(let item), .itemUpdated(let item):
            upsert(item)
        case .messageDelta(let threadId, let messageId, let text):
            if typing[threadId]?.messageId == messageId {
                typing[threadId]?.text += text
            } else if items[threadId]?.contains(where: { $0.id == messageId }) != true {
                typing[threadId] = Typing(messageId: messageId, text: text)
            }
        case .turnCompleted(let threadId, _, _):
            typing[threadId] = nil
        case .unknown:
            break
        }
    }

    /// The `ready` frame: where the log stands now. After a reset nothing we
    /// held can be trusted, so everything is dropped and reloaded over HTTP.
    mutating func ready(seq: Int, reset: Bool, node: NodeInfo, status: NodeStatus) {
        if reset { self = ComputerState() }
        self.node = node
        self.status = status
        self.seq = seq
    }

    /// Adds an item, or replaces the one with the same id.
    mutating func upsert(_ item: Item) {
        if let index = items[item.threadId]?.firstIndex(where: { $0.id == item.id }) {
            items[item.threadId]?[index] = item
        } else {
            items[item.threadId, default: []].append(item)
        }
        switch item {
        case .message(let message):
            // The whole message has arrived: it replaces what was being typed.
            if typing[message.threadId]?.messageId == message.id { typing[message.threadId] = nil }
        case .request(let request):
            pending.removeAll { $0.id == request.id }
            if request.state == .pending {
                pending.append(request)
                pending.sort { $0.at < $1.at }
            }
        case .activity:
            break
        }
    }

    mutating func load(threads list: [ThreadInfo]) {
        threads = Dictionary(list.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
    }

    /// Merges a page of a conversation. The newest page replaces the
    /// timeline, keeping anything that arrived while it was being fetched;
    /// an `older` page goes in front.
    mutating func load(_ page: ItemsResponse, older: Bool = false) {
        let id = page.thread.id
        let current = items[id] ?? []
        if older {
            let known = Set(current.map(\.id))
            items[id] = page.items.filter { !known.contains($0.id) } + current
        } else {
            threads[id] = page.thread
            let known = Set(page.items.map(\.id))
            let newest = page.items.last?.at ?? .distantPast
            items[id] = page.items + current.filter { !known.contains($0.id) && $0.at >= newest }
        }
        hasEarlier[id] = page.hasMore
    }
}
