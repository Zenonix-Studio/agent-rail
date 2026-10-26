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
                ForEach(item.job.background.filter(\.running), id: \.id) { command in
                    BackgroundCommandView(label: command.label).padding(.bottom, 8)
                }
                let subagents = agents(of: item)
                if !subagents.isEmpty {
                    AgentsSectionView(agents: subagents, now: now, expansion: agentExpansion).padding(.top, 2)
                }
                if !item.job.progress.isEmpty {
                    JobProgressView(text: item.job.progress).padding(.top, 10)
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

/// A command the job left running in the background (a server, a long loop): why the job still runs.
private struct BackgroundCommandView: View {
    let label: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: "hourglass").foregroundStyle(Theme.muted).accessibilityHidden(true)
            Text(verbatim: L10n.inBackground(label))
                .foregroundStyle(Theme.muted)
                .lineLimit(1)
                .truncationMode(.tail)
                .help(label)
        }
        .font(.system(size: 11.5))
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The main agent's own summary of the work done and left, at the bottom of the job.
private struct JobProgressView: View {
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Text(verbatim: "»").foregroundStyle(Theme.muted).accessibilityHidden(true)
            Text(verbatim: text)
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(.system(size: 11.5))
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
