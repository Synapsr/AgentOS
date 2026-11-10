import UserNotifications

/// How a request looks as a notification, whoever posts it: this app, or
/// the notification extension dressing what a computer pushed. Its title
/// says who asks ("Nova is asking"), its subtitle says "Worth a careful
/// look" at high risk, and at high risk its buttons come in the careful
/// order: Stop first, Go ahead after it.
enum RequestNotification {
    /// The approval category at high risk. The app's own: a computer always
    /// sends `PushCategory.approval`, and this phone switches to this one
    /// from the payload's `risk`.
    static let carefulApproval = "AGENTOS_APPROVAL_CAREFUL"

    /// The category whose buttons answer a request.
    static func category(isApproval: Bool, risk: RequestItem.Risk?) -> String {
        guard isApproval else { return PushCategory.question }
        return risk == .high ? carefulApproval : PushCategory.approval
    }

    /// Gives a request's notification its title, subtitle and buttons.
    static func dress(_ content: UNMutableNotificationContent, agentName: String, risk: RequestItem.Risk?) {
        content.title = String(localized: "\(agentName) is asking")
        // Only high risk is called out: a warning on every request is a warning on none.
        content.subtitle = risk == .high ? String(localized: "Worth a careful look") : ""
        if content.categoryIdentifier == PushCategory.approval || content.categoryIdentifier == carefulApproval {
            content.categoryIdentifier = category(isApproval: true, risk: risk)
        }
    }
}
