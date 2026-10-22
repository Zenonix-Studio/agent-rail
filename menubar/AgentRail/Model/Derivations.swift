import Foundation

private let staleAfter: TimeInterval = 10 * 60
/// A running job whose last pill is still `.active` has a tool in flight, which can legitimately be silent for long.
private let staleAfterToolInFlight: TimeInterval = 60 * 60
private let hiddenAfter: TimeInterval = 24 * 60 * 60
/// A running agent with no event for this long is shown as quiet (`QUIET_MS` in core/render-ascii.mjs).
private let quietAfter: TimeInterval = 5 * 60

/// How long a running agent has been quiet; nil while it reports in (or once it stopped).
func quietFor(_ agent: Agent, now: Date) -> TimeInterval? {
    let age = now.timeIntervalSince(agent.updatedAt)
    return agent.status == .running && age >= quietAfter ? age : nil
}

/// A job's tokens: its main agent's plus its agents' (`jobTokens` in core/render-ascii.mjs).
func jobTokens(_ item: JobItem) -> Int {
    agents(of: item).reduce(item.job.tokens?.total ?? 0) { $0 + ($1.tokens?.total ?? 0) }
}

func progress(_ job: Job) -> (done: Int, total: Int, pct: Int?) {
    let total = job.milestones.count
    let done = job.milestones.filter { $0.status == .done }.count
    guard total > 0 else { return (done, total, nil) }
    return (done, total, Int((100.0 * Double(done) / Double(total)).rounded()))
}

/// Finished steps needed before a time-left estimate (`ETA_MIN_DONE` in core/progress.mjs).
let etaMinDone = 2

/// Rough time left (`eta` in core/progress.mjs): each open step is estimated by the finished steps of
/// its stage (else all finished steps), less what the active step already took. nil before two steps
/// finished or once all are done.
func eta(_ job: Job, now: Date) -> TimeInterval? {
    let spans = job.milestones.compactMap { m -> (stage: Stage?, d: TimeInterval)? in
        guard m.status == .done, let start = m.startedAt, let end = m.endedAt else { return nil }
        let d = end.timeIntervalSince(start)
        return d > 0 ? (m.stage, d) : nil
    }
    let open = job.milestones.filter { $0.status != .done }
    guard spans.count >= etaMinDone, !open.isEmpty else { return nil }
    let mean = { (xs: [TimeInterval]) in xs.reduce(0, +) / Double(xs.count) }
    let avg = mean(spans.map(\.d))
    var left: TimeInterval = 0
    for m in open {
        let same = spans.filter { $0.stage != nil && $0.stage == m.stage }.map(\.d)
        let est = m.stage != nil && !same.isEmpty ? mean(same) : avg
        let spent = m.status == .active ? m.startedAt.map { max(0, now.timeIntervalSince($0)) } ?? 0 : 0
        left += est - min(spent, est)
    }
    return max(0, left)
}

/// How long a step took, or has taken so far (`stepDuration` in core/progress.mjs); nil before it started.
func stepDuration(_ m: Milestone, now: Date) -> TimeInterval? {
    guard let start = m.startedAt else { return nil }
    return max(0, (m.endedAt ?? now).timeIntervalSince(start))
}

func isStale(_ item: JobItem, now: Date) -> Bool {
    guard item.job.status == .running || item.job.status == .planning else { return false }
    let toolInFlight = item.job.status == .running && item.job.now?.pills.last?.kind == .active
    return now.timeIntervalSince(item.session.updatedAt) > (toolInFlight ? staleAfterToolInFlight : staleAfter)
}

func visibleJobs(_ sessions: [Session], now: Date) -> [JobItem] {
    let items = sessions.compactMap { session -> JobItem? in
        guard let job = session.jobs.last, job.status != .done,
              now.timeIntervalSince(session.updatedAt) <= hiddenAfter else { return nil }
        return JobItem(session: session, job: job)
    }
    func rank(_ item: JobItem) -> Int {
        if item.job.status == .waiting { return 0 }
        return isStale(item, now: now) ? 2 : 1
    }
    return items.sorted { a, b in
        let (ra, rb) = (rank(a), rank(b))
        if ra != rb { return ra < rb }
        if a.job.updatedAt != b.job.updatedAt { return a.job.updatedAt > b.job.updatedAt }
        return a.job.id < b.job.id
    }
}

/// Finished jobs of the last 48 h across sessions, newest first: the popover's history.
/// A session file the loader reads can hold older jobs too; they are left out.
func recentJobs(_ sessions: [Session], now: Date, limit: Int = 50) -> [JobItem] {
    let done = sessions.flatMap { session in
        session.jobs.filter { $0.status == .done && now.timeIntervalSince($0.endedAt ?? $0.updatedAt) <= SessionLoader.maxAge }
            .map { JobItem(session: session, job: $0) }
    }
    return Array(done.sorted { ($0.job.endedAt ?? $0.job.updatedAt) > ($1.job.endedAt ?? $1.job.updatedAt) }.prefix(limit))
}

func doneToday(_ sessions: [Session], now: Date, calendar: Calendar = .current) -> Int {
    sessions.reduce(0) { total, session in
        total + session.jobs.filter { job in
            guard job.status == .done, let ended = job.endedAt else { return false }
            return calendar.isDate(ended, inSameDayAs: now)
        }.count
    }
}

/// Running agents first, then in start order (`sortAgents` in core/render-ascii.mjs uses the same rule),
/// so rows do not jump around while the agents work and both viewers open the same default row.
func agents(of item: JobItem) -> [Agent] {
    item.session.agents.values
        .filter { $0.job == item.job.seq }
        .sorted { a, b in
            let (ra, rb) = (a.status == .running, b.status == .running)
            if ra != rb { return ra }
            if a.startedAt != b.startedAt { return a.startedAt < b.startedAt }
            return a.id < b.id
        }
}

/// The step a collapsed agent row names: with a plan, its active milestone (else the next pending
/// one); without one, or with every step done, its `activity`. nil when there is nothing to name.
func agentCurrentStep(_ agent: Agent) -> String? {
    let m = agent.milestones.first { $0.status == .active } ?? agent.milestones.first { $0.status == .pending }
    if let m, !m.title.isEmpty { return m.title }
    return agent.activity.isEmpty ? nil : agent.activity
}

/// An agent's own progress: done / total of its own milestones (0/0 without a plan).
func agentProgress(_ agent: Agent) -> (done: Int, total: Int) {
    (agent.milestones.filter { $0.status == .done }.count, agent.milestones.count)
}

struct AgentStep: Equatable {
    enum State { case done, current, failed, neutral }
    let label: String
    let state: State
}

/// The steps an expanded agent row lists, oldest first. With a plan: its done milestones and the
/// active one (or, with none active, the next pending one). Without: its last 6 story steps.
func agentSteps(_ agent: Agent) -> [AgentStep] {
    let running = agent.status == .running
    if !agent.milestones.isEmpty {
        var shown = agent.milestones.filter { $0.status == .done || $0.status == .active }
        if !agent.milestones.contains(where: { $0.status == .active }),
           let next = agent.milestones.first(where: { $0.status != .done }) {
            shown = agent.milestones.filter { $0.status == .done || $0.key == next.key }
        }
        return shown.map { m in
            AgentStep(label: m.title, state: m.status == .done ? .done : m.status == .active && running ? .current : .neutral)
        }
    }
    return agent.steps.suffix(6).map { pill in
        let state: AgentStep.State = switch pill.kind {
        case .ok: .done
        case .warn: .failed
        case .active: running ? .current : .neutral
        case .info, .unknown: .neutral
        }
        return AgentStep(label: pill.label, state: state)
    }
}

func activeMilestoneKey(_ job: Job) -> String? {
    guard job.status != .done else { return nil }
    if let key = job.now?.milestone, job.milestones.contains(where: { $0.key == key }) { return key }
    return job.milestones.first { $0.status == .active }?.key
}

func menubarSummary(_ items: [JobItem], now: Date) -> (jobs: Int, agents: Int, avgPct: Int?, attention: Bool) {
    let live = items.filter { !isStale($0, now: now) }
    let agentCount = live.reduce(0) { $0 + 1 + agents(of: $1).filter { $0.status == .running }.count }
    let pcts = live.compactMap { progress($0.job).pct }
    let avg = pcts.isEmpty ? nil : Int((Double(pcts.reduce(0, +)) / Double(pcts.count)).rounded())
    return (live.count, agentCount, avg, live.contains { $0.job.status == .waiting })
}

/// Title, else prompt, else the project; a job a collector joined mid-session has no title or prompt.
func displayTitle(_ item: JobItem) -> String {
    for candidate in [item.job.title, item.job.prompt, item.session.project] where !candidate.isEmpty {
        return candidate
    }
    return String(localized: "Untitled job")
}
