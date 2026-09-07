import { useEffect, useRef, useState } from "react"
import { ClipboardPaste, Copy, Scissors, TextSelect } from "lucide-react"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import { readClipboardText, writeClipboardText } from "@/services/clipboard/clipboard-text"

type TextTarget = {
  input?: HTMLInputElement | HTMLTextAreaElement
  value: string
  from: number
  to: number
  range?: Range
  tableActions?: HTMLButtonElement[]
  wholeValue?: boolean
}

// 输入框可能位于 Dialog Portal 中，因此在 document 捕获阶段分发；正文 CodeMirror 由自己的菜单接管。
export function TextContextMenu() {
  const trigger = useRef<HTMLSpanElement>(null)
  const target = useRef<TextTarget | null>(null)
  const dismissedOutside = useRef(false)
  const [snapshot, setSnapshot] = useState<TextTarget | null>(null)
  const [hint, setHint] = useState("")
  const restore = () => {
    const saved = target.current
    if (saved?.input?.isConnected) {
      saved.input.focus({ preventScroll: true })
      if (saved.input.value === saved.value) {
        if (saved.wholeValue) saved.input.select()
        else saved.input.setSelectionRange(saved.from, saved.to)
      }
    } else if (saved?.range?.startContainer.isConnected) {
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(saved.range)
    }
  }
  useEffect(() => {
    let pressed: TextTarget | null = null
    const rememberSelection = (event: PointerEvent) => {
      pressed = null
      const input = event.target
      if (event.button !== 2 || !(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return
      if (input.selectionStart !== null && input.selectionStart !== input.selectionEnd) {
        pressed = { input, value: input.value, from: input.selectionStart, to: input.selectionEnd ?? input.selectionStart }
      }
    }
    const open = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null
      if (!element || element === trigger.current || element.closest('[role="menu"]')) return
      const input = element.closest("input, textarea")
      let next: TextTarget
      if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
        if (input.disabled) return
        if (input instanceof HTMLInputElement && !["text", "search", "url", "tel", "email", "password", "number"].includes(input.type)) return
        // 右键按下的浏览器默认行为可能先移动光标，优先保留按下前已有的文本选区。
        next = pressed?.input === input && pressed.value === input.value
          ? pressed : { input, value: input.value, from: input.selectionStart ?? 0, to: input.selectionEnd ?? input.value.length, wholeValue: input.selectionStart === null }
        pressed = null
        next.tableActions = Array.from(input.closest(".cm-md-table-wrap")?.querySelectorAll<HTMLButtonElement>("button[data-table-action]") ?? [])
      } else {
        // 行级菜单、编辑器和画布保留自身语义；普通阅读文字选区才提供复制。
        if (element.closest('[data-slot="context-menu-trigger"], .cm-editor, .excalidraw')) return
        const selection = window.getSelection()
        if (!selection || selection.isCollapsed || !selection.containsNode(element, true)) return
        next = { value: selection.toString(), from: 0, to: selection.toString().length, range: selection.getRangeAt(0).cloneRange() }
      }
      event.preventDefault()
      event.stopPropagation()
      if (target.current?.input) delete target.current.input.dataset.contextMenuActive
      target.current = next
      dismissedOutside.current = false
      if (next.input) next.input.dataset.contextMenuActive = "true"
      setSnapshot(next)
      trigger.current?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY, button: 2 }))
    }
    document.addEventListener("contextmenu", open, true)
    document.addEventListener("pointerdown", rememberSelection, true)
    return () => {
      document.removeEventListener("contextmenu", open, true)
      document.removeEventListener("pointerdown", rememberSelection, true)
      if (target.current?.input) delete target.current.input.dataset.contextMenuActive
    }
  }, [])
  useEffect(() => {
    if (!hint) return
    const timer = window.setTimeout(() => setHint(""), 3000)
    return () => window.clearTimeout(timer)
  }, [hint])

  const run = async (action: "copy" | "cut" | "paste" | "all") => {
    const saved = target.current
    if (!saved) return
    restore()
    if (action === "all") { saved.input?.select(); saved.from = 0; saved.to = saved.value.length; return }
    if (action !== "paste") {
      const text = saved.value.slice(saved.from, saved.to)
      // 密码只允许粘贴与全选，不通过自定义菜单导出内容。
      if (saved.input instanceof HTMLInputElement && saved.input.type === "password") return
      if (!await writeClipboardText(text)) { setHint("复制失败，请使用键盘快捷键"); return }
      if (action === "copy") return
    }
    const text = action === "paste" ? await readClipboardText() : ""
    if (text === null) { setHint("无法读取剪贴板，请使用 ⌘V / Ctrl+V 粘贴"); return }
    const input = saved.input
    // 剪贴板权限异步返回后，原控件或值变化就取消写入，防止切换笔记后误改新内容。
    if (!input?.isConnected || input.readOnly || input.disabled || input.value !== saved.value || target.current !== saved
      || (!saved.wholeValue && (input.selectionStart !== saved.from || input.selectionEnd !== saved.to))) return
    const value = saved.value.slice(0, saved.from) + text + saved.value.slice(saved.to)
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value)
    // email 等输入类型不开放选区 API，只提供明确的整值复制 / 替换，不能猜测光标位置。
    if (!saved.wholeValue) input.setSelectionRange(saved.from + text.length, saved.from + text.length)
    saved.value = value
    saved.from = saved.to = saved.from + text.length
    // 调原生 setter 后派发 input，React 受控输入和单元格自动增高都能收到真实变更。
    input.dispatchEvent(new Event("input", { bubbles: true }))
  }
  const writable = Boolean(snapshot?.input && !snapshot.input.readOnly && !snapshot.input.disabled)
  const selected = Boolean(snapshot && snapshot.to > snapshot.from && !(snapshot.input instanceof HTMLInputElement && snapshot.input.type === "password"))
  return <>
    <ContextMenu modal={false}>
      <ContextMenuTrigger ref={trigger} className="fixed size-0 pointer-events-none" aria-hidden />
      <ContextMenuContent onPointerDownOutside={() => { dismissedOutside.current = true }} onCloseAutoFocus={(event) => {
        event.preventDefault()
        if (!dismissedOutside.current) restore()
        const input = target.current?.input
        if (input) {
          delete input.dataset.contextMenuActive
          // 点到菜单外时让目标控件正常获得焦点，并补交菜单期间暂缓的单元格失焦保存。
          if (dismissedOutside.current && input.isConnected && document.activeElement !== input) input.dispatchEvent(new FocusEvent("blur"))
        }
      }}>
        <ContextMenuItem disabled={!selected} onSelect={() => void run("copy")}><Copy />{snapshot?.wholeValue ? "复制全部" : "复制"}</ContextMenuItem>
        <ContextMenuItem disabled={!selected || !writable} onSelect={() => void run("cut")}><Scissors />{snapshot?.wholeValue ? "剪切全部" : "剪切"}</ContextMenuItem>
        <ContextMenuItem disabled={!writable} onSelect={() => void run("paste")}><ClipboardPaste />{snapshot?.wholeValue ? "替换全部" : "粘贴"}</ContextMenuItem>
        <ContextMenuItem disabled={!snapshot?.input} onSelect={() => void run("all")}><TextSelect />全选</ContextMenuItem>
        {snapshot?.tableActions?.length ? <>
          <ContextMenuSeparator />
          <ContextMenuLabel>当前单元格所在行 / 列</ContextMenuLabel>
          {snapshot.tableActions.map((button) => <ContextMenuItem
            key={`${button.dataset.tableAction}-${button.dataset.tableAlign ?? ""}`}
            disabled={button.disabled}
            variant={button.dataset.tableAction?.startsWith("delete") ? "destructive" : "default"}
            onSelect={() => { if (button.isConnected && !button.disabled) button.click() }}
          >{button.textContent}</ContextMenuItem>)}
        </> : null}
      </ContextMenuContent>
    </ContextMenu>
    {hint ? <div role="status" className="fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 rounded-lg bg-popover px-4 py-2 text-sm shadow-lg">{hint}</div> : null}
  </>
}
