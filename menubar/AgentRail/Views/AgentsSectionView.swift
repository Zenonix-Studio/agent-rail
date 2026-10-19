import Observation
import SwiftUI

/// Which agent rows are open, keyed by agent id. Lives for the app's lifetime, so a
/// choice survives reloads of the session files; an agent with no choice uses its default.
@MainActor @Observable
final class AgentExpansion {
    private var choices: [String: Bool]

    /// Agent ids to start expanded or collapsed (the snapshot's `--expand-agent` / `--collapse-agent`).
    init(open: [String] = [], closed: [String] = []) {
        choices = Dictionary(open.map { ($0, true) } + closed.map { ($0, false) }, uniquingKeysWith: { _, last in last })
    }

    func isExpanded(_ id: String, byDefault open: Bool) -> Bool { choices[id] ?? open }

    func toggle(_ id: String, byDefault open: Bool) {
        choices[id] = !isExpanded(id, byDefault: open)
    }

    /// Forgets choices for agents no session lists any more.
    func prune(keeping ids: Set<String>) {
        let kept = choices.filter { ids.contains($0.key) }
        if kept.count != choices.count { choices = kept }
    }
}

/// "Agents · N running": one bordered, expandable row per subagent of the job (agents-expand mockup).
struct AgentsSectionView: View {
    let agents: [Agent]
    let expansion: AgentExpansion

    private static let maxShown = 6
    private static let openAllMax = 3

    var body: some View {
        let running = agents.filter { $0.status == .running }.count
        // By default every agent's work is open when there are a few (the pane does the same);
        // with more, only the first running one.
        let firstRunning = agents.first { $0.status == .running }?.id
        let openAll = agents.count <= Self.openAllMax
        let shown = agents.prefix(Self.maxShown)
        VStack(alignment: .leading, spacing: 6) {
            Text(verbatim: L10n.agentsRunning(running))
                .font(.system(size: 10, weight: .medium))
                .kerning(0.7)
                .textCase(.uppercase)
                .foregroundStyle(Theme.muted)
                .accessibilityAddTraits(.isHeader)
            ForEach(shown, id: \.id) { agent in
                let open = openAll || agent.id == firstRunning
                AgentRowView(agent: agent, expanded: expansion.isExpanded(agent.id, byDefault: open)) {
                    withAnimation(.snappy(duration: 0.2)) { expansion.toggle(agent.id, byDefault: open) }
                }
            }
            if agents.count > shown.count {
                Text(verbatim: L10n.moreAgents(agents.count - shown.count))
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.muted)
                    .padding(.leading, 10)
            }
        }
    }
}

private struct AgentRowView: View {
    let agent: Agent
    let expanded: Bool
    let toggle: () -> Void

    var body: some View {
        let p = agentProgress(agent)
        VStack(alignment: .leading, spacing: 0) {
            Button(action: toggle) { header(p) }
                .buttonStyle(.plain)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(accessibilityLabel(p))
                .accessibilityValue(expanded ? Text("expanded") : Text("collapsed"))
            if expanded { detail }
        }
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(Theme.line, lineWidth: 1))
    }

    private func header(_ p: (done: Int, total: Int)) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "chevron.right")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(Theme.muted)
                .rotationEffect(.degrees(expanded ? 90 : 0))
                .frame(width: 10)
            AgentStatusDot(status: agent.status)
            // One line as in the mockup when name and step fit; else the step goes under the name,
            // so a long dispatch name never squeezes the current step to "Write…".
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    nameText.fixedSize()
                    stepText.fixedSize()
                }
                VStack(alignment: .leading, spacing: 1) {
                    nameText
                    stepText
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if p.total > 0 {
                MiniBar(fraction: Double(p.done) / Double(p.total))
                Text(verbatim: "\(p.done)/\(p.total)")
                    .font(.system(size: 11).monospacedDigit())
                    .foregroundStyle(Theme.muted)
                    .fixedSize()
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }

    private var nameText: some View {
        Text(verbatim: agent.name)
            .font(.system(size: 12.5, weight: .semibold))
            .foregroundStyle(Theme.text)
            .lineLimit(1)
            .truncationMode(.tail)
    }

    private var stepText: some View {
        Text(verbatim: currentStep)
            .font(.system(size: 12))
            .foregroundStyle(Theme.muted)
            .lineLimit(1)
            .truncationMode(.tail)
    }

    private var detail: some View {
        VStack(alignment: .leading, spacing: 8) {
            // The summary adds nothing when it only repeats the name (a dispatch with no prompt).
            if !agent.summary.isEmpty, agent.summary != agent.name {
                Text(verbatim: agent.summary)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            let steps = agentSteps(agent)
            if !steps.isEmpty { AgentStepList(steps: steps) }
        }
        .padding(.top, 8)
        .padding(.leading, 28)
        .padding(.trailing, 12)
        .padding(.bottom, 3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.inset)
        .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    private var currentStep: String {
        if let step = agentCurrentStep(agent) { return step }
        return agent.status == .running ? String(localized: "Starting…") : "—"
    }

    /// "<name>, <status>, <current step>, <n> of <m> steps"
    private func accessibilityLabel(_ p: (done: Int, total: Int)) -> String {
        var parts = [agent.name, L10n.agentStatus(agent.status), currentStep]
        if p.total > 0 { parts.append(String(localized: "\(p.done) of \(p.total) steps")) }
        return parts.joined(separator: ", ")
    }
}

/// The agent's own steps as a small vertical rail: done green, the current one ringed, a failed one in warn.
private struct AgentStepList: View {
    let steps: [AgentStep]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                AgentStepRow(step: step, isLast: index == steps.count - 1)
            }
        }
    }
}

private struct AgentStepRow: View {
    let step: AgentStep
    let isLast: Bool

    private static let node: CGFloat = 10
    private static let nodeTop: CGFloat = 3.5

    var body: some View {
        Text(verbatim: step.label)
            .font(.system(size: 12.5, weight: step.state == .current ? .semibold : .regular))
            .foregroundStyle(textColor)
            .lineLimit(2)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 18)
            .padding(.bottom, 7)
            .background(alignment: .topLeading) { connector }
            .overlay(alignment: .topLeading) { node.padding(.top, Self.nodeTop).accessibilityHidden(true) }
            .accessibilityLabel("\(step.label), \(stateName)")
    }

    private var textColor: Color {
        switch step.state {
        case .current: Theme.text
        case .failed: Theme.warn
        case .done, .neutral: Theme.muted
        }
    }

    private var stateName: String {
        switch step.state {
        case .done: String(localized: "done")
        case .current: String(localized: "active")
        case .failed: String(localized: "failed")
        case .neutral: String(localized: "pending")
        }
    }

    @ViewBuilder private var connector: some View {
        if !isLast {
            Rectangle()
                .fill(step.state == .done ? Theme.done : Theme.line)
                .frame(width: 1.5)
                .frame(maxHeight: .infinity)
                .padding(.top, Self.nodeTop + Self.node - 1)
                .padding(.bottom, -Self.nodeTop - 1)
                .padding(.leading, (Self.node - 1.5) / 2)
        }
    }

    @ViewBuilder private var node: some View {
        let size = Self.node
        switch step.state {
        case .done:
            Circle().fill(Theme.done).frame(width: size, height: size)
        case .failed:
            Circle().fill(Theme.warn).frame(width: size, height: size)
        case .current:
            Circle()
                .fill(Theme.surface)
                .overlay(Circle().strokeBorder(Theme.accent, lineWidth: 1.5))
                .frame(width: size, height: size)
                .background(Circle().fill(Theme.accentSoft).frame(width: size + 6, height: size + 6))
        case .neutral:
            Circle()
                .fill(Theme.surface)
                .overlay(Circle().strokeBorder(Theme.line, lineWidth: 1.5))
                .frame(width: size, height: size)
        }
    }
}

private struct MiniBar: View {
    let fraction: Double

    var body: some View {
        Capsule()
            .fill(Theme.line)
            .overlay(alignment: .leading) {
                GeometryReader { geo in
                    Capsule().fill(Theme.done).frame(width: geo.size.width * min(max(fraction, 0), 1))
                }
            }
            .clipShape(Capsule())
            .frame(width: 44, height: 4)
            .accessibilityHidden(true)
    }
}

/// Running = accent and pulsing, done = green, stale = muted, error = warn.
struct AgentStatusDot: View {
    let status: AgentStatus
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let dot = Circle().fill(color).frame(width: 8, height: 8)
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
