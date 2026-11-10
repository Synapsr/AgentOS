import UniformTypeIdentifiers
import UserNotifications

extension UNNotificationAttachment {
    /// What the agent sees, as the picture of a notification. Used by the
    /// app for the notifications it posts itself, and by the notification
    /// extension for the ones the computer pushes.
    static func picture(_ data: Data, id: String, mime: String?) -> UNNotificationAttachment? {
        // A notification takes its picture from a file, and wants to be told what kind it is.
        let type = mime.flatMap { UTType(mimeType: $0) } ?? .jpeg
        let url = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString).appendingPathExtension(for: type)
        guard (try? data.write(to: url)) != nil else { return nil }
        return try? UNNotificationAttachment(identifier: id, url: url, options: [UNNotificationAttachmentOptionsTypeHintKey: type.identifier])
    }
}
