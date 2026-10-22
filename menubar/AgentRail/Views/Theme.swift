import AppKit
import SwiftUI

/// Color and metric tokens from the approved mockups (menubar-v2 / desktop-v2), with light-mode equivalents.
enum Theme {
    // Dark values are the mockup tokens verbatim (muted slightly lifted); light values keep the hues
    // darkened so 10-11 pt text reaches 4.5:1 (WCAG AA) on the popover surface and on the now block.
    static let done = dynamic(light: 0x1F7A42, dark: 0x5CB87A)
    static let accent = dynamic(light: 0x9A4519, dark: 0xE08A5C)
    static let warn = dynamic(light: 0x7F5A0C, dark: 0xD6A64A)
    /// A job waiting for the user: a clear yellow, apart from the amber `warn` of failed steps.
    static let waiting = dynamic(light: 0x7A6A00, dark: 0xF2D541)
    /// A quiet agent: near-white (near-black in light mode), so it does not read as "needs you".
    static let quiet = dynamic(light: 0x3E3D38, dark: 0xF1F0EA)
    /// A failing job (status `error`); the same red as the fix stage.
    static let error = fix
    static let codex = dynamic(light: 0x3550C8, dark: 0x8FA8FF)
    static let muted = dynamic(light: 0x5E5D56, dark: 0xAAA99F)
    /// Text on an `accent` fill (the active pill): white on the dark terracotta, dark on the light one.
    static let onAccent = dynamic(light: 0xFFFFFF, dark: 0x1F1F1D)
    static let line = dynamic(light: 0xDAD9D2, dark: 0x3A3A35)
    static let text = dynamic(light: 0x1F1F1D, dark: 0xECEBE6)
    /// Popover background (`--pop`), also the fill inside pending rail nodes and pills.
    static let surface = dynamic(light: 0xF7F6F2, dark: 0x242422)
    /// Faint overlay for the expanded card header (`rgba(255,255,255,.04)` in dark).
    static let raised = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.isDark ? NSColor(white: 1, alpha: 0.045) : NSColor(white: 0, alpha: 0.035)
    })

    /// Faint fill behind an expanded agent row's steps (`rgba(255,255,255,.02)` in dark).
    static let inset = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.isDark ? NSColor(white: 1, alpha: 0.02) : NSColor(white: 0, alpha: 0.02)
    })

    /// `--now2`: the accent at 16% alpha (now block, active-node glow).
    static let accentSoft = accent.opacity(0.16)

    static let cardRadius: CGFloat = 10

    // Stage palette shared with the other viewers: plan violet, analyse blue, dev orange (the accent),
    // fix red, review teal. Light values are darkened for 4.5:1 text contrast, as above.
    private static let plan = dynamic(light: 0x6A3FB8, dark: 0xB49AF2)
    private static let analyse = dynamic(light: 0x2C5BB0, dark: 0x7FA8F0)
    private static let fix = dynamic(light: 0xB02A22, dark: 0xEC746C)
    private static let review = dynamic(light: 0x0E716C, dark: 0x4CC2B6)

    static func stage(_ stage: Stage) -> Color {
        switch stage {
        case .plan: plan
        case .analyse: analyse
        case .dev: accent
        case .fix: fix
        case .review: review
        }
    }

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            NSColor(hex: appearance.isDark ? dark : light)
        })
    }
}

private extension NSAppearance {
    var isDark: Bool { bestMatch(from: [.aqua, .darkAqua]) == .darkAqua }
}

private extension NSColor {
    convenience init(hex: UInt32) {
        self.init(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
                  green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255,
                  alpha: 1)
    }
}

/// The bordered group around one job (`.grp` in the mockup).
struct JobCard: ViewModifier {
    func body(content: Content) -> some View {
        content
            .clipShape(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
                .strokeBorder(Theme.line, lineWidth: 1))
    }
}

/// Minutes or hours-and-minutes, e.g. `4 min`, `1 h 12 min`.
func formatElapsed(from start: Date, to end: Date) -> String {
    formatDuration(end.timeIntervalSince(start))
}

/// A span as `formatElapsed` shows it; anything under a minute reads `1 min`.
func formatDuration(_ interval: TimeInterval) -> String {
    let minutes = max(1, Int(interval / 60))
    let (h, m) = (minutes / 60, minutes % 60)
    if h == 0 { return String(localized: "\(m) min") }
    if m == 0 { return String(localized: "\(h) h") }
    return String(localized: "\(h) h \(m) min")
}

/// A small round stage marker; nothing when the stage is unknown, so older files keep their look.
struct StageDot: View {
    let stage: Stage?
    var size: CGFloat = 6

    // A short bar rather than a dot: at dot size review (teal) and fix (red) were hard to tell apart.
    var body: some View {
        if let stage {
            Capsule()
                .fill(Theme.stage(stage))
                .frame(width: size * 3, height: size)
                .accessibilityLabel(L10n.stageName(stage))
        }
    }
}

/// Lays out children left to right and wraps onto new lines (the now block's pill flow).
struct FlowLayout: Layout {
    var spacing: CGFloat = 5
    var lineSpacing: CGFloat = 5

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let width = rows.map(\.width).max() ?? 0
        let height = rows.map(\.height).reduce(0, +) + lineSpacing * CGFloat(max(rows.count - 1, 0))
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y + (row.height - size.height) / 2),
                                      proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + lineSpacing
        }
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> [(indices: [Int], width: CGFloat, height: CGFloat)] {
        var rows: [(indices: [Int], width: CGFloat, height: CGFloat)] = []
        var current: (indices: [Int], width: CGFloat, height: CGFloat) = ([], 0, 0)
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let needed = current.indices.isEmpty ? size.width : current.width + spacing + size.width
            if needed > width, !current.indices.isEmpty {
                rows.append(current)
                current = ([index], size.width, size.height)
            } else {
                current = (current.indices + [index], needed, max(current.height, size.height))
            }
        }
        if !current.indices.isEmpty { rows.append(current) }
        return rows
    }
}
