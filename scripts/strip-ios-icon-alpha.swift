import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

guard CommandLine.arguments.count == 2 else {
  fputs("用法：strip-ios-icon-alpha.swift <iOS 图标目录>\n", stderr)
  exit(1)
}

let fileManager = FileManager.default
let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let icons = try fileManager.contentsOfDirectory(
  at: directory,
  includingPropertiesForKeys: nil
).filter { $0.pathExtension.lowercased() == "png" }

for icon in icons {
  guard
    let source = CGImageSourceCreateWithURL(icon as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
    let context = CGContext(
      data: nil,
      width: image.width,
      height: image.height,
      bitsPerComponent: 8,
      bytesPerRow: image.width * 4,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
    )
  else {
    throw NSError(domain: "SwellNoteIcon", code: 1, userInfo: [
      NSLocalizedDescriptionKey: "无法读取或创建 RGB 图标：\(icon.lastPathComponent)",
    ])
  }

  // iOS App Icon 禁止透明通道；RGB 上下文会把已铺底图标无损转换为三通道 PNG。
  context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
  guard let rgbImage = context.makeImage() else {
    throw NSError(domain: "SwellNoteIcon", code: 2, userInfo: [
      NSLocalizedDescriptionKey: "无法生成 RGB 图标：\(icon.lastPathComponent)",
    ])
  }

  let temporary = directory.appendingPathComponent(".\(icon.lastPathComponent).tmp")
  guard let destination = CGImageDestinationCreateWithURL(
    temporary as CFURL,
    UTType.png.identifier as CFString,
    1,
    nil
  ) else {
    throw NSError(domain: "SwellNoteIcon", code: 3, userInfo: [
      NSLocalizedDescriptionKey: "无法创建 PNG 输出：\(icon.lastPathComponent)",
    ])
  }

  CGImageDestinationAddImage(destination, rgbImage, nil)
  guard CGImageDestinationFinalize(destination) else {
    throw NSError(domain: "SwellNoteIcon", code: 4, userInfo: [
      NSLocalizedDescriptionKey: "无法写入 PNG：\(icon.lastPathComponent)",
    ])
  }

  let data = try Data(contentsOf: temporary)
  try data.write(to: icon, options: .atomic)
  try fileManager.removeItem(at: temporary)
}

print("✓ 已移除 \(icons.count) 个 iOS 图标的 Alpha 通道")
