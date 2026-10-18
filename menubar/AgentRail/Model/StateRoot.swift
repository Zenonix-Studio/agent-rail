import Foundation

enum StateRoot {
    /// `$AGENT_RAIL_HOME`, or else `~/.agent-rail`.
    static func url(environment: [String: String] = ProcessInfo.processInfo.environment) -> URL {
        if let home = environment["AGENT_RAIL_HOME"], !home.isEmpty {
            return URL(fileURLWithPath: home, isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".agent-rail", isDirectory: true)
    }

    /// Decodes every readable `sessions/*.json`; unreadable or unsupported files are skipped.
    static func loadSessions(root: URL = url()) -> [Session] {
        let dir = root.appendingPathComponent("sessions", isDirectory: true)
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        return files
            .filter { $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
            .compactMap { try? Data(contentsOf: $0) }
            .compactMap(SessionDecoder.decode)
    }
}
