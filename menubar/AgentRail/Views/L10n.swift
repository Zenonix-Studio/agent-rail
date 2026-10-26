import Foundation

/// Localized strings that need plurals, locale-aware numbers or are shared by several views.
enum L10n {
    static func jobs(_ n: Int) -> String { String(localized: "\(n) jobs") }
    static func agents(_ n: Int) -> String { String(localized: "\(n) agents") }
    /// Heading of a job's agent rows: "Agents · 2 running", or "Agents" when none runs.
    static func agentsRunning(_ n: Int) -> String {
        n > 0 ? String(localized: "Agents · \(n) running") : String(localized: "Agents")
    }
    // Notification bodies and the footer toggle.
    static let notifyDone = String(localized: "Done")
    static let notifyWaiting = String(localized: "Needs you")
    static let notifyFailing = String(localized: "Failing")
    static let notifications = String(localized: "Notifications")

    static func moreAgents(_ n: Int) -> String { String(localized: "+\(n) more") }
    static func inBackground(_ label: String) -> String { String(localized: "In background: \(label)") }

    /// The locale of the language the UI strings resolved to (not the system region's formats).
    private static let uiLocale = Locale(identifier: Bundle.main.preferredLocalizations.first ?? "en")

    /// "60%" in English, "%60" in Turkish.
    static func percent(_ pct: Int) -> String {
        (Double(pct) / 100).formatted(.percent.precision(.fractionLength(0)).locale(uiLocale))
    }

    static func sourceName(_ source: Source) -> String {
        switch source {
        case .claude: String(localized: "Claude")
        case .codex: String(localized: "Codex")
        case .unknown: String(localized: "Agent")
        }
    }

    static func jobStatus(_ status: JobStatus) -> String {
        switch status {
        case .planning: String(localized: "planning")
        case .running: String(localized: "running")
        case .waiting: String(localized: "waiting for you")
        case .done: String(localized: "done")
        case .error: String(localized: "error")
        case .unknown: String(localized: "unknown")
        }
    }

    static func milestoneState(done: Bool, active: Bool) -> String {
        done ? String(localized: "done") : active ? String(localized: "active") : String(localized: "pending")
    }

    /// Short stage name for the stage tag.
    static func stageName(_ stage: Stage) -> String {
        switch stage {
        case .plan: String(localized: "plan")
        case .analyse: String(localized: "analyse")
        case .dev: String(localized: "dev")
        case .fix: String(localized: "fix")
        case .review: String(localized: "review")
        }
    }

    /// What a stage means, for the color legend.
    static func stageMeaning(_ stage: Stage) -> String {
        switch stage {
        case .plan: String(localized: "Planning the work")
        case .analyse: String(localized: "Reading and searching")
        case .dev: String(localized: "Writing code")
        case .fix: String(localized: "Fixing after a failure")
        case .review: String(localized: "Building, testing, reviewing")
        }
    }

    /// Rough time left after the step count: "~4 min left".
    static func timeLeft(_ interval: TimeInterval) -> String {
        String(localized: "~\(formatDuration(interval)) left")
    }

    /// "820 tok", "64k tok", "1.2M tok" (`formatTokens` in core/render-ascii.mjs).
    static func tokens(_ n: Int) -> String {
        if n < 1000 { return "\(n) tok" }
        if n < 999_500 { return "\(Int((Double(n) / 1000).rounded()))k tok" }
        return String(format: n < 99_950_000 ? "%.1fM tok" : "%.0fM tok", Double(n) / 1e6)
    }

    /// "quiet 7m": a running agent with no event for a while.
    static func quiet(_ interval: TimeInterval) -> String {
        String(localized: "quiet \(Int(interval / 60))m")
    }

    static func agentStatus(_ status: AgentStatus) -> String {
        switch status {
        case .running: String(localized: "running")
        case .done: String(localized: "done")
        case .error: String(localized: "needs attention")
        case .stale: String(localized: "no activity")
        case .unknown: String(localized: "unknown")
        }
    }
}
