import SwiftUI

/// One line per agent working on the job: status dot, name, latest activity.
struct AgentListView: View {
    struct Row: Identifiable {
        let id: String
        let name: String
        let activity: String
        let status: AgentStatus
        let isLead: Bool
    }

    let rows: [Row]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Agents in this job")
                .font(.system(size: 10, weight: .medium))
                .kerning(0.6)
                .textCase(.uppercase)
                .foregroundStyle(Theme.muted)
            VStack(alignment: .leading, spacing: 0) {
                ForEach(rows) { row in
                    AgentRow(row: row)
                }
            }
            .overlay(alignment: .leading) { Rectangle().fill(Theme.line).frame(width: 2) }
        }
    }
}

private struct AgentRow: View {
    let row: AgentListView.Row

    var body: some View {
        HStack(spacing: 8) {
            StatusDot(status: row.status)
            Text(verbatim: row.name)
                .foregroundStyle(row.isLead ? Theme.text : Theme.muted)
                .fontWeight(row.isLead ? .semibold : .regular)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(width: 86, alignment: .leading)
            Text(verbatim: row.activity)
                .foregroundStyle(Theme.text)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(row.name), \(row.activity), \(L10n.agentStatus(row.status))")
        .font(.system(size: 12))
        .padding(.leading, 12)
        .padding(.vertical, 5)
    }
}

private struct StatusDot: View {
    let status: AgentStatus
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let dot = Circle().fill(color).frame(width: 7, height: 7)
        if status == .running, !reduceMotion {
            dot.phaseAnimator([1.0, 0.3]) { view, opacity in
                view.opacity(opacity)
            } animation: { _ in .easeInOut(duration: 0.6) }
        } else {
            dot
        }
    }

    private var color: Color {
        switch status {
        case .running: Theme.accent
        case .done: Theme.done
        case .error: Theme.warn
        case .stale, .unknown: Theme.muted
        }
    }
}
