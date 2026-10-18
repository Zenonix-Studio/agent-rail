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
            PopoverView(store: store)
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
        .accessibilityLabel([L10n.jobs(s.jobs), L10n.agents(s.agents),
                             s.avgPct.map { String(localized: "\($0) percent") } ?? String(localized: "no progress yet")]
                .joined(separator: ", "))
    }
}
