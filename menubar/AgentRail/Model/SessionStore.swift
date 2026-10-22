import Foundation
import Observation

/// Live view of `<root>/sessions/*.json`. Read-only: never writes under the state root.
@MainActor @Observable
final class SessionStore {
    private(set) var sessions: [Session] = []
    var now: Date = Date()

    var items: [JobItem] { visibleJobs(sessions, now: now) }
    var summary: (jobs: Int, agents: Int, avgPct: Int?, attention: Bool) { menubarSummary(items, now: now) }
    var doneTodayCount: Int { doneToday(sessions, now: now) }

    /// The state root (`$AGENT_RAIL_HOME` or `~/.agent-rail`); the popover opens it in Finder.
    @ObservationIgnored let root: URL
    @ObservationIgnored private let sessionsDir: URL
    @ObservationIgnored private let worker: LoadWorker
    @ObservationIgnored private var signature: [String: Date]
    @ObservationIgnored private var loading = false
    @ObservationIgnored private var reloadPending = false
    @ObservationIgnored private var watcher: (any DispatchSourceFileSystemObject)?
    @ObservationIgnored private var debounce: Task<Void, Never>?
    @ObservationIgnored private var timer: Timer?
    @ObservationIgnored private var lastReload = Date()
    /// Last seen status per job id. Never pruned, so a file that briefly fails to decode mid-write
    /// does not make its jobs look new (and silent) when it comes back.
    @ObservationIgnored private var lastStatus: [String: JobStatus] = [:]
    /// The end time each done job was last seen or announced with.
    @ObservationIgnored private var doneEnd: [String: Date?] = [:]
    /// Called on the main actor for each job that moved to done, waiting or error since the last load.
    @ObservationIgnored var onTransition: ((JobTransition) -> Void)?

    private static let debounceDelay: Duration = .milliseconds(150)
    /// Elapsed time shows in minutes and staleness starts at 10 min, so `now` needs no finer tick.
    private static let tick: TimeInterval = 30
    /// Safety net for a missed watcher event and for files aging out of the 24 h window.
    private static let safetyReload: TimeInterval = 60

    init(root: URL = StateRoot.url()) {
        self.root = root
        sessionsDir = root.appendingPathComponent("sessions", isDirectory: true)
        // The first load is synchronous so the first frame (and `--dump-after`) has data.
        var loader = SessionLoader(directory: sessionsDir)
        sessions = loader.load(now: Date())
        signature = loader.signature
        worker = LoadWorker(loader: loader)
        // Seeds the status memory silently: jobs already done, waiting or failing at launch never notify.
        _ = recordTransitions(in: sessions)
        openWatcher()
        let timer = Timer(timeInterval: Self.tick, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    // MARK: Timer

    private func tick() {
        // The directory may not exist yet (no session has ever written); retry until it does.
        let reopened = watcher == nil && openWatcher()
        now = Date()
        if reopened || now.timeIntervalSince(lastReload) >= Self.safetyReload { reload() }
    }

    // MARK: Watcher

    @discardableResult
    private func openWatcher() -> Bool {
        closeWatcher()
        let fd = open(sessionsDir.path, O_EVTONLY)
        guard fd >= 0 else { return false }
        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd, eventMask: [.write, .rename, .delete], queue: .main)
        source.setEventHandler { [weak self, weak source] in
            let removed = source?.data.intersection([.delete, .rename]).isEmpty == false
            MainActor.assumeIsolated { self?.directoryChanged(removed: removed) }
        }
        source.setCancelHandler { close(fd) }
        watcher = source
        source.resume()
        return true
    }

    private func closeWatcher() {
        watcher?.cancel()
        watcher = nil
    }

    private func directoryChanged(removed: Bool) {
        // The directory itself was deleted or moved: drop the stale fd, the timer re-opens it.
        if removed, !FileManager.default.fileExists(atPath: sessionsDir.path) { closeWatcher() }
        scheduleReload()
    }

    private func scheduleReload() {
        debounce?.cancel()
        debounce = Task { [weak self] in
            try? await Task.sleep(for: Self.debounceDelay)
            guard !Task.isCancelled else { return }
            self?.reload()
        }
    }

    // MARK: Loading

    /// Scans on a background actor and publishes on the main actor; overlapping requests coalesce.
    private func reload() {
        guard !loading else { reloadPending = true; return }
        loading = true
        lastReload = Date()
        Task { [weak self, worker] in
            let date = Date()
            let result = await worker.load(now: date)
            self?.publish(result, at: date)
        }
    }

    private func publish(_ result: LoadResult, at date: Date) {
        loading = false
        // Assign only on a real change so observers (the menubar label) do not redraw for nothing.
        if result.signature != signature {
            signature = result.signature
            sessions = result.sessions
            now = date
            for transition in recordTransitions(in: result.sessions) { onTransition?(transition) }
        }
        if reloadPending {
            reloadPending = false
            reload()
        }
    }

    // MARK: Transitions

    /// Updates `lastStatus` and returns the jobs that moved into a notifiable status.
    /// A job seen for the first time only records its status.
    private func recordTransitions(in sessions: [Session]) -> [JobTransition] {
        var transitions: [JobTransition] = []
        for session in sessions {
            for job in session.jobs {
                let previous = lastStatus.updateValue(job.status, forKey: job.id)
                if previous == nil, job.status == .done { doneEnd[job.id] = job.endedAt }
                guard let previous, previous != job.status,
                      [.done, .waiting, .error].contains(job.status) else { continue }
                // A follow-up prompt reopens a done job until its plan shows it is a new job; the old job
                // then closes again with its old end time. One banner per finish.
                if job.status == .done {
                    if doneEnd[job.id] == job.endedAt { continue }
                    doneEnd[job.id] = job.endedAt
                }
                transitions.append(JobTransition(item: JobItem(session: session, job: job), from: previous))
            }
        }
        return transitions
    }
}

/// A job whose status changed between two loads; `item.job.status` is the new status.
struct JobTransition: Sendable {
    let item: JobItem
    let from: JobStatus
}

struct LoadResult: Sendable {
    let sessions: [Session]
    let signature: [String: Date]
}

/// Owns the loader and its decode cache; runs the directory scan off the main actor.
actor LoadWorker {
    private var loader: SessionLoader

    init(loader: SessionLoader) { self.loader = loader }

    func load(now: Date) -> LoadResult {
        let sessions = loader.load(now: now)
        return LoadResult(sessions: sessions, signature: loader.signature)
    }
}
