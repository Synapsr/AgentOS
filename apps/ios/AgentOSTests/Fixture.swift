import Foundation
import Testing
@testable import AgentOS

/// Fixtures recorded from the real daemon (`AGENTOS_ENGINE=mock`): one
/// session of `WS /v1/events` and the HTTP answers that go with it. Only
/// `thread-deleted.json` is written by hand — nothing emits that event yet.
enum Fixture {
    private final class Marker {}

    static func data(_ file: String) throws -> Data {
        let url = try #require(Bundle(for: Marker.self).url(forResource: file, withExtension: nil))
        return try Data(contentsOf: url)
    }

    static func decode<T: Decodable>(_ type: T.Type, from file: String) throws -> T {
        try Wire.decode(type, from: try data(file))
    }

    /// The frames of a recording, one JSON document per line.
    static func frames(_ file: String) throws -> [ServerFrame] {
        try String(decoding: try data(file), as: UTF8.self)
            .split(separator: "\n")
            .map { try Wire.decode(ServerFrame.self, from: Data($0.utf8)) }
    }

    /// The events of a recording, in order.
    static func events(_ file: String) throws -> [Event] {
        try frames(file).compactMap { frame in
            if case .event(let event) = frame { event } else { nil }
        }
    }
}
