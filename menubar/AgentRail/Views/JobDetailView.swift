import SwiftUI

/// An expanded job: header, summary, the main agent's milestone rail with the now block, and one row per subagent.
struct JobDetailView: View {
    let item: JobItem
    let now: Date
    let agentExpansion: AgentExpansion
    var onHeaderTap: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: onHeaderTap) {
                JobHeaderView(item: item, now: now, expanded: true)
                    .background(Theme.raised)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(JobRowView.accessibilityLabel(
                        item: item, p: progress(item.job), stale: isStale(item, now: now)))
                    .accessibilityValue(Text("expanded"))
            }
            .buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 0) {
                if !item.job.summary.isEmpty {
                    Text(verbatim: item.job.summary)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.bottom, 12)
                }
                RailView(job: item.job)
                let subagents = agents(of: item)
                if !subagents.isEmpty {
                    AgentsSectionView(agents: subagents, expansion: agentExpansion).padding(.top, 2)
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
}
