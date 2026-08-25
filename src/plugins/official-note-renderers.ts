import { lazyWithRetry } from "@/lib/lazy-with-retry"
import { isExcalidrawMarkdown } from "@/services/markdown/markdown-preview-utils"
import type { OfficialNoteRendererPlugin } from "@/plugins/note-renderer"

// 官方能力统一经注册表分发。重型实现只能出现在动态 import 内，避免进入普通笔记的首屏依赖图。
const officialNoteRenderers: readonly OfficialNoteRendererPlugin[] = [
  {
    component: lazyWithRetry(() => import("@/plugins/excalidraw/excalidraw-preview")),
    id: "official.excalidraw",
    label: "Excalidraw",
    match: isExcalidrawMarkdown,
    official: true,
  },
]

export function resolveOfficialNoteRenderer(content: string) {
  return officialNoteRenderers.find((plugin) => plugin.match(content)) ?? null
}

export function getOfficialNoteRenderers() {
  return officialNoteRenderers
}
