import Foundation
import ServiceManagement

/// Open at login, read from and written to macOS's own login items, so it always matches
/// System Settings → General → Login Items. Off until the user turns it on.
enum LoginItem {
    static var isEnabled: Bool { SMAppService.mainApp.status == .enabled }

    /// Returns the state after the change; a refused change (e.g. blocked by policy) leaves it as it was.
    @discardableResult
    static func set(_ on: Bool) -> Bool {
        do {
            if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
        } catch {
            NSLog("AgentRail: open at login could not be %@: %@", on ? "enabled" : "disabled", String(describing: error))
        }
        return isEnabled
    }
}
