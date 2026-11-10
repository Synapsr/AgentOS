import Foundation
import Testing
@testable import AgentOS

@Suite struct PairingLinkTests {
    @Test func parsesTheLinkTheComputerShows() throws {
        // Exactly what `encodePairingLink` in packages/protocol produces.
        let text = "agentos://pair?v=1&c=K7Q2-9XPL&i=node_8f3a&n=Mac+mini+du+bureau&u=http%3A%2F%2F100.101.102.103%3A4747&u=http%3A%2F%2F192.168.1.20%3A4747"
        let link = try #require(PairingLink(text))
        #expect(link.code == "K7Q2-9XPL")
        #expect(link.nodeId == "node_8f3a")
        #expect(link.name == "Mac mini du bureau")
        #expect(link.urls == [URL(string: "http://100.101.102.103:4747")!, URL(string: "http://192.168.1.20:4747")!])
    }

    @Test func readsTheFingerprintOfTheComputersCertificate() throws {
        let fingerprint = String(repeating: "0a1B", count: 16)
        let link = try #require(PairingLink("agentos://pair?v=1&c=abc&i=node_1&n=Mac&f=\(fingerprint)&u=https%3A%2F%2F192.168.1.20%3A4747"))
        #expect(link.fingerprint == fingerprint.lowercased())
        // Anything that is not a SHA-256 in hex is no fingerprint at all.
        for wrong in ["", "abc", String(repeating: "g", count: 64), String(repeating: "a", count: 63)] {
            #expect(try #require(PairingLink("agentos://pair?c=abc&i=node_1&f=\(wrong)&u=https%3A%2F%2F192.168.1.20%3A4747")).fingerprint == nil)
        }
    }

    @Test func toleratesSurroundingWhitespaceAndAMissingName() throws {
        let link = try #require(PairingLink("  agentos://pair?v=1&c=abc&i=node_1&u=https%3A%2F%2Frelay.example.com\n"))
        #expect(link.name == "")
        #expect(link.urls == [URL(string: "https://relay.example.com")!])
    }

    @Test func keepsAPlusSignThatWasEncoded() throws {
        let link = try #require(PairingLink("agentos://pair?c=a%2Bb&i=n&n=C%2B%2B+box&u=http%3A%2F%2F10.0.0.2%3A4747"))
        #expect(link.code == "a+b")
        #expect(link.name == "C++ box")
    }

    @Test(arguments: [
        "",
        "hello",
        "https://example.com/pair?c=abc&i=node_1&u=http%3A%2F%2F10.0.0.2%3A4747",
        "agentos://settings?c=abc&i=node_1&u=http%3A%2F%2F10.0.0.2%3A4747",
        "agentos://pair?i=node_1&u=http%3A%2F%2F10.0.0.2%3A4747",
        "agentos://pair?c=abc&u=http%3A%2F%2F10.0.0.2%3A4747",
        "agentos://pair?c=abc&i=node_1",
        "agentos://pair?c=abc&i=node_1&u=ftp%3A%2F%2F10.0.0.2",
        "agentos://pair?c=abc&i=node_1&u=javascript%3Aalert(1)",
    ])
    func rejectsAnythingElse(_ text: String) {
        #expect(PairingLink(text) == nil)
    }
}
