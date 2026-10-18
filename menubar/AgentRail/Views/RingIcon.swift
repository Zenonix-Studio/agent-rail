import AppKit

enum RingIcon {
    private static let accent = NSColor(srgbRed: 0xe0 / 255, green: 0x8a / 255, blue: 0x5c / 255, alpha: 1)

    /// 18x18 pt progress ring. `pct == nil` draws the track only. A template image unless `attention`.
    static func image(pct: Int?, attention: Bool) -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { rect in
            let lineWidth: CGFloat = 2.5
            let center = NSPoint(x: rect.midX, y: rect.midY)
            let radius = (min(rect.width, rect.height) - lineWidth) / 2

            let base: NSColor = attention ? .labelColor : .black
            base.withAlphaComponent(0.3).setStroke()
            let track = NSBezierPath()
            track.appendArc(withCenter: center, radius: radius, startAngle: 0, endAngle: 360)
            track.lineWidth = lineWidth
            track.stroke()

            if let pct, pct > 0 {
                (attention ? accent : NSColor.black).setStroke()
                let arc = NSBezierPath()
                let sweep = 360 * CGFloat(min(pct, 100)) / 100
                // Start at 12 o'clock, clockwise.
                arc.appendArc(withCenter: center, radius: radius, startAngle: 90, endAngle: 90 - sweep, clockwise: true)
                arc.lineWidth = lineWidth
                arc.lineCapStyle = .round
                arc.stroke()
            }
            return true
        }
        image.isTemplate = !attention
        return image
    }
}
