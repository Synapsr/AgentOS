import CryptoKit
import Foundation
import Synchronization

/// Talks to one computer at one address: the HTTP routes of
/// `packages/protocol/src/api.ts` a phone uses, and the live event stream.
///
/// The device token goes out with every request, so an address is only
/// talked to when nobody else can read or answer it (see `Transport`).
struct NodeClient: Sendable {
    let baseURL: URL
    /// Device token, sent on every route except `hello` and `pair`.
    var token: String?
    /// SHA-256 of the certificate the computer showed when it was added
    /// (DER, lowercase hex): what authenticates a direct `https://` address.
    var fingerprint: String?

    /// What makes an address safe to talk to.
    enum Transport: Equatable {
        /// Through a relay: ordinary HTTPS, checked the usual way.
        case relay
        /// Straight to the computer, over TLS with its own self-signed
        /// certificate: safe only when that certificate is the one whose
        /// fingerprint came with the pairing code.
        case pinned
        /// Plain HTTP where nobody can listen: this device itself, or a
        /// Tailscale address, which is encrypted already.
        case plain

        /// The transport for `url`, or nil when nothing makes it safe:
        /// plain HTTP on a network others share.
        init?(_ url: URL) {
            let host = url.host()?.lowercased() ?? ""
            switch url.scheme {
            // A relay address is the one with a path: `https://relay…/n/<nodeId>`.
            case "https": self = url.path().count > 1 ? .relay : .pinned
            case "http" where Self.isLoopback(host) || Self.isTailscale(host): self = .plain
            default: return nil
            }
        }

        private static func isLoopback(_ host: String) -> Bool {
            host == "localhost" || host == "::1" || host.hasPrefix("127.") && octets(host) != nil
        }

        /// Tailscale gives each device an address in 100.64.0.0/10, and a name under ts.net.
        private static func isTailscale(_ host: String) -> Bool {
            if host.hasSuffix(".ts.net") { return true }
            guard let octets = octets(host) else { return false }
            return octets[0] == 100 && (64...127).contains(octets[1])
        }

        private static func octets(_ host: String) -> [UInt8]? {
            let parts = host.split(separator: ".", omittingEmptySubsequences: false).map { UInt8($0) }
            return parts.count == 4 && !parts.contains(nil) ? parts.compactMap(\.self) : nil
        }
    }

    /// Why an address was not talked to.
    enum Refusal: Error, Equatable {
        /// What answers there shows another certificate than the computer that was added.
        case notTheComputer
        /// Nothing protects the address: plain HTTP on a shared network, or
        /// TLS with no fingerprint to check it against. `relay`: it is a relay's.
        case unprotected(relay: Bool)
    }

    /// Computers are close by and answer fast; a silent address should fail
    /// quickly so the next one can be tried.
    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration)
    }()

    /// Lowercase hex SHA-256 of a certificate in DER form, as pairing links carry it.
    static func fingerprint(ofCertificate der: Data) -> String {
        SHA256.hash(data: der).map { String(format: "%02x", $0) }.joined()
    }

    /// Checks one connection against the certificate of the computer that
    /// was added. A different certificate ends the connection: there is no
    /// way to carry on regardless.
    private final class Pin: NSObject, URLSessionTaskDelegate, Sendable {
        let fingerprint: String
        let refused = Mutex(false)

        init(_ fingerprint: String) {
            self.fingerprint = fingerprint
        }

        func urlSession(
            _ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge
        ) async -> (URLSession.AuthChallengeDisposition, URLCredential?) {
            guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
                  let trust = challenge.protectionSpace.serverTrust else { return (.performDefaultHandling, nil) }
            if NodeClient.isCertificate(of: trust, theOneWith: fingerprint) {
                return (.useCredential, URLCredential(trust: trust))
            }
            refused.withLock { $0 = true }
            return (.cancelAuthenticationChallenge, nil)
        }
    }

    /// Whether the server behind `trust` shows the certificate with this
    /// fingerprint. The certificate is self-signed: who issued it proves
    /// nothing. Being this exact one does.
    static func isCertificate(of trust: SecTrust, theOneWith fingerprint: String) -> Bool {
        guard let leaf = (SecTrustCopyCertificateChain(trust) as? [SecCertificate])?.first else { return false }
        return Self.fingerprint(ofCertificate: SecCertificateCopyData(leaf) as Data) == fingerprint
    }

    /// The check a request to `baseURL` must pass, or the reason not to send it at all.
    private func pin() throws -> Pin? {
        switch Transport(baseURL) {
        case .relay, .plain: return nil
        case .pinned:
            guard let fingerprint else { throw Refusal.unprotected(relay: false) }
            return Pin(fingerprint)
        case nil: throw Refusal.unprotected(relay: baseURL.path().count > 1)
        }
    }

    // MARK: Pairing

    /// Is this an AgentOS computer, and which one? Needs no token. The id
    /// is public, so the answer proves nothing by itself: it only tells
    /// which address to use. What authenticates a direct address is its
    /// certificate; a relay's, the usual checks.
    func hello() async throws -> HelloResponse {
        var request = request("GET", "/v1/hello")
        request.timeoutInterval = 4
        return try await send(request)
    }

    /// Exchanges a one-time pairing code for a device token.
    func pair(code: String, deviceName: String) async throws -> PairResponse {
        try await send(request("POST", "/v1/pair", body: PairRequest(code: code, device: .init(name: deviceName, platform: .ios))))
    }

    /// Removes this phone's own pairing: its token stops working.
    func unpair() async throws {
        _ = try await data(for: request("DELETE", "/v1/devices/me"))
    }

    /// Finds where a computer answers. Every address is asked at once
    /// rather than each waiting for the one before to give up, and a
    /// direct address (Tailscale, the local network) is preferred to the
    /// relay when both answer.
    ///
    /// Throws a `Refusal` when nothing answered and an address was turned
    /// down: for showing another certificate first, for being unprotected
    /// otherwise.
    static func reach(nodeId: String, at urls: [URL], fingerprint: String?, token: String? = nil) async throws -> NodeClient {
        enum Probe {
            case answered(NodeClient), failed(URL, Refusal?), graceOver
        }
        func isRelay(_ url: URL) -> Bool { Transport(url) == .relay }

        return try await withThrowingTaskGroup(of: Probe.self) { group in
            for url in urls {
                group.addTask {
                    let client = NodeClient(baseURL: url, token: token, fingerprint: fingerprint)
                    do {
                        return try await client.hello().node.id == nodeId ? .answered(client) : .failed(url, nil)
                    } catch {
                        return .failed(url, error as? Refusal)
                    }
                }
            }
            defer { group.cancelAll() }
            var relay: NodeClient?
            var directPending = urls.count { !isRelay($0) }
            var refusals: [Refusal] = []
            for try await probe in group {
                switch probe {
                case .answered(let client) where !isRelay(client.baseURL):
                    return client
                case .answered(let client):
                    guard relay == nil else { continue }
                    relay = client
                    // The relay answered first: a direct address gets a moment more.
                    group.addTask {
                        try await Task.sleep(for: .milliseconds(700))
                        return .graceOver
                    }
                case .failed(let url, let refusal):
                    if let refusal { refusals.append(refusal) }
                    if !isRelay(url) { directPending -= 1 }
                case .graceOver:
                    if let relay { return relay }
                }
                if let relay, directPending == 0 { return relay }
            }
            if refusals.contains(.notTheComputer) { throw Refusal.notTheComputer }
            throw refusals.first ?? URLError(.cannotConnectToHost)
        }
    }

    // MARK: State

    func node() async throws -> NodeResponse {
        try await send(request("GET", "/v1/node"))
    }

    func threads() async throws -> [ThreadInfo] {
        let response: ThreadsResponse = try await send(request("GET", "/v1/threads"))
        return response.threads
    }

    /// A page of a conversation, newest last; `before` asks for older items.
    func items(threadId: String, before: String? = nil, limit: Int = 60) async throws -> ItemsResponse {
        var query = [URLQueryItem(name: "limit", value: String(limit))]
        if let before { query.append(URLQueryItem(name: "before", value: before)) }
        return try await send(request("GET", "/v1/threads/\(threadId)/items", query: query))
    }

    /// Requests waiting for the owner.
    func pendingRequests() async throws -> [RequestItem] {
        let response: RequestsResponse = try await send(request("GET", "/v1/requests"))
        return response.requests
    }

    /// Binary content of a `FileRef` (a screenshot), and its MIME type.
    func file(_ id: String) async throws -> (data: Data, mime: String?) {
        let (data, response) = try await load(request("GET", "/v1/files/\(id)"))
        return (data, response.mimeType)
    }

    // MARK: Actions

    /// Says something to the agent. Starts or steers its work.
    /// - Parameter requestId: set when these words are the owner's reply to
    ///   that pending request; only then may the computer read them as an answer.
    func send(_ text: String, via: Via, to threadId: String, answering requestId: String? = nil) async throws -> SendMessageResponse {
        try await send(
            request("POST", "/v1/threads/\(threadId)/messages", body: SendMessageRequest(text: text, via: via, requestId: requestId)))
    }

    /// Stops what the agent is doing in a conversation.
    func interrupt(threadId: String) async throws {
        _ = try await data(for: request("POST", "/v1/threads/\(threadId)/interrupt"))
    }

    /// Answers a request with one of its options, free text, or both.
    @discardableResult
    func resolve(requestId: String, optionId: String?, text: String?) async throws -> RequestItem {
        let response: ResolveResponse = try await send(
            request("POST", "/v1/requests/\(requestId)/resolve", body: ResolveRequest(optionId: optionId, text: text)))
        return response.request
    }

    /// Tells the computer where to send push notifications for this phone.
    func registerPush(_ registration: PushRegistration) async throws {
        _ = try await data(for: request("PUT", "/v1/devices/me/push", body: registration))
    }

    // MARK: Voice (when the computer does the speech)

    /// Turns a recorded utterance into text on the computer.
    func transcribe(audio: Data, mime: String, language: String) async throws -> String {
        var request = request("POST", "/v1/voice/transcribe", query: [URLQueryItem(name: "lang", value: language)])
        request.setValue(mime, forHTTPHeaderField: "Content-Type")
        request.httpBody = audio
        request.timeoutInterval = 60
        let response: TranscribeResponse = try await send(request)
        return response.text
    }

    /// Asks the computer to say `text`; the audio comes back in the node's `ttsMime`.
    func speak(_ text: String) async throws -> Data {
        var request = request("POST", "/v1/voice/speak", body: SpeakRequest(text: text))
        request.timeoutInterval = 60
        return try await data(for: request)
    }

    // MARK: Events

    /// Opens `WS /v1/events`, asking for everything after `since`.
    func events(since: Int?) throws -> EventSocket {
        let pin = try pin()
        var components = URLComponents(url: baseURL.appending(path: "/v1/events"), resolvingAgainstBaseURL: false)!
        components.scheme = baseURL.scheme == "https" ? "wss" : "ws"
        if let since { components.queryItems = [URLQueryItem(name: "since", value: String(since))] }
        var request = URLRequest(url: components.url!)
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let task = Self.session.webSocketTask(with: request)
        task.delegate = pin
        return EventSocket(task) { pin?.refused.withLock { $0 } == true }
    }

    // MARK: Plumbing

    private func request(_ method: String, _ path: String, query: [URLQueryItem] = []) -> URLRequest {
        var url = baseURL.appending(path: path)
        if !query.isEmpty { url.append(queryItems: query) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return request
    }

    private func request(_ method: String, _ path: String, body: some Encodable) -> URLRequest {
        var request = request(method, path)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? Wire.encode(body)
        return request
    }

    private func send<Response: Decodable>(_ request: URLRequest) async throws -> Response {
        try Wire.decode(Response.self, from: try await data(for: request))
    }

    private func data(for request: URLRequest) async throws -> Data {
        try await load(request).data
    }

    private func load(_ request: URLRequest) async throws -> (data: Data, response: URLResponse) {
        let pin = try pin()
        let data: Data, response: URLResponse
        do {
            (data, response) = try await Self.session.data(for: request, delegate: pin)
        } catch {
            throw pin?.refused.withLock { $0 } == true ? Refusal.notTheComputer : error
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            var error = (try? Wire.decode(APIError.self, from: data))
                ?? APIError(error: .init(code: "internal", message: HTTPURLResponse.localizedString(forStatusCode: status)))
            error.status = status
            throw error
        }
        return (data, response)
    }
}

/// One connection to `WS /v1/events`.
final class EventSocket: Sendable {
    private let task: URLSessionWebSocketTask
    private let wasRefused: @Sendable () -> Bool
    private let lastFrame = Mutex(ContinuousClock.now)

    /// - Parameter wasRefused: whether the connection was ended for showing the wrong certificate.
    fileprivate init(_ task: URLSessionWebSocketTask, wasRefused: @escaping @Sendable () -> Bool) {
        self.task = task
        self.wasRefused = wasRefused
    }

    /// Frames as they arrive. The stream throws when the connection drops —
    /// or goes quiet: a ping leaves every 20 s and each one is answered, so
    /// 45 s of silence means the computer is gone.
    func frames() -> AsyncThrowingStream<ServerFrame, Error> {
        AsyncThrowingStream { continuation in
            task.resume()
            let reader = Task {
                do {
                    while true {
                        let message = try await task.receive()
                        lastFrame.withLock { $0 = .now }
                        let data = switch message {
                        case .data(let data): data
                        case .string(let text): Data(text.utf8)
                        @unknown default: Data()
                        }
                        // A frame this build cannot read must not end the stream.
                        if let frame = try? Wire.decode(ServerFrame.self, from: data) {
                            continuation.yield(frame)
                        }
                    }
                } catch {
                    continuation.finish(throwing: wasRefused() ? NodeClient.Refusal.notTheComputer : error)
                }
            }
            let pinger = Task {
                while !Task.isCancelled {
                    try await Task.sleep(for: .seconds(20))
                    if lastFrame.withLock({ .now - $0 }) > .seconds(45) {
                        task.cancel(with: .goingAway, reason: nil)
                    } else {
                        try await send(.ping)
                    }
                }
            }
            continuation.onTermination = { [task] _ in
                reader.cancel()
                pinger.cancel()
                task.cancel(with: .goingAway, reason: nil)
            }
        }
    }

    /// Sends a frame to the computer.
    func send(_ frame: ClientFrame) async throws {
        try await task.send(.string(String(decoding: try Wire.encode(frame), as: UTF8.self)))
    }
}
