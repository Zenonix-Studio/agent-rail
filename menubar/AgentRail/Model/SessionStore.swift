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

    @ObservationIgnored private let sessionsDir: URL
    @ObservationIgnored private var cache: [String: (mtime: Date, session: Session?)] = [:]
    @ObservationIgnored private var watcher: (any DispatchSourceFileSystemObject)?
    @ObservationIgnored private var debounce: Task<Void, Never>?
    @ObservationIgnored private var timer: Timer?

    private static let maxAge: TimeInterval = 24 * 60 * 60
    private static let debounceDelay: Duration = .milliseconds(150)
    private static let tick: TimeInterval = 2

    init(root: URL = StateRoot.url()) {
        sessionsDir = root.appendingPathComponent("sessions", isDirectory: true)
        reload()
        openWatcher()
        let timer = Timer(timeInterval: Self.tick, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    // MARK: Timer

    private func tick() {
        now = Date()
        // The directory may not exist yet (no session has ever written); retry until it does.
        if watcher == nil, openWatcher() { reload() }
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

    private func reload() {
        let date = Date()
        let files = (try? FileManager.default.contentsOfDirectory(
            at: sessionsDir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        var fresh: [String: (mtime: Date, session: Session?)] = [:]
        var loaded: [(name: String, session: Session)] = []
        for url in files where url.pathExtension == "json" {
            guard let mtime = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate,
                  date.timeIntervalSince(mtime) <= Self.maxAge else { continue }
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
        sessions = loaded.sorted { $0.name < $1.name }.map(\.session)
        now = date
    }
}
