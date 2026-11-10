import Foundation
import Security

/// A computer this phone has been added to, as remembered between launches:
/// where it answers and the token it gave this phone.
///
/// Each one is an item in the Keychain, in a group the app shares with its
/// notification extension, which needs both to fetch the picture of a
/// request. Items stay on this phone (no iCloud, no backup to another
/// device) and can be read while it is locked, so that an answer given from
/// a notification or in Live mode still goes through.
struct Computer: Codable, Identifiable, Hashable, Sendable {
    /// The computer's node id.
    let id: String
    var name: String
    var agentName: String
    /// Addresses from the pairing link, best first.
    var urls: [URL]
    /// SHA-256 of the certificate the computer showed when it was added:
    /// its direct addresses are only trusted while they still show it.
    var fingerprint: String?
    /// The address that answered last time.
    var lastURL: URL?
    /// This phone's id on that computer.
    let deviceId: String
    /// The device token: this phone's key to the computer.
    let token: String
    /// When it was added: the order they are shown in.
    let addedAt: Date
}

extension Computer {
    private static let service = "org.agentos.computers"

    /// Every computer this phone knows, oldest first.
    static func loadAll() -> [Computer] {
        var query = base()
        query[kSecMatchLimit] = kSecMatchLimitAll
        query[kSecReturnAttributes] = true
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let items = result as? [[CFString: Any]] else {
            return []
        }
        return items
            .compactMap { ($0[kSecAttrAccount] as? String).flatMap(load) }
            .sorted { $0.addedAt < $1.addedAt }
    }

    /// The computer with this node id, if this phone knows it.
    static func load(_ id: String) -> Computer? {
        var query = base(account: id)
        query[kSecReturnData] = true
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else {
            return nil
        }
        return try? JSONDecoder().decode(Computer.self, from: data)
    }

    func save() {
        guard let data = try? JSONEncoder().encode(self) else { return }
        SecItemDelete(Self.base(account: id) as CFDictionary)
        var item = Self.base(account: id)
        item[kSecValueData] = data
        item[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }

    func delete() {
        SecItemDelete(Self.base(account: id) as CFDictionary)
    }

    private static func base(account: String? = nil) -> [CFString: Any] {
        var query: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: service]
        if let account { query[kSecAttrAccount] = account }
        // The shared group, as each target's Info.plist spells it with its team prefix.
        if let group = Bundle.main.object(forInfoDictionaryKey: "KeychainGroup") as? String { query[kSecAttrAccessGroup] = group }
        return query
    }
}
