import { useLayoutEffect, useRef, type RefObject } from "react"
import type { MarkdownEditorHandle } from "@/components/editor/markdown-editor"
import { noteReadingPositions, readingPositionKey, resolveReadingAnchor } from "@/services/navigation/note-reading-position"
import { registerSavePreparation } from "@/services/vault/save-lifecycle"

export function useNoteReadingPosition({ active, cacheId, content, editor, identity, noteId, onAnchor, ready, searchTarget, viewport }: {
  active: boolean
  cacheId: string | null
  content: string
  editor: RefObject<MarkdownEditorHandle | null>
  identity: string
  noteId: string
  onAnchor: (line: number) => void
  ready: boolean
  searchTarget: boolean
  viewport: RefObject<HTMLDivElement | null>
}) {
  const key = readingPositionKey(cacheId, noteId)
  const previous = useRef({ cacheId, identity, key })
  const latest = useRef({ content, key, onAnchor, ready, searchTarget })
  latest.current = { content, key, onAnchor, ready, searchTarget }
  useLayoutEffect(() => {
    const old = previous.current
    // 本机重命名沿用编辑会话，但持久化使用实际文件 ID，重启后不依赖临时会话标识。
    if (old.cacheId === cacheId && old.identity === identity && old.key !== key) {
      noteReadingPositions.move(old.key, key)
      noteReadingPositions.flush()
    }
    previous.current = { cacheId, identity, key }
  }, [cacheId, identity, key])

  useLayoutEffect(() => {
    const element = viewport.current
    if (!active || !ready || !element) return
    const saved = noteReadingPositions.get(key)
    const anchor = saved?.anchor ? resolveReadingAnchor(saved.anchor, latest.current.content) : null
    // 共用滚动容器切到从未读过的新笔记时从顶部开始，搜索命中和隐藏布局由各自流程处理。
    if (!saved && !latest.current.searchTarget && element.clientHeight > 0) element.scrollTop = 0
    let restoring = !!saved && !latest.current.searchTarget
    let frame = 0
    let timer = 0
    let attempts = 0
    let stableFrames = 0
    let lastTop = -1
    const remember = () => {
      // 隐藏布局、尚未挂载的编辑器和恢复途中的估算高度都不能把真实位置覆盖成 0。
      // React 切笔记时子编辑器可能已经换文档；旧 effect 清理只能落盘旧记录，不能读取新正文。
      if (restoring || element.clientHeight <= 0 || latest.current.key !== key || !latest.current.ready) return
      const current = editor.current?.readingAnchorAtViewportTop(element.getBoundingClientRect().top)
      if (!editor.current || (!current && element.scrollTop > 0)) return
      if (current) latest.current.onAnchor(current.line)
      noteReadingPositions.set(key, { anchor: element.scrollTop === 0 ? null : current ?? null, scrollTop: element.scrollTop })
    }
    const flush = () => {
      remember()
      window.clearTimeout(timer)
      timer = 0
      noteReadingPositions.flush()
    }
    const scheduleRemember = () => {
      if (restoring || element.clientHeight <= 0) return
      // 先保住即时位置，下一帧再按编辑器测量后的段落校准，快速返回也不会等丢一帧。
      remember()
      if (frame) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        frame = 0
        remember()
        window.clearTimeout(timer)
        timer = window.setTimeout(flush, 350)
      })
    }
    const stopRestore = () => {
      restoring = false
      window.cancelAnimationFrame(frame)
      frame = 0
    }
    const restore = () => {
      frame = 0
      if (!restoring) return
      if (latest.current.searchTarget) { stopRestore(); return }
      attempts += 1
      const visible = element.clientHeight > 0
      let applied = false
      if (visible && editor.current) {
        if (anchor) applied = editor.current.restoreReadingAnchor(anchor, element)
        else {
          element.scrollTop = Math.min(saved!.scrollTop, Math.max(0, element.scrollHeight - element.clientHeight))
          applied = true
        }
      }
      stableFrames = applied && Math.abs(element.scrollTop - lastTop) < 1 ? stableFrames + 1 : 0
      lastTop = element.scrollTop
      // CodeMirror 先按估算高度铺长文，再测量可见段落；连续校准到稳定，不抢读者的手动滚动。
      if ((applied && attempts >= 10 && stableFrames >= 4) || attempts >= 60) {
        stopRestore()
        if (applied) remember()
        return
      }
      frame = window.requestAnimationFrame(restore)
    }
    const visibility = () => { if (document.visibilityState === "hidden") flush() }
    element.addEventListener("scroll", scheduleRemember, { passive: true })
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) element.addEventListener(event, stopRestore, { passive: true })
    window.addEventListener("pagehide", flush)
    document.addEventListener("visibilitychange", visibility)
    // Mac 关闭窗口先走原生保存链路；阅读偏好写入失败由存储层吞掉，不阻止正文保存与关闭。
    const unregisterPreparation = registerSavePreparation(flush)
    if (restoring) frame = window.requestAnimationFrame(restore)
    return () => {
      flush()
      window.cancelAnimationFrame(frame)
      element.removeEventListener("scroll", scheduleRemember)
      for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) element.removeEventListener(event, stopRestore)
      window.removeEventListener("pagehide", flush)
      document.removeEventListener("visibilitychange", visibility)
      unregisterPreparation()
    }
  }, [active, key, ready, editor, viewport])
}
