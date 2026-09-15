import type { Extension } from "@codemirror/state"
import { drawSelection, EditorView } from "@codemirror/view"

type SelectionPlatform = Pick<Navigator, "maxTouchPoints" | "platform" | "userAgent">

export function shouldDrawCodeMirrorSelection(platform: SelectionPlatform = navigator) {
  // iOS WKWebView 依赖系统原生选区手柄和输入法 caret；桌面与 Android 交给 CodeMirror 自绘，
  // 再配合 CSS 隐掉原生高亮，避免两套选区在 WebView 里叠成碎片。
  const iosDevice = /iPad|iPhone|iPod/i.test(platform.userAgent)
    || (/MacIntel/i.test(platform.platform) && platform.maxTouchPoints > 1)
  return !iosDevice
}

export function selectionRenderingExtensions(platform?: SelectionPlatform): Extension {
  const rendering = shouldDrawCodeMirrorSelection(platform) ? "drawn" : "native"
  return [
    EditorView.editorAttributes.of({ "data-selection-rendering": rendering }),
    rendering === "drawn" ? drawSelection({ drawRangeCursor: false }) : [],
  ]
}
