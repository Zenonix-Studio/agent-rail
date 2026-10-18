import SwiftUI

@main
struct AgentRailApp: App {
    init() {
        // Debug flags (e.g. --dump) print and exit before any UI starts.
        _ = DebugCommands.run(arguments: CommandLine.arguments)
    }

    var body: some Scene {
        MenuBarExtra("agent-rail", systemImage: "tram.fill") {
            Text("agent-rail")
            Divider()
            Button("Quit") { NSApplication.shared.terminate(nil) }
        }
    }
}
