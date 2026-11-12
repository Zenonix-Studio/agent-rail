import Foundation

/// The Claude Code plugin's `/config` options, read from and written to ~/.claude/settings.json
/// (`pluginConfigs["agent-rail@…"].options`), the same place `/config` and the hooks use,
/// so the menubar and `/config` always show the same values.
enum PluginConfig {
    static var url: URL {
        let dir = ProcessInfo.processInfo.environment["CLAUDE_CONFIG_DIR"]
            .map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.homeDirectoryForCurrentUser.appending(path: ".claude")
        return dir.appending(path: "settings.json")
    }

    /// False when Claude Code's settings file is missing or unreadable: the menu then hides these switches.
    static var isAvailable: Bool { readSettings() != nil }

    static var railed: Bool { options["mode"] as? String == "railed" }
    static var openPane: Bool { options["openPane"] as? Bool ?? true }
    static var band: Bool { options["band"] as? Bool ?? true }

    static func setRailed(_ on: Bool) { set("mode", on ? "railed" : "free") }
    static func setOpenPane(_ on: Bool) { set("openPane", on) }
    static func setBand(_ on: Bool) { set("band", on) }

    private static func readSettings() -> [String: Any]? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    /// The installed plugin's key (`agent-rail@<marketplace>`), as the hooks find it.
    private static func key(in configs: [String: Any]) -> String {
        configs.keys.first { $0 == "agent-rail" || $0.hasPrefix("agent-rail@") } ?? "agent-rail@agent-rail"
    }

    private static var options: [String: Any] {
        let configs = readSettings()?["pluginConfigs"] as? [String: Any] ?? [:]
        return (configs[key(in: configs)] as? [String: Any])?["options"] as? [String: Any] ?? [:]
    }

    /// Re-reads the file right before writing, so only this one option changes.
    // ponytail: JSONSerialization does not keep key order, so the file comes back with sorted keys;
    // Claude Code reads it the same. An order-keeping writer is the upgrade if anyone minds.
    private static func set(_ name: String, _ value: Any) {
        guard var settings = readSettings() else { return }
        var configs = settings["pluginConfigs"] as? [String: Any] ?? [:]
        let k = key(in: configs)
        var entry = configs[k] as? [String: Any] ?? [:]
        var opts = entry["options"] as? [String: Any] ?? [:]
        opts[name] = value
        entry["options"] = opts
        configs[k] = entry
        settings["pluginConfigs"] = configs
        do {
            let data = try JSONSerialization.data(withJSONObject: settings, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
            // Resolved, so a settings.json symlinked from a dotfiles repo stays a symlink.
            try data.write(to: url.resolvingSymlinksInPath(), options: .atomic)
        } catch {
            NSLog("AgentRail: could not write %@: %@", url.path, String(describing: error))
        }
    }
}
