import Foundation

enum DebugCommands {
    /// Handles debug flags. `--dump` prints the visible jobs and exits; returns false when no flag is present.
    @discardableResult
    static func run(arguments: [String]) -> Bool {
        guard arguments.contains("--dump") else { return false }
        let now = Date()
        let sessions = StateRoot.loadSessions()
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
        exit(0)
    }
}
