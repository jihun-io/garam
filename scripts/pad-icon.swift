import AppKit

// Restore the standard 100px transparent margin around an 824px macOS tile.
// Icon Composer exports the tile itself, whereas legacy ICNS uses a 1024px canvas.
guard CommandLine.arguments.count == 3,
      let image = NSImage(contentsOfFile: CommandLine.arguments[1]),
      let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
        isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
      ), let context = NSGraphicsContext(bitmapImageRep: bitmap)
else { fatalError("Usage: swift scripts/pad-icon.swift input.png output.png") }

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
NSColor.clear.setFill()
NSRect(x: 0, y: 0, width: 1024, height: 1024).fill(using: .copy)
context.imageInterpolation = .high
image.draw(in: NSRect(x: 100, y: 100, width: 824, height: 824),
           from: .zero, operation: .copy, fraction: 1)
context.flushGraphics()
NSGraphicsContext.restoreGraphicsState()
guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Failed to encode icon")
}
try png.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
