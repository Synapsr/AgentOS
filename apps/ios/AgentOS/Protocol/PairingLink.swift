import Foundation

/// What the QR code shown by a computer contains:
///
///     agentos://pair?v=1&c=<code>&i=<nodeId>&n=<name>&f=<fingerprint>&u=<url>&u=<url>
///
/// Mirrors `packages/protocol/src/pairing.ts`.
struct PairingLink: Equatable, Sendable {
    /// One-time secret. Expires after a few minutes or on first use.
    let code: String
    let nodeId: String
    /// Computer name, shown before pairing completes.
    let name: String
    /// Base URLs to try, best first (Tailscale, LAN, relay).
    let urls: [URL]
    /// SHA-256 of the computer's certificate (DER), lowercase hex. Nil only
    /// for links made by a computer that serves no certificate.
    let fingerprint: String?

    /// Returns nil when the text is not a valid AgentOS pairing link.
    init?(_ text: String) {
        // The computer writes the query like a web form, where "+" is a space.
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines).replacing("+", with: "%20")
        guard let link = URLComponents(string: text), link.scheme == "agentos", link.host == "pair" else {
            return nil
        }
        let query = link.queryItems ?? []
        func first(_ name: String) -> String? {
            query.first { $0.name == name }?.value
        }
        let urls = query
            .filter { $0.name == "u" }
            .compactMap { $0.value.flatMap(URL.init(string:)) }
            .filter { ["http", "https"].contains($0.scheme) && $0.host() != nil }
        guard let code = first("c"), !code.isEmpty, let nodeId = first("i"), !nodeId.isEmpty, !urls.isEmpty else {
            return nil
        }
        self.code = code
        self.nodeId = nodeId
        self.name = first("n") ?? ""
        self.urls = urls
        let fingerprint = first("f")?.lowercased() ?? ""
        self.fingerprint = fingerprint.wholeMatch(of: /[0-9a-f]{64}/) == nil ? nil : fingerprint
    }
}
