import AppKit
import SwiftUI

enum DebugCommands {
    /// Handles debug flags and exits; returns false when no flag is present.
    /// `--dump` does a one-shot load. `--dump-after <seconds>` runs the live `SessionStore`
    /// (watcher, debounce, timer) on the main run loop for that long, then prints the same lines.
    @MainActor @discardableResult
    static func run(arguments: [String]) -> Bool {
        if let i = arguments.firstIndex(of: "--snapshot") {
            guard let out = arguments.dropFirst(i + 1).first else {
                FileHandle.standardError.write(Data("usage: --snapshot <out.png> [--expand <jobId>] [--expand-agent <agentId>]... [--light]\n".utf8))
                exit(2)
            }
            let expand = arguments.firstIndex(of: "--expand").flatMap { arguments.dropFirst($0 + 1).first }
            let openAgents = arguments.indices.filter { arguments[$0] == "--expand-agent" && $0 + 1 < arguments.count }.map { arguments[$0 + 1] }
            exit(snapshot(to: URL(fileURLWithPath: out), expandedJobID: expand, openAgents: openAgents,
                          light: arguments.contains("--light")) ? 0 : 1)
        }
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

    /// Renders the popover once (dark, or light with `--light`; 2x, 340 pt wide) from a store loaded from `StateRoot.url()`.
    @MainActor private static func snapshot(to url: URL, expandedJobID: String?, openAgents: [String], light: Bool) -> Bool {
        let store = SessionStore()
        let view = PopoverView(store: store, agentExpansion: AgentExpansion(open: openAgents), scrollable: false, expandedJobID: expandedJobID)
            .environment(\.colorScheme, light ? .light : .dark)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        renderer.isOpaque = true
        // Theme colors are dynamic NSColors, which resolve against the drawing appearance.
        var image: CGImage?
        NSAppearance(named: light ? .aqua : .darkAqua)!.performAsCurrentDrawingAppearance { image = renderer.cgImage }
        guard let image,
              let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
        else {
            FileHandle.standardError.write(Data("snapshot: render failed\n".utf8))
            return false
        }
        do {
            try png.write(to: url)
            print("wrote \(url.path) (\(image.width)x\(image.height))")
            return true
        } catch {
            FileHandle.standardError.write(Data("snapshot: \(error.localizedDescription)\n".utf8))
            return false
        }
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
