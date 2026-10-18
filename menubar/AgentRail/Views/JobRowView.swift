import SwiftUI

/// A collapsed job: one card with the header row, subtitle and progress bar.
struct JobRowView: View {
    let item: JobItem
    let now: Date

    var body: some View {
        let p = progress(item.job)
        JobHeaderView(item: item, now: now, expanded: false)
            .opacity(isStale(item, now: now) ? 0.55 : 1)
            .modifier(JobCard())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Self.accessibilityLabel(item: item, p: p, stale: isStale(item, now: now)))
    }

    /// "<source>, <title>, <done> of <total> milestones, <pct> percent, <status>"
    static func accessibilityLabel(item: JobItem, p: (done: Int, total: Int, pct: Int?), stale: Bool) -> String {
        let title = displayTitle(item)
        let milestones = String(localized: "\(p.done) of \(p.total) milestones")
        let percent = p.pct.map { String(localized: "\($0) percent") } ?? String(localized: "no progress yet")
        let status = stale ? String(localized: "no activity") : L10n.jobStatus(item.job.status)
        return [L10n.sourceName(item.session.source), title, milestones, percent, status].joined(separator: ", ")
    }
}

/// The header row shared by the collapsed row and the expanded detail.
struct JobHeaderView: View {
    let item: JobItem
    let now: Date
    let expanded: Bool

    var body: some View {
        let p = progress(item.job)
        HStack(spacing: 10) {
            SourceTag(source: item.session.source)
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: displayTitle(item))
                    .font(.system(size: 13, weight: expanded ? .semibold : .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Text(verbatim: expanded ? detailSubtitle : rowSubtitle(p))
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                // Status gets its own short line so the subtitle keeps its full content.
                if item.job.status == .waiting {
                    Text("● waiting for you")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Theme.warn)
                        .lineLimit(1)
                } else if expanded, let staleText {
                    Text(verbatim: staleText)
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
                if !expanded {
                    ProgressBar(fraction: p.pct.map { Double($0) / 100 } ?? 0)
                        .padding(.top, 4)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(verbatim: L10n.agents(1 + agents(of: item).count))
                .font(.system(size: 10))
                .foregroundStyle(Theme.muted)
                .padding(.horizontal, 7)
                .padding(.vertical, 1.5)
                .overlay(Capsule().strokeBorder(Theme.line, lineWidth: 1))
                .fixedSize()
            Text(verbatim: p.pct.map(L10n.percent) ?? "—")
                .font(.system(size: 12, weight: expanded ? .semibold : .regular).monospacedDigit())
                .foregroundStyle(expanded ? Theme.text : Theme.muted)
                .frame(minWidth: 30, alignment: .trailing)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 9)
        .contentShape(Rectangle())
    }

    private var staleText: String? {
        guard isStale(item, now: now) else { return nil }
        let minutes = Int(now.timeIntervalSince(item.session.updatedAt) / 60)
        return String(localized: "No activity for \(minutes) min")
    }

    private func rowSubtitle(_ p: (done: Int, total: Int, pct: Int?)) -> String {
        if let staleText { return staleText }
        guard p.total > 0 else { return String(localized: "Planning · 0/?") }
        // Name the milestone only when the rail marks one active, so the row and the rail agree.
        guard let key = activeMilestoneKey(item.job),
              let current = item.job.milestones.first(where: { $0.key == key })
        else { return "\(p.done)/\(p.total)" }
        return String(localized: "▸ \(current.title) · \(p.done)/\(p.total)")
    }

    private var detailSubtitle: String {
        String(localized: "\(item.session.project) · \(formatElapsed(from: item.job.startedAt, to: now))")
    }
}

private struct SourceTag: View {
    let source: Source

    var body: some View {
        let (label, color): (String, Color) = switch source {
        case .claude: ("CLAUDE", Theme.accent)
        case .codex: ("CODEX", Theme.codex)
        case .unknown: ("AGENT", Theme.muted)
        }
        Text(verbatim: label)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .frame(minWidth: 58)
            .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
            .fixedSize()
    }
}

private struct ProgressBar: View {
    let fraction: Double

    var body: some View {
        Capsule()
            .fill(Theme.line)
            .frame(height: 3)
            .overlay(alignment: .leading) {
                GeometryReader { geo in
                    Capsule().fill(Theme.done)
                        .frame(width: geo.size.width * min(max(fraction, 0), 1))
                }
            }
            .clipShape(Capsule())
    }
}
