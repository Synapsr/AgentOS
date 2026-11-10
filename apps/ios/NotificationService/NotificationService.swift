import UserNotifications

/// Runs when the computer pushes "the agent is asking" with
/// `mutable-content` (see `packages/protocol/src/push.ts`): it says who asks
/// and, at high risk, "Worth a careful look", with the buttons in the
/// careful order; and it gets what the agent sees from the computer and
/// attaches it, so that the owner can decide from the notification — or
/// from the watch.
///
/// iOS gives it about thirty seconds, and no microphone or speech: it can
/// add a picture, never a voice.
final class NotificationService: UNNotificationServiceExtension, @unchecked Sendable {
    /// What is still owed to iOS: the notification, and the way to hand it
    /// back. Behind a lock, because time can run out on one thread while
    /// the picture arrives on another; whoever takes it delivers, once.
    private var owed: Owed?
    private let lock = NSLock()

    private struct Owed {
        var content: UNNotificationContent
        let deliver: (UNNotificationContent) -> Void
        var work: Task<Void, Never>?
    }

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        lock.withLock { owed = Owed(content: request.content, deliver: contentHandler) }
        guard let payload = PushPayload(userInfo: request.content.userInfo), payload.kind == .request,
              let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
            return finish()
        }
        let computer = Computer.load(payload.nodeId)
        // The computer titles it with the agent's name alone: the phone says who asks, in its own words.
        RequestNotification.dress(content, agentName: computer?.agentName ?? content.title, risk: payload.risk)
        lock.withLock { owed?.content = content }
        guard let screenshotId = payload.screenshotId, let computer else {
            return finish(content)
        }
        nonisolated(unsafe) let withPicture = content
        let work = Task {
            // The computer may be at home, on Tailscale or behind its relay: ask everywhere at once.
            if let client = try? await NodeClient.reach(nodeId: computer.id, at: computer.urls, fingerprint: computer.fingerprint, token: computer.token),
               let file = try? await client.file(screenshotId),
               let picture = UNNotificationAttachment.picture(file.data, id: screenshotId, mime: file.mime) {
                withPicture.attachments = [picture]
            }
            finish(withPicture)
        }
        lock.withLock { owed?.work = work }
    }

    /// Out of time: the notification goes out without its picture.
    override func serviceExtensionTimeWillExpire() {
        finish()
    }

    private func finish(_ content: UNNotificationContent? = nil) {
        lock.lock()
        let owed = owed
        self.owed = nil
        lock.unlock()
        guard let owed else { return }
        owed.work?.cancel()
        owed.deliver(content ?? owed.content)
    }
}
