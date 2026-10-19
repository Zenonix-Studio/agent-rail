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

    init(store: SessionStore, agentExpansion: AgentExpansion, scrollable: Bool = true, expandedJobID: String? = nil) {
        self.store = store
        self.agentExpansion = agentExpansion
        self.scrollable = scrollable
        _expansion = State(initialValue: expandedJobID.map(Expansion.job) ?? .automatic)
    }

    private static let width: CGFloat = 340
    private static let maxListHeight: CGFloat = 560

    var body: some View {
        let items = store.items
        VStack(alignment: .leading, spacing: 0) {
            header
            if items.isEmpty {
                emptyState
            } else if scrollable {
                ScrollView {
                    list(items)
                }
                .scrollBounceBehavior(.basedOnSize)
                .frame(maxHeight: Self.maxListHeight)
                .fixedSize(horizontal: false, vertical: true)
            } else {
                list(items)
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

    private func list(_ items: [JobItem]) -> some View {
        let expandedID = resolvedExpansion(items)
        return VStack(spacing: 8) {
            ForEach(items) { item in
                if item.id == expandedID {
                    JobDetailView(item: item, now: store.now, agentExpansion: agentExpansion) { toggle(item.id, current: expandedID) }
                } else {
                    Button { toggle(item.id, current: expandedID) } label: {
                        JobRowView(item: item, now: store.now)
                    }
                    .buttonStyle(.plain)
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
        HStack(spacing: 14) {
            Text("Done today: \(store.doneTodayCount)")
            Spacer()
            Button("Open folder") { NSWorkspace.shared.open(store.root) }
            Button("Quit") { NSApplication.shared.terminate(nil) }
                .keyboardShortcut("q")
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
