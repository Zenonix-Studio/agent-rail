import SwiftUI

/// What the rail's colors mean: the five stages and the job and agent states.
struct LegendView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            section(String(localized: "Stages")) {
                ForEach(Stage.allCases, id: \.self) { stage in
                    LegendRow(title: L10n.stageName(stage), detail: L10n.stageMeaning(stage)) {
                        StageDot(stage: stage, size: 8)
                    }
                }
                LegendRow(title: String(localized: "Bordered step"),
                          detail: String(localized: "A finished plan step, in its stage color")) {
                    Capsule().strokeBorder(Theme.stage(.dev), lineWidth: 2).frame(width: 24, height: 10)
                }
            }
            section(String(localized: "States")) {
                LegendRow(title: L10n.notifyFailing, detail: String(localized: "Builds or tests failed 3 times in a row"), color: Theme.error)
                LegendRow(title: L10n.notifyWaiting, detail: String(localized: "Waiting for your answer or a permission"), color: Theme.waiting)
                LegendRow(title: String(localized: "quiet"), detail: String(localized: "An agent sent nothing for 5 min"), color: Theme.quiet)
                LegendRow(title: L10n.notifyDone, detail: String(localized: "Every step finished"), color: Theme.done)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func section(_ title: String, @ViewBuilder rows: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(verbatim: title.uppercased())
                .font(.system(size: 11, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(Theme.muted)
            rows()
        }
    }
}

private struct LegendRow<Marker: View>: View {
    let title: String
    let detail: String
    @ViewBuilder var marker: () -> Marker

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            marker().frame(width: 28, alignment: .leading).alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4 }
            Text(verbatim: title).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.text)
            Text(verbatim: detail).font(.system(size: 12)).foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private extension LegendRow where Marker == AnyView {
    /// A state shown as colored text: a dot in that color.
    init(title: String, detail: String, color: Color) {
        self.init(title: title, detail: detail) { AnyView(Circle().fill(color).frame(width: 8, height: 8)) }
    }
}

/// The last 50 finished jobs across sessions, newest first; tapping one opens its detail.
struct HistoryView: View {
    let store: SessionStore
    let agentExpansion: AgentExpansion
    @State private var expandedID: String?

    var body: some View {
        let items = recentJobs(store.sessions, closed: store.closed)
        if items.isEmpty {
            Text("No finished jobs yet")
                .font(.system(size: 12))
                .foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 28)
        } else {
            VStack(spacing: 8) {
                ForEach(items) { item in
                    if item.id == expandedID {
                        JobDetailView(item: item, now: store.now, agentExpansion: agentExpansion) { toggle(item.id) }
                    } else {
                        Button { toggle(item.id) } label: { HistoryRowView(item: item, now: store.now) }
                            .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func toggle(_ id: String) {
        withAnimation(.snappy(duration: 0.2)) { expandedID = expandedID == id ? nil : id }
    }
}

/// A finished job: title and when it ended, project · duration · tokens, and its closing summary.
private struct HistoryRowView: View {
    let item: JobItem
    let now: Date

    var body: some View {
        let job = item.job
        let ended = job.endedAt ?? job.updatedAt
        let tokens = jobTokens(item)
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                SourceTag(source: item.session.source)
                Text(verbatim: displayTitle(item))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                if job.status != .done {
                    Text("hidden").font(.system(size: 11)).foregroundStyle(Theme.muted).fixedSize()
                }
                Spacer(minLength: 4)
                Text(verbatim: ended.formatted(.relative(presentation: .named)))
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.muted)
                    .fixedSize()
            }
            Text(verbatim: [item.session.project, formatElapsed(from: job.startedAt, to: ended), tokens > 0 ? L10n.tokens(tokens) : nil]
                .compactMap { $0 }.joined(separator: " · "))
                .font(.system(size: 11))
                .foregroundStyle(Theme.muted)
                .lineLimit(1)
            if !job.progress.isEmpty {
                Text(verbatim: job.progress)
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.raised)
        .modifier(JobCard())
        .contentShape(Rectangle())
    }
}

/// Tokens since the weekly reset: by day and by the last jobs, read from every session file.
struct StatsView: View {
    let store: SessionStore

    var body: some View {
        let limit = WeeklyLimit.load(root: store.root)
        let stats = tokenStats(store.sessions, limit: limit, now: store.now)
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: L10n.tokens(stats.total))
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Theme.text)
                Text(verbatim: header(stats, limit))
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            section(String(localized: "By day")) {
                ForEach(stats.days, id: \.days) { row in
                    StatRow(title: row.days == 1 ? String(localized: "Last 1 day") : String(localized: "Last \(row.days) days"), tokens: row.tokens)
                }
            }
            section(String(localized: "By job")) {
                ForEach(stats.last, id: \.n) { row in
                    StatRow(title: row.count < row.n ? String(localized: "Last \(row.n) jobs (\(row.count))") : String(localized: "Last \(row.n) jobs"),
                            tokens: row.tokens)
                }
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func header(_ stats: TokenStats, _ limit: WeeklyLimit?) -> String {
        guard stats.fromReset, let reset = limit?.resetsAt else {
            return String(localized: "Last 7 days · \(stats.jobs) jobs (no weekly limit reading yet)")
        }
        let when = reset.formatted(.dateTime.weekday(.abbreviated).hour().minute())
        let used = limit?.percentUsed.map { " · " + String(localized: "\(Int($0.rounded()))% used") } ?? ""
        return String(localized: "Since the weekly reset · \(stats.jobs) jobs · resets \(when)") + used
    }

    private func section(_ title: String, @ViewBuilder rows: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(verbatim: title.uppercased())
                .font(.system(size: 11, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(Theme.muted)
            rows()
        }
    }
}

private struct StatRow: View {
    let title: String
    let tokens: Int

    var body: some View {
        HStack {
            Text(verbatim: title).font(.system(size: 12.5)).foregroundStyle(Theme.text)
            Spacer()
            Text(verbatim: L10n.tokens(tokens)).font(.system(size: 12.5, weight: .semibold).monospacedDigit()).foregroundStyle(Theme.text)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(Theme.raised)
        .modifier(JobCard())
    }
}
