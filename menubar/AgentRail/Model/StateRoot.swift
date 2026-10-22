import Foundation

enum StateRoot {
    /// `$AGENT_RAIL_HOME`, or else `~/.agent-rail`.
    static func url(environment: [String: String] = ProcessInfo.processInfo.environment) -> URL {
        if let home = environment["AGENT_RAIL_HOME"], !home.isEmpty {
            return URL(fileURLWithPath: home, isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".agent-rail", isDirectory: true)
    }

    /// Decodes `sessions/*.json` modified within 24 h; unreadable or unsupported files are skipped.
    /// One-shot variant of `SessionLoader`, so `--dump` and the live store share the same filter.
    static func loadSessions(root: URL = url(), now: Date = Date()) -> [Session] {
        var loader = SessionLoader(directory: root.appendingPathComponent("sessions", isDirectory: true))
        return loader.load(now: now)
    }
}

/// Lists and decodes session files, caching each by (filename, mtime) so unchanged files are not decoded again.
struct SessionLoader {
    /// The history goes back this far; live cards still hide after 24 h (`hiddenAfter`).
    static let maxAge: TimeInterval = 48 * 60 * 60

    let directory: URL
    private var cache: [String: (mtime: Date, session: Session?)] = [:]
    /// File names and mtimes of the last load's inputs; equal signatures mean the same data.
    private(set) var signature: [String: Date] = [:]

    init(directory: URL) { self.directory = directory }

    mutating func load(now: Date) -> [Session] {
        let files = (try? FileManager.default.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        var fresh: [String: (mtime: Date, session: Session?)] = [:]
        var loaded: [(name: String, session: Session)] = []
        for url in files where url.pathExtension == "json" {
            guard let mtime = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate,
                  now.timeIntervalSince(mtime) <= Self.maxAge else { continue }
            let key = url.lastPathComponent
            let entry: (mtime: Date, session: Session?)
            if let cached = cache[key], cached.mtime == mtime {
                entry = cached
            } else {
                entry = (mtime, (try? Data(contentsOf: url)).flatMap(SessionDecoder.decode))
            }
            fresh[key] = entry
            if let session = entry.session { loaded.append((key, session)) }
        }
        cache = fresh
        signature = fresh.mapValues(\.mtime)
        return loaded.sorted { $0.name < $1.name }.map(\.session)
    }
}
