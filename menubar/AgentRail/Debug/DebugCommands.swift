import Foundation

enum DebugCommands {
    /// Handles debug flags and exits; returns false when no flag is present.
    /// `--dump` does a one-shot load. `--dump-after <seconds>` runs the live `SessionStore`
    /// (watcher, debounce, timer) on the main run loop for that long, then prints the same lines.
    @MainActor @discardableResult
    static func run(arguments: [String]) -> Bool {
        if let i = arguments.firstIndex(of: "--dump-after") {
            let seconds = arguments.dropFirst(i + 1).first.flatMap(Double.init) ?? 3
            let store = SessionStore()
            RunLoop.main.run(until: Date().addingTimeInterval(seconds))
            printDump(sessions: store.sessions, now: Date())
            exit(0)
        }
        guard arguments.contains("--dump") else { return false }
        printDump(sessions: StateRoot.loadSessions(), now: Date())
        exit(0)
    }

    private static func printDump(sessions: [Session], now: Date) {
        let items = visibleJobs(sessions, now: now)
        for item in items {
            let p = progress(item.job)
            let stale = isStale(item, now: now) ? " stale" : ""
            let pct = p.pct.map { "\($0)%" } ?? "—"
            let label = item.job.now?.pills.last?.label ?? "-"
            let agentCount = 1 + agents(of: item).count
            print("\(item.session.source.rawValue) \(item.job.status.rawValue)\(stale) \"\(item.job.title)\" \(p.done)/\(p.total) \(pct) agents=\(agentCount) now=\(label)")
        }
        let s = menubarSummary(items, now: now)
        let avg = s.avgPct.map { "\($0)%" } ?? "—"
        print("jobs=\(s.jobs) agents=\(s.agents) avg=\(avg) attention=\(s.attention) doneToday=\(doneToday(sessions, now: now))")
        fflush(stdout)
    }
}
