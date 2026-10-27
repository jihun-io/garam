import AppKit

// This is a separate, code-drawn Icon Composer layer; the approved river
// artwork is shared unchanged with the release icon.
guard CommandLine.arguments.count == 2,
      let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
        isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
      ), let context = NSGraphicsContext(bitmapImageRep: bitmap)
else { fatalError("Usage: swift scripts/dev-icon-badge.swift output.png") }

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
NSColor.clear.setFill()
NSRect(x: 0, y: 0, width: 1024, height: 1024).fill(using: .copy)
let rect = NSRect(x: 352, y: 142, width: 320, height: 120)
NSColor(srgbRed: 0.90, green: 0.86, blue: 1, alpha: 1).setFill()
NSBezierPath(roundedRect: rect, xRadius: 24, yRadius: 24).fill()
let label = "DEV" as NSString
let attributes: [NSAttributedString.Key: Any] = [
    .font: NSFont.monospacedSystemFont(ofSize: 80, weight: .heavy),
    .foregroundColor: NSColor(srgbRed: 0.16, green: 0.12, blue: 0.26, alpha: 1)
]
let size = label.size(withAttributes: attributes)
label.draw(at: NSPoint(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2),
           withAttributes: attributes)
context.flushGraphics()
NSGraphicsContext.restoreGraphicsState()
guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Failed to encode badge")
}
try png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
