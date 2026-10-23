import SwiftUI

/// "Right now" block: the pill flow, the retry counter and the last touched file.
struct NowBlockView: View {
    let now: Now

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !now.pills.isEmpty {
                FlowLayout(spacing: 5, lineSpacing: 5) {
                    // Each arrow travels with the pill after it, so a line never ends on "→".
                    ForEach(Array(now.pills.enumerated()), id: \.offset) { index, pill in
                        HStack(spacing: 5) {
                            if index > 0 {
                                Text(verbatim: "→").font(.system(size: 11)).foregroundStyle(Theme.muted)
                            }
                            // The stage tag names the kind of work of the current (latest) step.
                            if index == now.pills.count - 1, let stage = now.stage {
                                StageTag(stage: stage)
                            }
                            PillView(pill: pill)
                        }
                    }
                }
            }
            if now.attempt >= 2 {
                Text("↻ attempt \(now.attempt)")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Theme.accent)
            }
            if let file = now.file, !file.isEmpty {
                Text(verbatim: Self.shortPath(file))
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
                    .help(file)
                    .truncationMode(.head)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    /// Last path component plus its parent folder: `Views/LoginView.swift`.
    static func shortPath(_ path: String) -> String {
        let parts = path.split(separator: "/", omittingEmptySubsequences: true)
        return parts.suffix(2).joined(separator: "/")
    }
}

/// Short stage name on a faint fill of its color: `dev`, `fix`.
private struct StageTag: View {
    let stage: Stage

    var body: some View {
        let color = Theme.stage(stage)
        Text(verbatim: L10n.stageName(stage))
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.14), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
            .fixedSize()
    }
}

private struct PillView: View {
    let pill: Pill

    var body: some View {
        let isActive = pill.kind == .active
        // With a stage, the active pill fills with its color and the others take it as their border.
        let tint = pill.stage.map(Theme.stage)
        Text(verbatim: pill.label)
            .font(.system(size: 11, weight: isActive ? .semibold : .regular))
            .foregroundStyle(foreground)
            .lineLimit(1)
            .help(pill.label)
            .truncationMode(.tail)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(isActive ? tint ?? Theme.accent : Theme.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(isActive ? tint ?? Theme.accent : tint ?? Theme.line, lineWidth: tint == nil ? 1 : 2))
    }

    private var foreground: Color {
        switch pill.kind {
        case .ok: Theme.done
        case .warn: Theme.warn
        case .active: Theme.onAccent
        case .info, .unknown: Theme.text
        }
    }
}
