import SwiftUI

@main
struct AgentRailApp: App {
    @State private var store: SessionStore
    /// Open agent rows; kept here so the choice outlives the popover and every reload.
    @State private var agentExpansion = AgentExpansion()
    @NSApplicationDelegateAdaptor private var appDelegate: AppDelegate

    init() {
        // Debug flags (e.g. --dump) print and exit before any UI or store starts.
        DebugCommands.run(arguments: CommandLine.arguments)
        let store = SessionStore()
        let notifier = JobNotifier()
        store.onTransition = { notifier.notify($0) }
        _store = State(initialValue: store)
    }

    var body: some Scene {
        MenuBarExtra {
            PopoverView(store: store, agentExpansion: agentExpansion)
        } label: {
            MenuBarLabel(store: store)
        }
        .menuBarExtraStyle(.window)
    }
}

/// Asks for notification permission once the app has finished launching: asked from `App.init`,
/// a menu bar (LSUIElement) app gets no prompt and the request is denied on the spot.
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        if CommandLine.arguments.contains("--notify-test") {
            DebugCommands.notifyTest()
        } else {
            JobNotifier.requestAuthorization()
        }
    }
}

private struct MenuBarLabel: View {
    let store: SessionStore

    var body: some View {
        let s = store.summary
        HStack(spacing: 4) {
            Image(nsImage: RingIcon.image(pct: s.avgPct, attention: s.attention))
            if s.jobs > 0 { Text("\(s.jobs)") }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([L10n.jobs(s.jobs), L10n.agents(s.agents),
                             s.avgPct.map { String(localized: "\($0) percent") } ?? String(localized: "no progress yet")]
                .joined(separator: ", "))
    }
}
