import SwiftUI

/// An expanded job: header, summary, milestone rail with the now block, and its agents.
struct JobDetailView: View {
    let item: JobItem
    let now: Date
    var onHeaderTap: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            JobHeaderView(item: item, now: now, expanded: true)
                .background(Theme.raised)
                .onTapGesture(perform: onHeaderTap)
                .accessibilityAddTraits(.isButton)
            VStack(alignment: .leading, spacing: 0) {
                if !item.job.summary.isEmpty {
                    Text(verbatim: item.job.summary)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.bottom, 12)
                }
                RailView(job: item.job)
                let rows = agentRows
                if !rows.isEmpty {
                    AgentListView(rows: rows).padding(.top, 2)
                }
            }
            .padding(.top, 12)
            .padding(.leading, 14)
            .padding(.trailing, 10)
            .padding(.bottom, 8)
        }
        .opacity(isStale(item, now: now) ? 0.55 : 1)
        .modifier(JobCard())
    }

    /// The main agent leads, followed by subagents; omitted when the job has no subagents
    /// (the main agent's state is already the now block).
    private var agentRows: [AgentListView.Row] {
        let subagents = agents(of: item)
        guard !subagents.isEmpty else { return [] }
        let lead = AgentListView.Row(
            id: "main", name: String(localized: "Main agent"),
            activity: leadActivity, status: leadStatus, isLead: true)
        return [lead] + subagents.map {
            AgentListView.Row(id: $0.id, name: $0.name, activity: $0.activity, status: $0.status, isLead: false)
        }
    }

    private var leadActivity: String {
        let pills = item.job.now?.pills ?? []
        let label = (pills.last { $0.kind == .active } ?? pills.last)?.label
        if let label { return label }
        return item.job.status == .planning ? String(localized: "Planning") : "—"
    }

    private var leadStatus: AgentStatus {
        if isStale(item, now: now) { return .stale }
        switch item.job.status {
        case .running, .planning: return .running
        case .waiting, .error: return .error
        case .done: return .done
        case .unknown: return .unknown
        }
    }
}
