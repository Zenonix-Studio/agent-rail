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

private struct PillView: View {
    let pill: Pill

    var body: some View {
        let isActive = pill.kind == .active
        Text(verbatim: pill.label)
            .font(.system(size: 11, weight: isActive ? .semibold : .regular))
            .foregroundStyle(foreground)
            .lineLimit(1)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(isActive ? Theme.accent : Theme.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(isActive ? Theme.accent : Theme.line, lineWidth: 1))
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
