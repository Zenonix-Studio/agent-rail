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
                RailView(job: item.job, clock: now)
                let subagents = agents(of: item)
                if !subagents.isEmpty {
                    AgentsSectionView(agents: subagents, expansion: agentExpansion).padding(.top, 2)
                }
                if !item.job.milestones.isEmpty {
                    PlanDigestView(milestones: item.job.milestones).padding(.top, 10)
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

/// What is done and left of the plan, built from its milestones (not `Job.digest`) so it is localized:
/// "✓ Done: 2 more, C, D, E" and "○ Left: F, G, H +2", or "All steps done.".
private struct PlanDigestView: View {
    let milestones: [Milestone]

    private static let maxNames = 3

    var body: some View {
        let done = milestones.filter { $0.status == .done }.map(\.title)
        let left = milestones.filter { $0.status != .done }.map(\.title)
        VStack(alignment: .leading, spacing: 3) {
            if !done.isEmpty {
                line(mark: "✓", markColor: Theme.done, text: "\(String(localized: "Done:")) \(Self.doneNames(done))")
            }
            if left.isEmpty {
                line(mark: "○", markColor: Theme.muted, text: String(localized: "All steps done."))
            } else {
                line(mark: "○", markColor: Theme.muted, text: "\(String(localized: "Left:")) \(Self.leftNames(left))")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func line(mark: String, markColor: Color, text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Text(verbatim: mark).foregroundStyle(markColor).accessibilityHidden(true)
            Text(verbatim: text)
                .foregroundStyle(Theme.muted)
                .lineLimit(2)
                .truncationMode(.tail)
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(.system(size: 11.5))
    }

    /// The latest done titles, after "N more, " when some are left out.
    private static func doneNames(_ titles: [String]) -> String {
        let shown = titles.suffix(maxNames).joined(separator: ", ")
        let hidden = titles.count - maxNames
        return hidden > 0 ? String(localized: "\(hidden) more, ") + shown : shown
    }

    /// The next titles not done yet, then " +N" when some are left out.
    private static func leftNames(_ titles: [String]) -> String {
        let shown = titles.prefix(maxNames).joined(separator: ", ")
        let hidden = titles.count - maxNames
        return hidden > 0 ? "\(shown) +\(hidden)" : shown
    }
}
