import SwiftUI

/// Vertical milestone rail (desktop-v2 card B). The now block sits under the active node.
struct RailView: View {
    let job: Job

    var body: some View {
        let activeKey = activeMilestoneKey(job)
        let pills = job.now?.pills ?? []
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(job.milestones.enumerated()), id: \.offset) { index, milestone in
                let isActive = milestone.key == activeKey
                RailRow(milestone: milestone,
                        isActive: isActive,
                        isLast: index == job.milestones.count - 1,
                        now: isActive ? job.now : nil)
            }
            // No milestone to anchor to (e.g. planning, or `now.milestone` is empty): show it under the rail.
            if activeKey == nil, job.status != .done, let now = job.now, !pills.isEmpty {
                NowBlockView(now: now)
                    .padding(.top, job.milestones.isEmpty ? 0 : 2)
                    .padding(.bottom, 11)
            }
        }
    }
}

private struct RailRow: View {
    let milestone: Milestone
    let isActive: Bool
    let isLast: Bool
    let now: Now?

    private static let node: CGFloat = 14
    private static let indent: CGFloat = 24
    private static let nodeTop: CGFloat = 1.5

    private var isDone: Bool { milestone.status == .done }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(verbatim: milestone.title)
                .accessibilityLabel(String(localized: "\(milestone.title), \(L10n.milestoneState(done: isDone, active: isActive))"))
                .font(.system(size: 12.5, weight: isActive ? .semibold : .regular))
                .foregroundStyle(isActive ? Theme.text : Theme.muted)
                .lineLimit(1)
                .truncationMode(.tail)
            if let now, !now.pills.isEmpty || now.attempt >= 2 || now.file != nil {
                NowBlockView(now: now).padding(.top, 6)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, Self.indent)
        .padding(.bottom, 11)
        .background(alignment: .topLeading) { connector }
        .overlay(alignment: .topLeading) { node.padding(.top, Self.nodeTop).accessibilityHidden(true) }
    }

    /// Runs from under this node to the top of the next one; green below a done node.
    @ViewBuilder private var connector: some View {
        if !isLast {
            Rectangle()
                .fill(isDone ? Theme.done : Theme.line)
                .frame(width: 2)
                .frame(maxHeight: .infinity)
                .padding(.top, Self.nodeTop + Self.node - 1)
                .padding(.bottom, -Self.nodeTop - 1)
                .padding(.leading, (Self.node - 2) / 2)
        }
    }

    @ViewBuilder private var node: some View {
        let size = Self.node
        if isDone {
            Circle().fill(Theme.done).frame(width: size, height: size)
        } else if isActive {
            Circle()
                .fill(Theme.surface)
                .overlay(Circle().strokeBorder(Theme.accent, lineWidth: 2))
                .frame(width: size, height: size)
                .background(Circle().fill(Theme.accentSoft).frame(width: size + 8, height: size + 8))
        } else {
            Circle()
                .fill(Theme.surface)
                .overlay(Circle().strokeBorder(Theme.line, lineWidth: 2))
                .frame(width: size, height: size)
        }
    }
}
