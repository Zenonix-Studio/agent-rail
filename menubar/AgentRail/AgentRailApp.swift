import SwiftUI

@main
struct AgentRailApp: App {
    @State private var store: SessionStore

    init() {
        // Debug flags (e.g. --dump) print and exit before any UI or store starts.
        DebugCommands.run(arguments: CommandLine.arguments)
        _store = State(initialValue: SessionStore())
    }

    var body: some Scene {
        MenuBarExtra {
            Text("agent-rail")
            Divider()
            Button("Quit") { NSApplication.shared.terminate(nil) }
        } label: {
            MenuBarLabel(store: store)
        }
        .menuBarExtraStyle(.window)
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
        .accessibilityLabel("\(s.jobs) jobs, \(s.agents) agents, \(s.avgPct ?? 0) percent")
    }
}
