import Foundation
import Security
import Testing
@testable import AgentOS

/// Whom the phone agrees to talk to. The device token goes out with every
/// request, so these rules are what keeps it from anyone but the computer.
@Suite struct TransportTests {
    /// SHA-256 of `Fixtures/computer.der`, as `openssl` gives it: a throwaway self-signed certificate.
    private let fingerprint = "20ed71803ef998498f2e981540bc895e8d573f1151874d4d4bc75d3181be878a"

    @Test(arguments: [
        ("https://192.168.1.20:4747", NodeClient.Transport.pinned),
        ("https://mac-mini.local:4747", .pinned),
        ("https://relay.example.com/n/node_1", .relay),
        ("http://127.0.0.1:4747", .plain),
        ("http://localhost:4747", .plain),
        ("http://100.64.0.1:4747", .plain),
        ("http://100.127.255.254:4747", .plain),
        ("http://mac-mini.tail1234.ts.net:4747", .plain),
    ])
    func knowsWhatMakesAnAddressSafe(_ address: String, _ expected: NodeClient.Transport) throws {
        #expect(NodeClient.Transport(try #require(URL(string: address))) == expected)
    }

    @Test(arguments: [
        "http://192.168.1.20:4747", "http://10.0.0.2:4747", "http://mac-mini.local:4747", "http://relay.example.com/n/node_1",
        "http://100.63.255.255:4747", "http://100.128.0.1:4747", "http://127.0.0.1.example.com:4747", "http://evil-ts.net.example.com:4747",
        "ftp://127.0.0.1",
    ])
    func refusesPlainHTTPWhereOthersCanListen(_ address: String) throws {
        #expect(NodeClient.Transport(try #require(URL(string: address))) == nil)
    }

    @Test func computesTheFingerprintPairingLinksCarry() throws {
        #expect(NodeClient.fingerprint(ofCertificate: try Fixture.data("computer.der")) == fingerprint)
    }

    @Test func trustsOnlyTheCertificateOfTheComputerThatWasAdded() throws {
        let certificate = try #require(SecCertificateCreateWithData(nil, try Fixture.data("computer.der") as CFData))
        var trust: SecTrust?
        #expect(SecTrustCreateWithCertificates(certificate, SecPolicyCreateBasicX509(), &trust) == errSecSuccess)
        #expect(NodeClient.isCertificate(of: try #require(trust), theOneWith: fingerprint))
        // One character off, another computer's, or none at all: refused.
        #expect(!NodeClient.isCertificate(of: try #require(trust), theOneWith: "30" + fingerprint.dropFirst(2)))
        #expect(!NodeClient.isCertificate(of: try #require(trust), theOneWith: String(repeating: "0", count: 64)))
        #expect(!NodeClient.isCertificate(of: try #require(trust), theOneWith: ""))
    }

    /// These fail before anything is sent: no connection is opened at all.
    @Test func sendsNothingToAnAddressNothingProtects() async throws {
        let direct = NodeClient(baseURL: try #require(URL(string: "https://192.0.2.1:4747")), token: "secret", fingerprint: nil)
        await #expect(throws: NodeClient.Refusal.unprotected(relay: false)) { try await direct.hello() }
        #expect(throws: NodeClient.Refusal.unprotected(relay: false)) { try direct.events(since: nil) }
        let plain = NodeClient(baseURL: try #require(URL(string: "http://192.0.2.1:4747")), token: "secret", fingerprint: fingerprint)
        await #expect(throws: NodeClient.Refusal.unprotected(relay: false)) { try await plain.node() }
        let relay = NodeClient(baseURL: try #require(URL(string: "http://relay.example.com/n/node_1")), token: "secret", fingerprint: nil)
        await #expect(throws: NodeClient.Refusal.unprotected(relay: true)) { try await relay.node() }
        // And finding a computer says why, when that is why.
        await #expect(throws: NodeClient.Refusal.unprotected(relay: false)) {
            try await NodeClient.reach(nodeId: "node_1", at: [direct.baseURL, plain.baseURL], fingerprint: nil)
        }
    }

    @Test func theAgentsWordsOnlyLinkToTheWeb() throws {
        let words = AgentText.formatted(
            "See [the page](https://example.com/a), not [this](agentos://pair?c=x&i=y&u=http%3A%2F%2F10.0.0.2), [that](tel:112), [it](javascript:alert(1)) or [here](HTTP://example.com/b).")
        let links = words.runs.compactMap(\.link).map(\.absoluteString)
        #expect(links == ["https://example.com/a", "HTTP://example.com/b"])
        // What is no longer a link is still there to read.
        #expect(String(words.characters) == "See the page, not this, that, it or here.")
    }
}
