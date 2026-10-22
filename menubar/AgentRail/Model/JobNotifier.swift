import Foundation
import UserNotifications

/// Posts a macOS notification when a job finishes, waits for the user or starts failing.
/// Silent when the user turned notifications off in the popover or denied them in System Settings.
@MainActor
final class JobNotifier {
    /// UserDefaults key of the popover footer toggle; missing means on.
    static let enabledKey = "notificationsEnabled"

    static var isEnabled: Bool {
        UserDefaults.standard.object(forKey: enabledKey) as? Bool ?? true
    }

    private let center = UNUserNotificationCenter.current()
    private let presenter = ForegroundPresenter()

    init() {
        // A menu bar app counts as frontmost while its popover is open; show banners anyway.
        center.delegate = presenter
    }

    /// Asks for alert + sound. The system prompts only the first time; later calls return the stored answer.
    static func requestAuthorization() {
        guard isEnabled else { return }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    func notify(_ transition: JobTransition) {
        guard Self.isEnabled, let body = Self.body(for: transition.item.job) else { return }
        let content = UNMutableNotificationContent()
        content.title = displayTitle(transition.item)
        content.body = body
        content.sound = .default
        // One notification per job: a newer status replaces the older banner in Notification Center.
        let request = UNNotificationRequest(identifier: transition.item.job.id, content: content, trigger: nil)
        Task { [center] in
            guard await center.notificationSettings().authorizationStatus == .authorized else { return }
            try? await center.add(request)
        }
    }

    /// "Done · <progress>", "Needs you", "Failing · <latest warn pill>"; nil for other statuses.
    private static func body(for job: Job) -> String? {
        switch job.status {
        case .done:
            return job.progress.isEmpty ? L10n.notifyDone : "\(L10n.notifyDone) · \(job.progress)"
        case .waiting:
            return L10n.notifyWaiting
        case .error:
            let warn = job.now?.pills.last { $0.kind == .warn }?.label
            return warn.map { "\(L10n.notifyFailing) · \($0)" } ?? L10n.notifyFailing
        case .planning, .running, .unknown:
            return nil
        }
    }
}

private final class ForegroundPresenter: NSObject, UNUserNotificationCenterDelegate, Sendable {
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
}
