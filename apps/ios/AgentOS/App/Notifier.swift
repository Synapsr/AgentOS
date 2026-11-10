import UIKit
import UserNotifications

/// Notifications: telling the owner when the agent asks or finishes while
/// the app is not on screen, and taking their answer straight from the
/// notification — on the phone or on the Apple Watch that mirrors it.
///
/// The notifications posted here look like the pushes a computer sends
/// (`packages/protocol/src/push.ts`): same categories, same payload, the
/// request's id as identifier. Whichever arrives, the same code answers it,
/// and one replaces the other instead of showing twice.
@MainActor
final class Notifier: NSObject {
    private enum Action {
        // The first two are the option ids of an approval, on purpose.
        static let approve = RequestItem.Option.approve
        static let deny = RequestItem.Option.deny
        static let reply = "reply"
    }

    private let center = UNUserNotificationCenter.current()

    /// Finds the computer a notification is about.
    var store: (_ nodeId: String) -> ComputerStore? = { _ in nil }
    /// Called when the owner opens a notification.
    var onOpen: (ComputerStore) -> Void = { _ in }

    /// Must run before the app finishes launching, so that an answer given
    /// while the app was not running is delivered.
    func start() {
        center.delegate = self
        // Every action tells the computer something in its owner's name, so
        // every one asks for the phone to be unlocked first — "Stop" too: a
        // refusal is an instruction like any other, and what is refused may
        // be the very thing that protects the owner. Stop is never painted
        // as danger: it is the safe answer.
        let approve = UNNotificationAction(
            identifier: Action.approve, title: String(localized: "Go ahead"), options: [.authenticationRequired],
            icon: UNNotificationActionIcon(systemImageName: "checkmark"))
        let deny = UNNotificationAction(
            identifier: Action.deny, title: String(localized: "Stop"), options: [.authenticationRequired],
            icon: UNNotificationActionIcon(systemImageName: "hand.raised"))
        let reply = UNTextInputNotificationAction(
            identifier: Action.reply, title: String(localized: "Reply"), options: [.authenticationRequired],
            textInputButtonTitle: String(localized: "Send"), textInputPlaceholder: "")
        // With previews hidden, the lock screen still says who asks — and nothing of what.
        let request = UNNotificationCategoryOptions.hiddenPreviewsShowTitle
        center.setNotificationCategories([
            UNNotificationCategory(identifier: PushCategory.approval, actions: [approve, deny], intentIdentifiers: [], options: request),
            // At high risk the safe answer comes first.
            UNNotificationCategory(identifier: RequestNotification.carefulApproval, actions: [deny, approve], intentIdentifiers: [], options: request),
            UNNotificationCategory(identifier: PushCategory.question, actions: [reply], intentIdentifiers: [], options: request),
            UNNotificationCategory(identifier: PushCategory.turn, actions: [reply], intentIdentifiers: []),
        ])
    }

    /// Asks the owner for permission (once), and Apple for a push token.
    func enable() async {
        guard (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) == true else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// The agent is asking: who asks, its sentence, what it sees, and the buttons to answer.
    func post(_ request: RequestItem, from store: ComputerStore) async {
        let content = content(
            body: request.spoken, category: request.kind == .approval ? PushCategory.approval : PushCategory.question,
            payload: PushPayload(
                nodeId: store.id, kind: .request, threadId: request.threadId,
                requestId: request.id, screenshotId: request.screenshot?.id, risk: request.risk),
            from: store)
        RequestNotification.dress(content, agentName: store.computer.agentName, risk: request.risk)
        content.interruptionLevel = .timeSensitive
        if let screenshot = request.screenshot, let data = await store.data(for: screenshot) {
            content.attachments = UNNotificationAttachment.picture(data, id: screenshot.id, mime: screenshot.mime).map { [$0] } ?? []
        }
        try? await center.add(UNNotificationRequest(identifier: request.id, content: content, trigger: nil))
    }

    /// What the agent says at the end of its turn.
    func post(turn text: String, in threadId: String, from store: ComputerStore) async {
        let content = content(
            body: text, category: PushCategory.turn,
            payload: PushPayload(nodeId: store.id, kind: .turn, threadId: threadId), from: store)
        try? await center.add(UNNotificationRequest(identifier: "turn.\(store.id).\(threadId)", content: content, trigger: nil))
    }

    /// Something the app itself must tell the owner.
    func post(notice: String) async {
        let content = UNMutableNotificationContent()
        content.body = notice
        content.sound = .default
        try? await center.add(UNNotificationRequest(identifier: "notice", content: content, trigger: nil))
    }

    /// Takes back the notification of a request that no longer needs an
    /// answer — found by what it is about, whoever delivered it.
    func withdraw(requestId: String) {
        Task {
            let center = UNUserNotificationCenter.current()
            let identifiers = await center.deliveredNotifications()
                .filter { PushPayload(userInfo: $0.request.content.userInfo)?.requestId == requestId }
                .map(\.request.identifier)
            center.removeDeliveredNotifications(withIdentifiers: identifiers)
        }
    }

    /// A push that arrived silently: the computer saying a request was
    /// settled somewhere else.
    func received(remote userInfo: [AnyHashable: Any]) {
        guard let payload = PushPayload(userInfo: userInfo), payload.kind == .resolved, let requestId = payload.requestId else {
            return
        }
        withdraw(requestId: requestId)
    }

    private func content(body: String, category: String, payload: PushPayload, from store: ComputerStore) -> UNMutableNotificationContent {
        let content = UNMutableNotificationContent()
        content.title = store.computer.agentName
        content.body = body
        content.sound = .default
        content.categoryIdentifier = category
        content.threadIdentifier = payload.threadId
        content.userInfo = payload.userInfo
        return content
    }

    /// Carries out what the owner chose on a notification.
    private func respond(to payload: PushPayload, action: String, text: String?) async {
        guard let store = store(payload.nodeId) else { return }
        do {
            switch (action, payload.requestId) {
            case (Action.approve, let requestId?), (Action.deny, let requestId?):
                try await store.resolve(requestId, optionId: action)
            case (Action.reply, let requestId?):
                try await store.resolve(requestId, text: text)
            case (Action.reply, nil):
                if let text, !text.isEmpty { try await store.send(text, to: payload.threadId) }
            default:
                onOpen(store)
            }
        } catch {
            await post(notice: String(localized: "I couldn't send your answer to \(store.computer.name). Open AgentOS to try again."))
        }
    }
}

// UIKit expects these to finish on the main thread, where the rest of this
// class lives; `@preconcurrency` lets them be main-actor methods.
extension Notifier: @preconcurrency UNUserNotificationCenterDelegate {
    /// While the app is on screen it shows things itself.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        []
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let payload = PushPayload(userInfo: response.notification.request.content.userInfo) else { return }
        await respond(
            to: payload, action: response.actionIdentifier,
            text: (response as? UNTextInputNotificationResponse)?.userText)
    }
}
