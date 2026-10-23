import AppKit
import SwiftUI

/// The menu bar popover: header, one card per job (one expanded at a time), footer.
struct PopoverView: View {
    let store: SessionStore
    let agentExpansion: AgentExpansion
    /// The snapshot renders the list unscrolled, since `ImageRenderer` does not draw scroll view content.
    var scrollable = true

    /// `.automatic` expands the first job; an explicit choice survives reloads by matching `job.id`.
    enum Expansion: Equatable {
        case automatic, none, job(String)
    }

    @State private var expansion: Expansion
    /// The live jobs, the finished-jobs history, the token stats, or the color legend.
    enum Page { case jobs, history, stats, legend }
    @State private var page: Page = .jobs
    @AppStorage(JobNotifier.enabledKey) private var notificationsEnabled = true

    init(store: SessionStore, agentExpansion: AgentExpansion, scrollable: Bool = true, expandedJobID: String? = nil, page: Page = .jobs) {
        self.store = store
        self.agentExpansion = agentExpansion
        self.scrollable = scrollable
        _expansion = State(initialValue: expandedJobID.map(Expansion.job) ?? .automatic)
        _page = State(initialValue: page)
    }

    private static let width: CGFloat = 408
    private static let maxListHeight: CGFloat = 560

    var body: some View {
        let items = store.items
        VStack(alignment: .leading, spacing: 0) {
            if page == .jobs { header } else { pageHeader }
            if page == .jobs && items.isEmpty {
                emptyState
            } else if scrollable {
                ScrollView {
                    content(items)
                }
                .scrollBounceBehavior(.basedOnSize)
                .frame(maxHeight: Self.maxListHeight)
                .fixedSize(horizontal: false, vertical: true)
            } else {
                content(items)
            }
            footer
        }
        .padding(8)
        .frame(width: Self.width)
        .background(Theme.surface)
        .onChange(of: agentIDs, initial: true) { _, ids in agentExpansion.prune(keeping: ids) }
    }

    /// Counts what the cards show (stale included); the menu bar icon keeps its live counts.
    private var header: some View {
        let items = store.items
        let agentCount = items.reduce(0) { $0 + 1 + agents(of: $1).count }
        return HStack(alignment: .firstTextBaseline) {
            Text("Jobs")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.text)
            Spacer()
            Text(verbatim: "\(L10n.jobs(items.count)) · \(L10n.agents(agentCount))")
                .font(.system(size: 12))
                .foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, 8)
        .padding(.top, 6)
        .padding(.bottom, 10)
    }

    @ViewBuilder private func content(_ items: [JobItem]) -> some View {
        switch page {
        case .jobs: list(items)
        case .history: HistoryView(store: store, agentExpansion: agentExpansion)
        case .stats: StatsView(store: store)
        case .legend: LegendView()
        }
    }

    /// History and legend: a back button and the page's name.
    private var pageHeader: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Button { show(.jobs) } label: {
                Label("Jobs", systemImage: "chevron.left").font(.system(size: 12))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.muted)
            Text(page == .history ? String(localized: "History") : page == .stats ? String(localized: "Stats") : String(localized: "Colors"))
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.text)
            Spacer()
            if page == .history {
                Text("Last 50 jobs").font(.system(size: 12)).foregroundStyle(Theme.muted)
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 6)
        .padding(.bottom, 10)
    }

    private func show(_ next: Page) {
        withAnimation(.snappy(duration: 0.2)) { page = page == next ? .jobs : next }
    }

    private func hide(_ item: JobItem) {
        withAnimation(.snappy(duration: 0.2)) { store.closeJob(item) }
    }

    /// Under an expanded stale job: hide it, or stop its session for real.
    private func staleActions(_ item: JobItem) -> some View {
        let running = SessionProcess.isRunning(item.session.proc)
        return HStack(spacing: 8) {
            Button("Hide") { hide(item) }
                .help(String(localized: "Hide this job here; its session is not stopped"))
            Button("Stop session…") { confirmStop(item) }
                .disabled(!running)
                .help(running ? String(localized: "Ends the whole session and its agents") : String(localized: "Process not found (already closed?)"))
        }
        .controlSize(.small)
        .padding(.trailing, 4)
    }

    /// Stopping ends the session's process, so it asks first and says what is lost.
    private func confirmStop(_ item: JobItem) {
        guard let proc = item.session.proc else { return }
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = String(localized: "Stop this session?")
        alert.informativeText = String(localized: "\(displayTitle(item)): the whole \(L10n.sourceName(item.session.source)) session and its agents stop. Work it has not saved is lost.")
        alert.addButton(withTitle: String(localized: "Stop")).hasDestructiveAction = true
        alert.addButton(withTitle: String(localized: "Cancel"))
        NSApp.activate()
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        if SessionProcess.stop(proc) { hide(item) }
    }

    private func list(_ items: [JobItem]) -> some View {
        let expandedID = resolvedExpansion(items)
        return VStack(spacing: 8) {
            ForEach(items) { item in
                if item.id == expandedID {
                    VStack(alignment: .trailing, spacing: 6) {
                        JobDetailView(item: item, now: store.now, agentExpansion: agentExpansion) { toggle(item.id, current: expandedID) }
                        if isStale(item, now: store.now) { staleActions(item) }
                    }
                } else {
                    Button { toggle(item.id, current: expandedID) } label: {
                        JobRowView(item: item, now: store.now)
                    }
                    .buttonStyle(.plain)
                    .overlay(alignment: .trailing) {
                        // A stale job may never end on its own: hiding it here does not stop its session.
                        if isStale(item, now: store.now) {
                            Button { hide(item) } label: {
                                Text("Hide")
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundStyle(Theme.text)
                                    .padding(.horizontal, 9)
                                    .padding(.vertical, 3)
                                    .background(Theme.raised, in: Capsule())
                                    .overlay(Capsule().strokeBorder(Theme.line, lineWidth: 1))
                            }
                            .buttonStyle(.plain)
                            .help(String(localized: "Hide this job here; its session is not stopped"))
                            .padding(.trailing, 10)
                        }
                    }
                    .contextMenu {
                        if isStale(item, now: store.now) {
                            Button("Hide (the session is not stopped)") { hide(item) }
                            Button("Stop session…") { confirmStop(item) }
                                .disabled(!SessionProcess.isRunning(item.session.proc))
                        }
                    }
                }
            }
        }
    }

    private var agentIDs: Set<String> {
        Set(store.sessions.flatMap { $0.agents.keys })
    }

    private func resolvedExpansion(_ items: [JobItem]) -> String? {
        switch expansion {
        case .none: return nil
        case .job(let id) where items.contains(where: { $0.id == id }): return id
        // The chosen job is gone (finished or hidden): fall back to the first one.
        case .job, .automatic: return items.first?.id
        }
    }

    private func toggle(_ id: String, current: String?) {
        withAnimation(.snappy(duration: 0.2)) {
            expansion = current == id ? .none : .job(id)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 6) {
            Text("No agents running")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.text)
            Text("Install the Claude plugin or run scripts/install-codex.mjs")
                .font(.system(size: 11))
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
        .padding(.horizontal, 12)
    }

    private var footer: some View {
        HStack(spacing: 10) {
            // Looks like a button on purpose: as plain text it read as a label.
            Button { show(.history) } label: {
                HStack(spacing: 5) {
                    Image(systemName: "clock.arrow.circlepath")
                    Text("Done today: \(store.doneTodayCount)")
                    Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold))
                }
                .foregroundStyle(page == .history ? Theme.onAccent : Theme.text)
                .padding(.horizontal, 9)
                .padding(.vertical, 4)
                .background(page == .history ? Theme.accent : Theme.raised, in: Capsule())
                .overlay(Capsule().strokeBorder(page == .history ? Theme.accent : Theme.line, lineWidth: 1))
                .contentShape(Capsule())
                .fixedSize()
            }
            .help(String(localized: "History"))
            Button { show(.stats) } label: { Image(systemName: "chart.bar") }
                .foregroundStyle(page == .stats ? Theme.accent : Theme.muted)
                .help(String(localized: "Stats"))
                .accessibilityLabel(String(localized: "Stats"))
            Button { show(.legend) } label: { Image(systemName: "questionmark.circle") }
                .help(String(localized: "Colors"))
                .accessibilityLabel(String(localized: "Colors"))
            Spacer()
            Toggle(L10n.notifications, isOn: $notificationsEnabled)
                .toggleStyle(.checkbox)
                .fixedSize()
                .onChange(of: notificationsEnabled) { _, on in
                    if on { JobNotifier.requestAuthorization() }
                }
            // Icons, not words: with every label spelled out the row outgrew the popover in English.
            Button { NSWorkspace.shared.open(store.root) } label: { Image(systemName: "folder") }
                .help(String(localized: "Open folder"))
                .accessibilityLabel(String(localized: "Open folder"))
            Button { NSApplication.shared.terminate(nil) } label: { Image(systemName: "power") }
                .keyboardShortcut("q")
                .help(String(localized: "Quit"))
                .accessibilityLabel(String(localized: "Quit"))
        }
        .buttonStyle(.plain)
        .font(.system(size: 12))
        .foregroundStyle(Theme.muted)
        .padding(.horizontal, 8)
        .padding(.top, 8)
        .padding(.bottom, 4)
        .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 1) }
        .padding(.top, 4)
    }
}
