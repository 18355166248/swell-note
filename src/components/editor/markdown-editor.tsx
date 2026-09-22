import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { syntaxTree } from "@codemirror/language"
import { languages } from "@codemirror/language-data"
import { undoDepth, redoDepth } from "@codemirror/commands"
import { EditorSelection, type EditorState, type Extension, type SelectionRange } from "@codemirror/state"
import { Direction, EditorView, type DecorationSet, type ViewUpdate } from "@codemirror/view"

import { writeClipboardText } from "@/services/clipboard/clipboard-text"
import { collectClipboardFiles, readClipboardContent, readClipboardEvent, validateClipboardFiles } from "@/services/clipboard/clipboard-content"
import type { VaultAsset } from "@/services/vault/vault-adapter"

import { EditorControl } from "./core/editor-control"
import type { EditorExtensionContext } from "./core/create-editor"
import type { EditorSettings } from "./core/editor-types"
import { editorSessionStore, sessionFields } from "./editor-session"
import { bottomOverlayHeight, scrollCursorIntoView } from "./cursor-visibility"
import { applyLinkTarget, detectFormatState, focusExistingLinkUrl, linkInsertion, linkTargetAt, linkTargetInText, removeLinkTarget, type EditorFormatState, type EditorLinkTarget, type InlineMarkKind, markdownInputEnhancements, toggleBlockFormat, toggleInlineMark, wrapSelectionAsLink } from "./markdown-input"
import { createClipboardImageCoverage, htmlToMarkdown, isInlineMarkdownFragment, shouldInsertClipboardImageFiles } from "./html-to-markdown"
import { buildLivePreviewDecorationsForRanges, markdownLivePreviewBase, markdownTableEditing, type EditorLinkTap, type LivePreviewOptions } from "./live-preview"
import type { EmbeddedWikiNoteResult } from "./markdown-preview"
import { wikiLinkCompletion, type WikiLinkSuggestion } from "./wiki-link-completion"
import { ImageZoomOverlay } from "./image-zoom"
import { commitOpenRichEditors } from "./unified-rich-block"
import { activeTableEdit, type TableEditTarget } from "./table-edit-target"
import { selectionRenderingExtensions } from "./selection-rendering"
import "./markdown-table.css"

export { shouldDrawCodeMirrorSelection } from "./selection-rendering"

// 链接面板在表格单元格编辑中打开时的现场快照：保存前校验单元格内容未变，
// 取消时据此把焦点与选区还给单元格 textarea。
export type LinkCellSnapshot = {
  from: number
  target: TableEditTarget
  to: number
  value: string
}

export type MarkdownEditorHandle = {
  // 链接面板：target 为 null 表示新建（applyLink 用当前选区/光标），否则改写该链接；
  // cell 存在时写入单元格 textarea（面板期间单元格靠 contextMenuActive 标记保持挂载）。
  applyLink: (target: EditorLinkTarget | null, label: string, url: string, cell?: LinkCellSnapshot | null) => boolean
  // position 是文件拖入的落点（文档偏移）；省略时插入点为表格末尾或当前选区起点。
  // ownerSessionKey 是发起附件的那篇笔记：与本编辑器当前笔记不一致时返回 null。
  // 队列的执行是异步的（前面还排着别的批次），到执行时才读当前编辑器会捕获到用户此刻
  // 正在看的另一篇笔记，书签自身的身份校验也会因此通过，引用就写进了错误的笔记。
  captureInsertion: (position?: number, ownerSessionKey?: string) => { insert: (text: string) => boolean; dispose: () => void } | null
  collapseSelection: () => void
  copySelection: () => Promise<boolean>
  cutSelection: () => Promise<boolean>
  focus: () => void
  findText: (query: string, direction?: "next" | "previous", fromStart?: boolean) => MarkdownFindResult
  insertText: (text: string) => void
  // 与阅读态互换视图时用来对齐阅读位置：一个按屏幕坐标问行号，一个把指定行顶到可视区顶端。
  lineAtViewportTop: (clientY: number) => number | null
  pasteAtSelection: () => Promise<boolean>
  // 链接面板打开前的上下文：光标处已有链接、当前选中文本、编辑器是否持有焦点（取消后据此恢复）；
  // 正在编辑单元格时改从单元格 textarea 读取，并附上面板期间需要的现场快照。
  readLinkContext: () => { cell?: LinkCellSnapshot; hadFocus: boolean; selectedText: string; target: EditorLinkTarget | null } | null
  redo: () => void
  removeLink: (target: EditorLinkTarget, cell?: LinkCellSnapshot | null) => boolean
  replaceAll: (query: string, replacement: string) => number
  replaceCurrent: (query: string, replacement: string) => MarkdownFindResult
  // 链接面板取消时调用：焦点与选区还给仍挂载的单元格，返回 false 表示没有可恢复的单元格。
  restoreCellFocus: (cell?: LinkCellSnapshot | null) => boolean
  revealLine: (line: number) => void
  scrollLineToTop: (line: number) => boolean
  selectAll: () => void
  undo: () => void
}

export type MarkdownFindResult = {
  current: number
  total: number
}

// 工具栏「插入表格」按钮与 formatToolbarText 共用同一份模板字符串，
// 插入完成后靠它识别出这次插入的是表格，从而自动聚焦到第一个单元格。
export const TABLE_INSERT_TEMPLATE = "\n| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n"

// 一次装饰更新里可能同时挂着好几张表格的 wrapper，用起点行号才能挑出这次刚插入的那一张。
export function findTableWrapperAtLine(root: ParentNode, lineStart: number): HTMLElement | null {
  return Array.from(root.querySelectorAll<HTMLElement>(".cm-md-table-wrap"))
    .find((candidate) => Number(candidate.dataset.tableFrom) === lineStart) ?? null
}

// 新表格插入后光标停在整段 Markdown 之后，用户还得再点一次单元格才能改表头，
// 体验上比"插入即可编辑"的其它模板慢一拍。这里等表格 Widget 渲染完，
// 直接程序化点击第一个表头格，沿用单元格光标编辑路径。
function focusFirstTableHeaderCell(view: EditorView, insertFrom: number) {
  window.setTimeout(() => {
    const lineStart = view.state.doc.lineAt(Math.min(insertFrom, view.state.doc.length)).from
    const wrapper = findTableWrapperAtLine(view.contentDOM, lineStart)
    wrapper?.querySelector<HTMLElement>("th")?.click()
  }, 0)
}

// 链接面板写单元格：目标仍是当前活动单元格且内容没被改动过才落笔，
// 任一不满足都返回 false 让面板保留输入，而不是写到已过期的位置上。
function applyCellLink(view: EditorView, cell: LinkCellSnapshot, target: EditorLinkTarget | null, label: string, url: string): boolean {
  if (activeTableEdit(view) !== cell.target || cell.target.input.value !== cell.value) return false
  const inserted = linkInsertion(target, label, url)
  if (!inserted) return false
  delete cell.target.input.dataset.contextMenuActive
  cell.target.replace(target?.from ?? cell.from, target?.to ?? cell.to, inserted)
  return true
}

type MarkdownEditorProps = {
  sessionKey?: string
  onHistoryChange?: (undo: boolean, redo: boolean) => void
  onEditingTargetChange?: (table: boolean) => void
  compact?: boolean
  // 第二参数是本次变更的 ViewUpdate，与改造前 @uiw/react-codemirror 的签名一致。
  onChange: (value: string, update?: ViewUpdate) => void
  onCursorChange?: (line: number, column: number) => void
  // 光标 / 选区的格式状态（工具栏高亮）；表格单元格编辑时由单元格汇报行内格式。
  onFormatStateChange?: (state: EditorFormatState | null) => void
  onInsertFiles?: (files: File[], position?: number) => void
  onPasteError?: (message: string) => void
  // 移动端点按已有链接时不直接跳转，交给宿主弹出「打开 / 编辑 / 移除」菜单。
  onLinkMenu?: (tap: EditorLinkTap) => void
  onLoadWikiNote?: (target: string) => void
  onOpenWikiLink?: (target: string) => void
  onResolveAsset?: (source: string) => Promise<VaultAsset | null>
  onResolveWikiNote?: (target: string) => EmbeddedWikiNoteResult
  onSelectionChange?: (hasSelection: boolean) => void
  getWikiLinkSuggestions?: () => WikiLinkSuggestion[]
  /**
   * 正文源码模式。false（默认）= 即时预览，true = 纯 Markdown 源码。
   *
   * 只切换呈现层：走 startSourceMode 而不是直接改设置，因为切换前要把表格单元格 /
   * 公式块这类「局部草稿」显式落定，不能让它们在装饰被拆掉时静默消失。
   */
  sourceMode?: boolean
  readOnly?: boolean
  storageKey?: string
  /** 打开笔记时已知的远端修订号。异步附件回写前核对，避免写到已被同步改写的版本上。 */
  revision?: string
  value: string
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor({ sessionKey, revision, onHistoryChange, onEditingTargetChange, onFormatStateChange, onLinkMenu, onPasteError, compact = false, getWikiLinkSuggestions, onChange, onCursorChange, onInsertFiles, onLoadWikiNote, onOpenWikiLink, onResolveAsset, onResolveWikiNote, onSelectionChange, readOnly = false, sourceMode = false, storageKey, value }, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null)
    const controlRef = useRef<EditorControl | null>(null)
    const sessionKeyRef = useRef(sessionKey)
    sessionKeyRef.current = sessionKey
    // 上一次渲染看到的 sessionKey。判定「用户确实切走了」必须跟它比：
    // sessionKeyRef 在渲染期就已被赋成新值，拿它自比恒为真，会让每次同笔记回写都被当成切走。
    const previousSessionKeyRef = useRef(sessionKey)
    // 编辑器发出用户正文后，下一次同会话、同内容的 value 才是受控 echo。
    // 凭证只消费一次并绑定 sessionKey，避免另一篇笔记或历史版本恰好内容相同而误命中。
    const pendingEchoRef = useRef<{ doc: string; sessionKey: string } | null>(null)
    // 下面几个 ref 供 effect 与异步回调读取最新值：写进依赖会让每次渲染都重挂编辑器。
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange
    const onEditingTargetChangeRef = useRef(onEditingTargetChange)
    onEditingTargetChangeRef.current = onEditingTargetChange
    const storageKeyRef = useRef(storageKey)
    storageKeyRef.current = storageKey
    // 异步附件回写前核对：上传期间被同步合并过就不能按旧偏移落笔。
    const revisionRef = useRef(revision)
    revisionRef.current = revision
    const insertionMarks = useRef(new Set<{ anchor?: number; from: number; head?: number; to: number }>())
    // ⌘/Ctrl+⇧+V 按下后置位，交给紧随其后的 paste 事件消费；keyup 时仍未消费则主动读剪贴板。
    const plainPastePendingRef = useRef(false)
    const [theme, setTheme] = useState<"dark" | "light">(() => document.documentElement.classList.contains("dark") ? "dark" : "light")
    useEffect(() => {
      const observer = new MutationObserver(() => setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light"))
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
      return () => observer.disconnect()
    }, [])

    // 调用方传入的回调多为内联函数。它们只被扩展里的闭包读取，
    // 放进 ref 后 props 变化不会改变扩展引用，也就不会触发整体重配置。
    const handlers = useRef({ getWikiLinkSuggestions, onCursorChange, onFormatStateChange, onInsertFiles, onLinkMenu, onLoadWikiNote, onOpenWikiLink, onPasteError, onResolveAsset, onResolveWikiNote, onSelectionChange, onHistoryChange })
    useEffect(() => {
      handlers.current = { getWikiLinkSuggestions, onCursorChange, onFormatStateChange, onInsertFiles, onLinkMenu, onLoadWikiNote, onOpenWikiLink, onPasteError, onResolveAsset, onResolveWikiNote, onSelectionChange, onHistoryChange }
    })

    // 编辑器所在区域被卸载 / 隐藏时要撤回选区状态，
    // 否则切回来时选区操作条会带着上一次的选区状态出现。
    useEffect(() => () => handlers.current.onSelectionChange?.(false), [])

    // 键盘升起会把可视区压掉一半，此前落在下半屏的光标就藏到了键盘后面。
    // 布局要等 --keyboard-inset 写入后才是最终高度，所以推迟一帧再量。
    // 监听器只随 compact 变化增删一次，绝不在每次渲染时重复注册——
    // 重复注册的 resize 监听会让每次键盘升降叠加一次滚动补偿，手机上表现为页面不断下移。
    useEffect(() => {
      const viewport = window.visualViewport
      if (!compact || !viewport) return
      let frame = 0
      const follow = () => {
        frame = 0
        const control = controlRef.current
        if (control?.hasFocus()) scrollCursorIntoView(control.getView())
      }
      const schedule = () => {
        if (frame) return
        frame = requestAnimationFrame(follow)
      }
      viewport.addEventListener("resize", schedule)
      return () => {
        if (frame) cancelAnimationFrame(frame)
        viewport.removeEventListener("resize", schedule)
      }
    }, [compact])

    // 固定扩展：语言与选区渲染等不随设置变化的基座。
    // 每次挂载只算一次，EditorView 的整个生命周期里引用不变。
    const languageExtensions = useMemo<Extension>(() => [
      // GFM 基座：表格、删除线与任务列表才能进入语法树，供语法高亮与即时渲染装饰使用。
      // codeLanguages 让围栏代码块按 info 字符串套用对应语言的高亮，与阅读态保持一致；
      // 各语言由官方的 language-data 按需动态加载，不写代码块的笔记不会为此付出代价。
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      selectionRenderingExtensions(),
      EditorView.lineWrapping,
    ], [])

    // 平台扩展：桌面与移动的差异集中在链接点按与滚动跟随，随 compact 经 Compartment 重配置。
    const buildPlatformExtensions = useCallback(({ settings }: EditorExtensionContext): Extension => [
      EditorView.scrollHandler.of((view, range, options) => {
        const viewport = view.dom.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')
        if (!viewport) return false
        // 正文使用外层 ScrollArea，默认 CodeMirror 滚动无法定位屏外命中。
        // 行块位置在虚拟行尚未挂载时也可用；这里仅滚动，不在测量阶段 dispatch。
        const block = view.lineBlockAt(range.head)
        const top = view.documentTop + block.top
        const bottom = top + block.height
        const visible = viewport.getBoundingClientRect()
        // 手机上键盘之上有格式栏/选区条压底，固定边距会把文末行留在条子后面。
        const bottomMargin = settings.platform === "mobile" ? 24 + bottomOverlayHeight(view.dom) : 24
        let delta = 0
        if (options.y === "start") delta = top - visible.top - options.yMargin
        else if (options.y === "end") delta = bottom - visible.bottom + options.yMargin
        else if (options.y === "center") delta = (top + bottom - visible.top - visible.bottom) / 2
        else if (top < visible.top + 24) delta = top - visible.top - 24
        else if (bottom > visible.bottom - bottomMargin) delta = bottom - visible.bottom + bottomMargin
        if (delta) viewport.scrollTop += delta
        return true
      }),
    ], [])

    // 实时预览与表格编辑拆成两个 Compartment 的工厂：两者开关互不影响。
    // 选项里的回调全部经 handlers 中转，平台与只读一律从 settings 读——
    // 工厂因此不依赖任何易变的 props，平台切换只走 reconfigure，不重建 EditorView。
    //
    // 源码模式就是这两个开关同时关掉：正文装饰与表格网格一起消失，语法高亮与文本编辑
    // （两者都来自 languageExtensions 与 behaviorExtensions，不在这些 Compartment 里）
    // 原样保留。因此切换只是一次 reconfigure，不重建 EditorView、不动文档、不清撤销栈。
    const buildLivePreviewExtensions = useCallback(({ settings }: EditorExtensionContext): Extension => settings.livePreview
      ? markdownLivePreviewBase(livePreviewOptionsFor(settings, handlers, settings.platform))
      : [], [])

    const buildTableEditingExtensions = useCallback(({ settings }: EditorExtensionContext): Extension => settings.tableEditing
      ? markdownTableEditing()
      : [], [])

    // 行为扩展：输入增强、补全、剪贴板与滚动转发。
    // 这部分必须能访问 EditorControl 实例（事件外发、命令入口），因此由 control 反向注入。
    const buildBehaviorExtensions = useCallback((control: EditorControl): Extension => [
      // 列表 / 引用回车续写、结构行 Tab 缩进、选中文字敲 * ` ~ 即包裹。
      markdownInputEnhancements(),
      wikiLinkCompletion(() => handlers.current.getWikiLinkSuggestions?.() ?? []),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) for (const mark of insertionMarks.current) {
          mark.from = update.changes.mapPos(mark.from, 1)
          mark.to = Math.max(mark.from, update.changes.mapPos(mark.to, -1))
          // 「选区是否保持不动」的对照点随同一事务映射，用户在书签前输入不会误判成动过选区。
          if (mark.anchor !== undefined) mark.anchor = update.changes.mapPos(mark.anchor, 1)
          if (mark.head !== undefined) mark.head = update.changes.mapPos(mark.head, -1)
        }
        // 会话快照（撤销历史、选区、滚动）统一由 control 负责，事件外发也在其中判定文档身份。
        control.notifyViewUpdate(update)
        if (update.docChanged) handlers.current.onHistoryChange?.(undoDepth(update.state) > 0, redoDepth(update.state) > 0)
        if (!update.selectionSet && !update.docChanged) return
        const position = update.state.selection.main.head
        const line = update.state.doc.lineAt(position)
        handlers.current.onCursorChange?.(line.number, position - line.from + 1)
        handlers.current.onSelectionChange?.(!update.state.selection.main.empty)
        // 工具栏高亮跟随光标与选区；表格单元格编辑时由单元格自己的汇报接管。
        if (!activeTableEdit(update.view)) handlers.current.onFormatStateChange?.(detectFormatState(update.state))
        // 打字打到可视区边缘、或光标跳到远处时同样要跟过去，否则又落到键盘后面。
        if (control.getSettings().platform === "mobile" && update.view.hasFocus) scrollCursorIntoView(update.view)
      }),
      // 行右侧空白落到本行行尾（详见 blankLineEndAt）。用 mouseSelectionStyle 而不是
      // mousedown 处理器：它只替换落点计算，Shift 扩选与多选仍由 CodeMirror 原生驱动。
      EditorView.mouseSelectionStyle.of((view, event) => {
        // 双击选词、三击选段另有语义，不在这里改。
        if (event.detail > 1) return null
        const end = blankLineEndAt(view, event)
        if (end === null) return null
        let anchor = end
        return {
          get(curEvent) {
            // 没有真正拖动（含「已有选区时按下再抬起」这类 CodeMirror 会到 mouseup 才取落点的情况）：
            // 落点就是按下处那一行的行尾，不再重新做坐标映射，否则又会落回相邻行。
            const moved = Math.abs(curEvent.clientX - event.clientX) > 2
              || Math.abs(curEvent.clientY - event.clientY) > 2
            if (!moved) return EditorSelection.single(anchor)
            // 从空白处拖选：以按下处的行尾为锚点，另一端仍用 CodeMirror 的坐标映射，
            // 这样空白区起手也能正常拉出选区，不会把拖动整段钉死在行尾。
            const cur = view.posAndSideAtCoords({ x: curEvent.clientX, y: curEvent.clientY }, false)
            if (!cur || cur.pos === anchor) return EditorSelection.single(anchor)
            return EditorSelection.single(anchor, cur.pos)
          },
          update(update) {
            if (update.docChanged) anchor = update.changes.mapPos(anchor, -1)
          },
        }
      }),
      EditorView.domEventHandlers({
        copy(event, view) {
          if (isEditableFormControl(event.target)) return false
          if (!hasEditorClipboardContext(view)) return false
          const selected = selectedMarkdownRanges(view)
          if (selected.length === 0) return false
          if (!writeClipboardEventText(event, selected.map((range) => range.text).join("\n"))) return false
          event.preventDefault()
          return true
        },
        cut(event, view) {
          if (isEditableFormControl(event.target) || view.state.readOnly) return false
          if (!hasEditorClipboardContext(view)) return false
          const selected = selectedMarkdownRanges(view)
          if (selected.length === 0) return false
          // 原生 cut 只有先写入剪贴板才允许删除；写入失败时吞掉事件，避免默认路径删掉但没复制成功。
          if (!writeClipboardEventText(event, selected.map((range) => range.text).join("\n"))) {
            event.preventDefault()
            return true
          }
          event.preventDefault()
          view.dispatch({
            changes: selected.map((range) => ({ from: range.from, to: range.to })),
            selection: { anchor: selected[0].from },
            userEvent: "delete.cut",
          })
          return true
        },
        // CodeMirror 的选区不随失焦清空：点走标题输入框后选区高亮已经没了，
        // 选区操作条却会继续占着底部，所以焦点变化时同步汇报一次。
        blur() {
          handlers.current.onSelectionChange?.(false)
          return false
        },
        focus(_event, view) {
          handlers.current.onSelectionChange?.(!view.state.selection.main.empty)
          return false
        },
        // 正文以表格结尾时，点最后一块下方的空白本该在表格后面接着写，
        // 但紧邻表格的那一行会被 Markdown 并进表格，先补出空行再落光标。
        // 其余情况交给 CodeMirror 自己定位，拖选等原生行为保持不变。
        mousedown(event, view) {
          if (event.button !== 0 || event.shiftKey || event.target !== view.contentDOM) return false
          if (view.state.readOnly) return false
          const lastBlock = view.lineBlockAt(view.state.doc.length)
          if (event.clientY <= view.documentTop + lastBlock.bottom) return false
          const separator = paragraphSeparatorAtEnd(view.state)
          if (!separator) return false
          event.preventDefault()
          const end = view.state.doc.length
          view.dispatch({
            changes: { from: end, insert: separator },
            scrollIntoView: true,
            selection: { anchor: end + separator.length },
          })
          view.focus()
          return true
        },
        drop(event, view) {
          const onInsertFiles = handlers.current.onInsertFiles
          const files = collectClipboardFiles(event.dataTransfer)
          if (!onInsertFiles || control.getSettings().readOnly || files.length === 0) return false
          event.preventDefault()
          // 附件落在拖放指向的位置（与 CodeMirror dropCursor 的指示一致），不用旧光标。
          const position = view.posAtCoords({ x: event.clientX, y: event.clientY }, false)
          onInsertFiles(files, position ?? undefined)
          return true
        },
        paste(event, view) {
          const clipboard = readClipboardEvent(event.clipboardData)
          const text = clipboard.text
          // ⌘/Ctrl+⇧+V 的那一次粘贴：剪贴板里现成的 text/plain 就是结果，
          // 既不转 HTML，也不做链接包裹与附件插入，因此放在所有分支之前。
          if (plainPastePendingRef.current) {
            plainPastePendingRef.current = false
            // 输入框（如表格单元格）本来就只接受纯文本，交回原生即可。
            if (isEditableFormControl(event.target) || view.state.readOnly) return false
            event.preventDefault()
            if (!text) {
              handlers.current.onPasteError?.("剪贴板里没有纯文本内容")
              return true
            }
            const range = view.state.selection.main
            view.dispatch({
              changes: { from: range.from, to: range.to, insert: text },
              selection: { anchor: range.from + text.length },
              scrollIntoView: true,
              userEvent: "input.paste",
            })
            return true
          }
          // 代码范围中的粘贴必须保持字面内容：URL 不能包成链接，HTML 也不能转换成强调/列表。
          // 返回 false 交给 CodeMirror 原生粘贴，可保留一次撤销且不改动选区之外的文本。
          if (!control.getSettings().readOnly && shouldPasteAsPlainText(view.state)) return false
          // 选中文字时粘一个链接，直接包成 [选中文字](URL)。
          if (text && !control.getSettings().readOnly && wrapSelectionAsLink(view, text)) {
            event.preventDefault()
            return true
          }
          // 截图与图片文件的剪贴板不带纯文本；Excel 等来源同时带文本时仍按普通粘贴处理。
          const onInsertFiles = handlers.current.onInsertFiles
          const files = clipboard.files
          if (files.length > 0 && ((!text && !clipboard.html) || isImageClipboardWithIncidentalName(files, text, clipboard.html))) {
            if (!onInsertFiles || control.getSettings().readOnly) return false
            try { validateClipboardFiles(files) }
            catch (error) {
              event.preventDefault()
              handlers.current.onPasteError?.(error instanceof Error ? error.message : "剪贴板文件无法插入")
              return true
            }
            event.preventDefault()
            onInsertFiles(files)
            return true
          }
          // 网页/Office 的混合剪贴板继续进入 HTML 转 Markdown；其中附带的资源文件不是用户要插入的附件。
          // 富文本（网页 / Word / Excel）粘贴：HTML 转成 Markdown 后插入；
          // 转换失败或没有可用结构时返回 null，走原生纯文本粘贴，内容不丢。
          if (!control.getSettings().readOnly) {
            const html = clipboard.html
            // HTML 里带 <img>、同时又给了真实图片文件（Word / 飞书 / 浏览器复制富文本常见）：
            // 两条路都走会得到两张图，只走文件又会丢掉周围的文字与表格结构。
            // 因此 HTML 里的图片渲染成占位，真正的正文引用交给附件队列，一次粘贴只产生一份图片。
            // 覆盖判定必须逐图做（见 createClipboardImageCoverage）：剪贴板只给了一个文件却有两张
            // 导入不了的图时，只有那一张被补上，另一张得留住占位。
            const imagesCoveredByFiles = shouldInsertClipboardImageFiles(html, files)
            const imageFiles = imagesCoveredByFiles ? files.filter((file) => file.type.startsWith("image/")) : []
            const markdown = html ? htmlToMarkdown(html, { imageCoveredByFile: createClipboardImageCoverage(html, files) }) : null
            if (markdown || (imagesCoveredByFiles && imageFiles.length > 0)) {
              // 阻止默认粘贴必须与「文件是否入队」一起决定：HTML 只剩图片节点时转换结果可能为
              // null，此时若提前 return false，文件不会入队、默认粘贴也照常发生，图片和占位一起消失。
              event.preventDefault()
              if (!markdown) {
                // 转换没有产出文字，只剩要交给附件队列的图片文件。
                if (handlers.current.onInsertFiles) handlers.current.onInsertFiles(imageFiles)
                return true
              }
              const range = view.state.selection.main
              // 行内片段（单个加粗词、链接等）原位插入，不拆当前段落。
              // 块级结构（标题/列表/表格等）必须落在独立行上：插入点两侧不在行边界时补空行，
              // 否则表格尾行会和后面的文字粘成一行，被表格语法吞掉（内容看似丢失）。
              if (isInlineMarkdownFragment(markdown)) {
                view.dispatch({
                  changes: { from: range.from, to: range.to, insert: markdown },
                  selection: { anchor: range.from + markdown.length },
                  scrollIntoView: true,
                  userEvent: "input.paste",
                })
              } else {
                const doc = view.state.doc
                const prevChar = range.from > 0 ? doc.sliceString(range.from - 1, range.from) : "\n"
                const prevPrevChar = range.from > 1 ? doc.sliceString(range.from - 2, range.from - 1) : "\n"
                const nextChar = range.to < doc.length ? doc.sliceString(range.to, range.to + 1) : "\n"
                const nextNextChar = range.to + 1 < doc.length ? doc.sliceString(range.to + 1, range.to + 2) : "\n"
                const prefix = prevChar === "\n" ? (prevPrevChar === "\n" ? "" : "\n") : "\n\n"
                const suffix = nextChar === "\n" ? (nextNextChar === "\n" ? "" : "\n") : "\n\n"
                const insert = prefix + markdown + suffix
                view.dispatch({
                  changes: { from: range.from, to: range.to, insert },
                  // 光标落在插入内容之后（含补的空行），后续输入不会粘进表格/标题行。
                  selection: { anchor: range.from + insert.length },
                  scrollIntoView: true,
                  userEvent: "input.paste",
                })
              }
              // 占位已在正文里，图片本体随后由附件队列写入并追加在占位之后。
              // 队列是异步的，这里只负责把这一批交给宿主，不等待结果、不改动已插入的正文。
              if (imagesCoveredByFiles && handlers.current.onInsertFiles) handlers.current.onInsertFiles(imageFiles)
              return true
            }
          }
          // macOS WebView 的 paste 事件可能完全不暴露图片；仅在事件确实为空时才显式读原生剪贴板，
          // 普通文字粘贴不会触发权限调用。异步结果会在落笔前核验原文、选区和编辑器实例。
          if (!control.getSettings().readOnly && !text && !clipboard.html && handlers.current.onInsertFiles) {
            event.preventDefault()
            const onInsertFiles = handlers.current.onInsertFiles
            const pasteSessionKey = sessionKeyRef.current
            const pasteState = view.state
            void pasteClipboardAtSnapshot(
              view,
              onInsertFiles,
              handlers.current.onPasteError,
              () => controlRef.current === control
                && sessionKeyRef.current === pasteSessionKey
                && handlers.current.onInsertFiles === onInsertFiles
                && view.dom.isConnected
                && !view.state.readOnly
                && view.state.doc === pasteState.doc
                && view.state.selection.eq(pasteState.selection),
            )
            return true
          }
          return false
        },
        // ⌘/Ctrl+⇧+V 在本机 Chrome 上不派发 paste 事件（macOS 的「粘贴并匹配样式」是
        // ⌥⇧⌘V，⌘⇧V 根本不是粘贴命令），只设标记会让快捷键彻底失效。paste 事件总在
        // keyup 之前到达，所以 keyup 时标记仍在，就说明这次没有 paste 可取，改为主动读
        // 剪贴板。这条路径需要权限，但此时它是唯一出路。
        keyup(event, view) {
          if (!plainPastePendingRef.current) return false
          if (event.key.toLocaleLowerCase() !== "v") return false
          plainPastePendingRef.current = false
          if (view.state.readOnly) return false
          void pastePlainTextAtSnapshot(view, (message) => handlers.current.onPasteError?.(message), () => controlRef.current === control && view.dom.isConnected)
          return false
        },
        keydown(event, view) {
          // 标记只服务于紧随 ⌘⇧V 的那一次粘贴，任何新按键都说明那一趟已经结束。
          // 必须放在最前面（含无修饰键的按键）：否则标记会一直挂着，被后来的普通粘贴误消费。
          plainPastePendingRef.current = false
          if (event.isComposing || !(event.metaKey || event.ctrlKey)) return false
          const key = event.key.toLocaleLowerCase()
          // ⌘/Ctrl+⇧+V：粘贴为纯文本。网页/Office 的富文本剪贴板默认会被转成 Markdown，
          // 想原样保留一段带 * 或列表符号的文字时没有别的入口。macOS 的「粘贴并匹配样式」
          // ⌥⇧⌘V 语义相同，一并接管。
          //
          // 这里刻意不 preventDefault：实测在本机 Chrome 上拦掉按键后 paste 事件根本不会
          // 派发，剪贴板里现成的 text/plain 就白白浪费，还得额外申请读取权限。改为只留一个
          // 一次性标记，由下面的 paste 处理器取用 event.clipboardData；没有 paste 事件的
          // 平台（macOS 的 ⌘⇧V 不是粘贴命令）由 keyup 兜底主动读取。
          // 判断放在 altKey 之前：⌥⇧⌘V 是 macOS 原生的同义快捷键。其余组合键仍要求无 alt。
          if (key === "v" && event.shiftKey) {
            if (view.state.readOnly) return false
            plainPastePendingRef.current = true
            return false
          }
          if (event.altKey) return false
          if (key === "s") {
            // 文档变化已实时进入本地工作副本；拦截浏览器“保存网页”即可避免误操作。
            event.preventDefault()
            return true
          }
          if (view.state.readOnly) return false
          if (key === "k" && !event.shiftKey) {
            event.preventDefault()
            // 光标没有选区、正落在已有链接文字里时改地址，而不是在原文字中间插一段新链接。
            if (focusExistingLinkUrl(view)) return true
            // 选中文字则作为链接文案，否则用占位文案；两种情况都把 https:// 选中，方便直接粘地址。
            const range = view.state.selection.main
            const label = view.state.sliceDoc(range.from, range.to) || "链接文字"
            const inserted = `[${label}](https://)`
            const urlFrom = range.from + label.length + 3
            view.dispatch({
              changes: { from: range.from, to: range.to, insert: inserted },
              selection: { anchor: urlFrom, head: urlFrom + 8 },
              scrollIntoView: true,
            })
            view.focus()
            return true
          }
          if (key !== "b" && key !== "i") return false
          event.preventDefault()
          return toggleInlineMark(view, key === "b" ? "strong" : "emphasis", key === "b" ? "加粗文字" : "斜体文字")
        },
      }),
    ], [])

    // 唯一一次创建 EditorView。此后只读、主题、平台与预览开关都走 reconfigure，
    // 切换笔记走 updateDocument——视图实例在组件挂载期间保持不变。
    //
    // 依赖刻意留空：初始值经 ref 读取，后续的正文与设置变化由各自的 effect 推进视图。
    // 若把 value 放进依赖，React 会在正文变化的每次渲染上重建编辑器，正是要消除的行为。
    const initialRef = useRef({ sessionKey, revision, value, readOnly, compact, storageKey, settings: null as EditorSettings | null })
    initialRef.current.settings = {
      assetScope: storageKey,
      livePreview: !sourceMode,
      placeholder: "开始记录你的想法…",
      platform: compact ? "mobile" : "desktop",
      readOnly,
      tableEditing: !sourceMode,
      theme,
    }
    useEffect(() => {
      const host = hostRef.current
      if (!host) return
      const initial = initialRef.current
      const control = new EditorControl({
        buildBehaviorExtensions,
        doc: initial.value,
        identity: { noteId: initial.storageKey ?? "note", revision: initial.revision, sessionKey: initial.sessionKey ?? "" },
        languageExtensions,
        livePreviewExtensions: buildLivePreviewExtensions,
        parent: host,
        platformExtensions: buildPlatformExtensions,
        sessionFields,
        sessionStore: editorSessionStore,
        settings: initial.settings!,
        tableEditingExtensions: buildTableEditingExtensions,
      })
      controlRef.current = control
      // 选区、历史与光标位置统一由事件驱动：宿主不再需要在每次渲染里比对编辑器状态。
      const disposers = [
        control.on("selectionChange", (event) => {
          if (controlRef.current !== control) return
          handlers.current.onSelectionChange?.(event.hasSelection)
        }),
        control.on("documentChange", (event) => {
          if (controlRef.current !== control) return
          if (event.external) return
          // 必须在调用宿主前登记：即使宿主同步刷新受控 value，也能识别这次回传。
          pendingEchoRef.current = { doc: event.doc, sessionKey: event.identity.sessionKey }
          // 第二参数沿用 @uiw/react-codemirror 的 onChange(value, viewUpdate) 签名。
          onChangeRef.current(event.doc, event.update)
        }),
        // 切换会话走 setState，绕过 updateListener：这里补发一次历史/光标/格式/选区，
        // 让撤销按钮、行号与格式高亮在切换后立即落到目标笔记，不等下一次用户输入。
        control.on("sessionChange", () => {
          if (controlRef.current !== control) return
          const view = control.getView()
          const state = view.state
          handlers.current.onHistoryChange?.(undoDepth(state) > 0, redoDepth(state) > 0)
          handlers.current.onSelectionChange?.(!state.selection.main.empty)
          onEditingTargetChangeRef.current?.(false)
          const selection = state.selection.main
          const line = state.doc.lineAt(selection.head)
          handlers.current.onCursorChange?.(line.number, selection.head - line.from + 1)
          handlers.current.onFormatStateChange?.(detectFormatState(state))
        }),
        control.on("focusChange", (event) => {
          if (controlRef.current !== control || event.focused) return
          onEditingTargetChangeRef.current?.(Boolean(activeTableEdit(control.getView())))
        }),
      ]
      // 初次挂载也要把历史按钮状态摆正，此时还没有任何事务可监听。
      handlers.current.onHistoryChange?.(undoDepth(control.getState()) > 0, redoDepth(control.getState()) > 0)
      return () => {
        for (const dispose of disposers) dispose()
        controlRef.current = null
        control.destroy()
      }
    }, [buildBehaviorExtensions, buildLivePreviewExtensions, buildPlatformExtensions, buildTableEditingExtensions, languageExtensions])

    // 正文与身份变化：切换笔记在这里变成一次受控事务，不再经 React key 重建组件。
    //
    // 用 useLayoutEffect 而非 useEffect：普通 effect 在浏览器绘制之后才跑，React 提交新笔记的
    // UI 后、effect 更新 EditorView 前，浏览器可能先绘制一次旧正文，用户会看到旧笔记闪现。
    // layout effect 在 DOM 变更后、浏览器绘制前同步执行，正文切换因此落在同一帧内。
    const switching = previousSessionKeyRef.current !== sessionKey
    useLayoutEffect(() => {
      const control = controlRef.current
      if (!control) return
      const currentSessionKey = sessionKey ?? ""
      const pendingEcho = pendingEchoRef.current
      const echo = !switching
        && pendingEcho?.sessionKey === currentSessionKey
        && pendingEcho.doc === value
      control.updateDocument(value, {
        noteId: storageKey ?? "note",
        revision,
        sessionKey: currentSessionKey,
      }, {
        // 用户已经明确切走（本次的 sessionKey 与上次渲染不同）：组合态不能拦住新笔记的正文。
        // 同一篇笔记的外部回写不置位，由 control 挂起到 compositionend，不打断正在拼的中文。
        forceSwitch: switching,
        // 区分「切换」与「受控回写」。切换瞬间 value 可能还是上一篇（尚未就绪），
        // 必须按切换路径落空占位，不能当成旧正文的外部回写；同笔记只有命中一次性凭证
        // 才是 echo，其余均为 external（远端合并 / 版本恢复 / 重新加载）。
        origin: switching ? "switch" : echo ? "echo" : "external",
        settings: {
          assetScope: storageKey,
          platform: compact ? "mobile" : "desktop",
          readOnly,
        },
      })
      // echo 只允许消费一次；切换或外部正文同样会使旧凭证失效，不能跨会话/版本复用。
      pendingEchoRef.current = null
    }, [compact, readOnly, revision, sessionKey, storageKey, switching, value])
    // 同步上次渲染的 sessionKey。放 effect 里推进：layout effect 执行后本次渲染已生效，
    // 下一轮渲染才能据此判定「又切走了」。
    useEffect(() => {
      previousSessionKeyRef.current = sessionKey
    }, [sessionKey])

    // 主题经 Compartment 重配置：切换深色模式不重建视图，焦点与滚动都保持。
    useEffect(() => {
      controlRef.current?.updateSettings({ theme })
    }, [theme])

    // 正文模式（即时预览 ↔ Markdown 源码）经 Compartment 重配置。
    //
    // 三条硬约束都在这里守住：
    // 1. 不动文档。切换只翻两个开关，正文一个字符都不改，撤销历史因此天然保留。
    // 2. 不重建视图。updateSettings 只派发 reconfigure，焦点、IME 状态与滚动容器都不受影响。
    // 3. 不打断输入。组合期间 updateSettings 会把设置挂起到 compositionend
    //    （见 EditorControl.updateSettings），正在拼的候选词不会被拆掉。
    //
    // 切换**前**先把局部草稿落定：表格单元格与公式/mermaid 块的编辑态由装饰 Widget 持有，
    // 关掉实时预览会让这些 Widget 连同它们未提交的草稿一起被回收——那就等于静默丢字。
    // 因此先 commit（写回正文，仍是同一份撤销历史），草稿不是"丢掉"而是"成为正文的一部分"。
    const sourceModeRef = useRef(sourceMode)
    useEffect(() => {
      const control = controlRef.current
      if (!control) return
      if (sourceModeRef.current === sourceMode) return
      sourceModeRef.current = sourceMode
      if (sourceMode) commitLocalDrafts(control.getView())
      control.updateSettings(sourceMode ? SOURCE_MODE_SETTINGS : LIVE_PREVIEW_SETTINGS)
    }, [sourceMode])

    useImperativeHandle(ref, () => ({
      applyLink(target, label, url, cell) {
        const control = controlRef.current
        const view = control?.getView()
        if (!view || control!.getSettings().readOnly) return false
        if (cell) return applyCellLink(view, cell, target, label, url)
        return applyLinkTarget(view, target, label, url)
      },
      captureInsertion(position, ownerSessionKey) {
        // 发起时的那篇笔记若不是本编辑器此刻承载的笔记，就不能取书签：书签是零宽位置 +
        // 偏移映射，属于当前文档；拿它去代表另一篇笔记的插入点，落笔就会插错地方。
        // 返回 null 让队列走显式降级（追加到原笔记末尾），而不是把引用写进当前笔记。
        if (ownerSessionKey !== undefined && ownerSessionKey !== sessionKeyRef.current) return null
        const view = controlRef.current?.getView()
        const target = view ? activeTableEdit(view) : undefined
        const tableEnd = target?.input.closest<HTMLElement>(".cm-md-table-wrap")?.dataset.tableTo
        const oldLength = view?.state.doc.length ?? 0
        target?.commit()
        const range = view?.state.selection.main
        const end = tableEnd ? Number(tableEnd) + (view?.state.doc.length ?? 0) - oldLength : undefined
        // 书签永远是零宽插入点：有选区时取选区起点，选中文字原样保留；
        // position 是文件拖入的落点坐标换算结果，与当前光标无关。
        const at = end ?? position ?? range?.from ?? 0
        const mark = { anchor: end === undefined && position === undefined ? range?.anchor : undefined, from: at, head: end === undefined && position === undefined ? range?.head : undefined, to: at }
        // 上传期间按每次文档变化映射书签，单纯移动光标不会改变上传发起的位置。
        insertionMarks.current.add(mark)
        // 书签同时记住发起时的笔记身份与编辑器实例：异步附件完成时据此判断
        // 「这篇笔记是否还是当前笔记」「视图是否还是同一个」。
        const markSessionKey = sessionKeyRef.current
        const ownerNoteId = storageKeyRef.current
        // 发起时的远端修订号。上传期间若被同步合并过，文档偏移与书签的映射关系
        // 已经不可信，落笔会插到语义错误的位置。
        const ownerRevision = revisionRef.current

        const dispose = () => { insertionMarks.current.delete(mark) }
        let settled = false
        return { dispose, insert(text: string) {
          dispose()
          // 书签只许落笔一次：迟到的重复回调（重试、双回调）不能重复插入。
          if (settled) return false
          settled = true
          const current = controlRef.current
          const currentView = current?.getView()
          if (!currentView?.dom.isConnected || currentView.state.readOnly) return false
          // 已经切到别的笔记：书签里的文档偏移属于上一篇，写进去会插到错误位置。
          // 返回 false 让调用方走「追加到原笔记末尾」的安全降级，而不是污染当前笔记。
          if (markSessionKey !== sessionKeyRef.current || ownerNoteId !== storageKeyRef.current) return false
          // 上传期间这篇笔记被同步合并过（revision 变了）：偏移映射已不可信，
          // 同样走安全降级，绝不按旧偏移落笔。
          if (ownerRevision !== undefined && revisionRef.current !== ownerRevision) return false
          const { from, to } = mark
          // 锚点有效性：书签按变更映射而来，偏移必须仍落在当前文档范围内。
          // （用户在上传期间继续打字是合法场景，正文变化本身不算失效。）
          if (from < 0 || to > currentView.state.doc.length) return false
          const gap = paragraphSeparatorAt(currentView.state, from)
          const insert = "\n".repeat(Math.max(0, gap.length - (text.match(/^\n*/)?.[0].length ?? 0))) + text
          // 用户没动过选区（粘贴后等待）才把光标带到图片之后并滚动聚焦；
          // 等待期间已移到别处写作时只做正文变更，选区随事务映射，不打断输入。
          const selectionUntouched = mark.anchor !== undefined
            && currentView.state.selection.main.anchor === mark.anchor
            && currentView.state.selection.main.head === mark.head
          // 路由栈会保活上一页编辑器；异步附件可以继续写回它绑定的文档，
          // 但隐藏页绝不能在完成时抢焦点或滚动，否则当前笔记会突然跳动。
          const editorIsActive = !currentView.dom.closest("[inert]")
          if (selectionUntouched && editorIsActive) {
            currentView.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: "input.attachment", scrollIntoView: true })
          } else {
            currentView.dispatch({ changes: { from, to, insert }, userEvent: "input.attachment" })
          }
          return true
        } }
      },
      collapseSelection() {
        controlRef.current?.dispatchCommand({ type: "selection.collapse" })
      },
      async copySelection() {
        const view = controlRef.current?.getView()
        const input = activeTableEdit(view)?.input
        const selected = input
          ? input.value.slice(input.selectionStart, input.selectionEnd)
          : selectedMarkdownRanges(view).map((range) => range.text).join("\n")
        if (!selected) return false
        return writeClipboardText(selected, "text")
      },
      async cutSelection() {
        const control = controlRef.current
        const view = control?.getView()
        const target = activeTableEdit(view)
        const ranges = target ? [] : selectedMarkdownRanges(view)
        const selected = target
          ? target.input.value.slice(target.input.selectionStart, target.input.selectionEnd)
          : ranges.map((range) => range.text).join("\n")
        if (!view || control!.getSettings().readOnly || !selected) return false
        const state = view.state
        const inputValue = target?.input.value
        const inputFrom = target?.input.selectionStart
        const inputTo = target?.input.selectionEnd
        if (!await writeClipboardText(selected, "text")) return false
        // 剪贴板授权可能异步返回；期间正文/选区变了就只复制，不删除任何新选区。
        if (target) {
          if (activeTableEdit(view) !== target || target.input.value !== inputValue || target.input.selectionStart !== inputFrom || target.input.selectionEnd !== inputTo) return false
          target.input.setRangeText("", inputFrom, inputTo, "end")
          target.commit()
        } else {
          if (view.state.doc !== state.doc || !view.state.selection.eq(state.selection) || view.state.readOnly || !view.dom.isConnected) return false
          view.dispatch({
            changes: ranges.map((range) => ({ from: range.from, to: range.to })),
            selection: { anchor: ranges[0].from },
            userEvent: "delete.cut",
          })
        }
        view.focus()
        return true
      },
      focus() {
        controlRef.current?.focus()
      },
      findText(query, direction = "next", fromStart = false) {
        return findTextInView(controlRef.current?.getView(), query, direction, fromStart)
      },
      insertText(text) {
        const control = controlRef.current
        const view = control?.getView()
        if (!view || control!.getSettings().readOnly || !text) return

        const tableTarget = activeTableEdit(view)
        if (tableTarget) { tableTarget.format(text); return }
        if (toggleBlockFormat(view, text)) return
        if (text === "[链接](https://)" && focusExistingLinkUrl(view)) return

        // 加粗 / 斜体 / 删除线 / 行内代码走带「再点一次取消」的独立路径，其余模板保持原逻辑。
        const inlineMark = INLINE_MARK_TEMPLATES[text]
        if (inlineMark) {
          toggleInlineMark(view, inlineMark.kind, inlineMark.placeholder)
          return
        }

        // 格式工具栏优先包装当前选区；没有选区时才插入带占位文案的模板。
        const selection = view.state.selection.main
        const selected = view.state.sliceDoc(selection.from, selection.to)
        const formatted = formatToolbarText(text, selected)
        // 插入块或附件时补足表格边界，避免 GFM 把图片吞作下一行单元格。
        const gap = selection.empty ? paragraphSeparatorAt(view.state, selection.to) : ""
        const leading = gap ? Math.max(0, gap.length - (formatted.text.match(/^\n*/)?.[0].length ?? 0)) : 0
        if (leading) {
          formatted.text = "\n".repeat(leading) + formatted.text
          if (formatted.selection) { formatted.selection.from += leading; formatted.selection.to += leading }
        }
        const insertFrom = selection.from
        view.dispatch({
          changes: { from: selection.from, to: selection.to, insert: formatted.text },
          selection: formatted.selection
            ? { anchor: selection.from + formatted.selection.from, head: selection.from + formatted.selection.to }
            : { anchor: selection.from + formatted.text.length },
          scrollIntoView: true,
        })
        view.focus()
        // 模板固定以换行开头，表格真正的第一行从插入点之后一个字符算起。
        if (text === TABLE_INSERT_TEMPLATE) focusFirstTableHeaderCell(view, insertFrom + leading + 1)
      },
      lineAtViewportTop(clientY) {
        const view = controlRef.current?.getView()
        if (!view) return null
        // 编辑器本身不滚动，可视区由外层容器决定，所以按屏幕坐标反查位置而不是读编辑器的滚动量。
        const bounds = view.contentDOM.getBoundingClientRect()
        const position = view.posAtCoords({ x: bounds.left + 1, y: clientY + 1 }, false)
        return position === null ? null : view.state.doc.lineAt(position).number
      },
      async pasteAtSelection() {
        const control = controlRef.current
        const view = control?.getView()
        if (!view || control!.getSettings().readOnly) return false
        const target = activeTableEdit(view)
        const state = view.state
        const onInsertFiles = handlers.current.onInsertFiles
        const pasteSessionKey = sessionKeyRef.current
        const inputSnapshot = target ? { value: target.input.value, from: target.input.selectionStart, to: target.input.selectionEnd } : undefined
        const isCurrentPaste = () => controlRef.current === control
          && sessionKeyRef.current === pasteSessionKey
          && handlers.current.onInsertFiles === onInsertFiles
          && view.dom.isConnected
          && !view.state.readOnly
          && view.state.doc === state.doc
          && view.state.selection.eq(state.selection)
          && (!target || (activeTableEdit(view) === target
            && target.input.value === inputSnapshot?.value
            && target.input.selectionStart === inputSnapshot.from
            && target.input.selectionEnd === inputSnapshot.to))
        let content
        try { content = await readClipboardContent() }
        catch (error) {
          if (isCurrentPaste()) handlers.current.onPasteError?.(error instanceof Error ? error.message : "读取剪贴板失败")
          return false
        }
        if (!isCurrentPaste()) return false
        const text = content.text
        if ((!text && content.files.length === 0) || !view.dom.isConnected) {
          if (view.dom.isConnected) handlers.current.onPasteError?.("剪贴板中没有可粘贴的内容")
          return false
        }
        if (!text && content.files.length > 0) {
          if (!onInsertFiles) return false
          if (shouldPasteAsPlainText(state)) {
            handlers.current.onPasteError?.("代码范围内不能插入图片")
            return false
          }
          // 回调也绑定在用户点击粘贴的那一刻；父级即使复用了编辑器实例并换了笔记，
          // 迟到结果也不会借用新笔记的附件写入函数。
          // 已确认选区未变化，交给 captureInsertion 记录 anchor/head；附件完成后光标才能跟到图片后，
          // live preview 随即把引用渲染成图片。显式 position 只留给真正的鼠标拖放落点。
          onInsertFiles(content.files)
          return true
        }
        if (!text) return false
        if (target) {
          target.input.setRangeText(text, target.input.selectionStart, target.input.selectionEnd, "end")
          target.input.dispatchEvent(new Event("input", { bubbles: true }))
          return true
        }
        // 菜单关闭 / 焦点恢复也会产生事务；只核验正文与选区，避免把无关状态更新误判为用户改写。
        const selection = view.state.selection.main
        view.dispatch({
          changes: { from: selection.from, to: selection.to, insert: text },
          selection: { anchor: selection.from + text.length },
          scrollIntoView: true,
        })
        view.focus()
        return true
      },
      readLinkContext() {
        const control = controlRef.current
        const view = control?.getView()
        if (!view || control!.getSettings().readOnly) return null
        // 单元格编辑中 CodeMirror 的选区是进入单元格前的旧位置，链接必须写进单元格
        // textarea；面板输入框会抢走焦点，先挂 contextMenuActive 标记抑制 blur 时的
        // 自动提交，让未保存内容与选区在面板期间都留在原单元格里。
        const table = activeTableEdit(view)
        if (table) {
          const { input } = table
          const from = input.selectionStart ?? 0
          const to = input.selectionEnd ?? from
          input.dataset.contextMenuActive = "true"
          return {
            cell: { from, target: table, to, value: input.value },
            hadFocus: false,
            selectedText: input.value.slice(from, to),
            target: linkTargetInText(input.value, from, to),
          }
        }
        const range = view.state.selection.main
        return {
          hadFocus: view.hasFocus,
          selectedText: view.state.sliceDoc(range.from, range.to),
          target: linkTargetAt(view.state, range.from, range.to),
        }
      },
      redo() {
        runHistory(controlRef.current, true)
      },
      removeLink(target, cell) {
        const control = controlRef.current
        const view = control?.getView()
        if (!view || control!.getSettings().readOnly) return false
        if (cell) {
          if (activeTableEdit(view) !== cell.target || cell.target.input.value !== cell.value) return false
          delete cell.target.input.dataset.contextMenuActive
          cell.target.replace(target.from, target.to, target.label)
          return true
        }
        return removeLinkTarget(view, target)
      },
      restoreCellFocus(cell) {
        if (!cell) return false
        const { input } = cell.target
        // 无论单元格是否还在，面板期间的抑制标记都要清掉，避免残留影响下一次 blur 提交。
        delete input.dataset.contextMenuActive
        if (!input.isConnected) return false
        input.focus({ preventScroll: true })
        input.setSelectionRange(cell.from, cell.to)
        return true
      },
      replaceAll(query, replacement) {
        const control = controlRef.current
        const view = control?.getView()
        if (!view || control!.getSettings().readOnly || !query) return 0
        const matches = findPlainTextMatches(view.state.doc.toString(), query)
        if (matches.length === 0) return 0
        // CodeMirror 以同一个 transaction 应用全部变更，整次替换可被一次撤销恢复。
        view.dispatch({
          changes: matches.map((match) => ({ from: match.from, insert: replacement, to: match.to })),
        })
        view.focus()
        return matches.length
      },
      replaceCurrent(query, replacement) {
        const control = controlRef.current
        const view = control?.getView()
        if (!view || control!.getSettings().readOnly || !query) return { current: 0, total: 0 }
        const selection = view.state.selection.main
        const selected = view.state.sliceDoc(selection.from, selection.to)
        if (selected.toLocaleLowerCase() !== query.toLocaleLowerCase()) {
          return findTextInView(view, query, "next", false)
        }
        view.dispatch({
          changes: { from: selection.from, insert: replacement, to: selection.to },
          selection: { anchor: selection.from + replacement.length },
        })
        return findTextInView(view, query, "next", false)
      },
      revealLine(line) {
        const control = controlRef.current
        control?.revealLine(line, { focus: true })
        // 键盘未升起时格式栏也占着底部，dispatch 的滚动不感知它；下一帧按可视带再校正一次。
        requestAnimationFrame(() => {
          const current = controlRef.current
          if (current?.hasFocus()) scrollCursorIntoView(current.getView())
        })
      },
      scrollLineToTop(line) {
        if (!controlRef.current) return false
        return controlRef.current.dispatchCommand({ line, type: "navigation.scrollLineToTop" })
      },
      selectAll() {
        const control = controlRef.current
        const view = control?.getView()
        if (!view || !control) return
        const table = activeTableEdit(view)
        if (table) { table.input.select(); return }
        control.dispatchCommand({ type: "selection.all" })
      },
      undo() {
        runHistory(controlRef.current, false)
      },
    }), [])

    return (
      <>
      <ImageZoomOverlay />
      {/*
        挂载点上不再有 React 管理的编辑器子节点：EditorView 自己拥有这段 DOM。
        容器保留 aria-label 与高度链，使「正文区域」在可访问性树与既有测试里仍是同一个节点。
      */}
      <div
        ref={hostRef}
        aria-label="Markdown 编辑器"
        className="markdown-editor-host"
        onFocusCapture={(event) => onEditingTargetChangeRef.current?.(Boolean((event.target as HTMLElement).closest(".cm-md-table-cell-input")))}
        onBlurCapture={() => queueMicrotask(() => onEditingTargetChangeRef.current?.(Boolean(activeTableEdit(controlRef.current?.getView()))))}
      />
      </>
    )
  },
)

// 正文模式的设置补丁。两处共用同一份常量，避免「进入源码」和「退出源码」写歪成不对称的一组开关。
const SOURCE_MODE_SETTINGS = { livePreview: false, tableEditing: false } as const
const LIVE_PREVIEW_SETTINGS = { livePreview: true, tableEditing: true } as const

/**
 * 切到源码模式前把「只活在装饰 Widget 里的编辑态」落定。
 *
 * 表格单元格（textarea 草稿）与公式 / mermaid 块（block-edit-session 草稿）都靠 Widget 存活：
 * 一旦实时预览装饰被拆掉，Widget 被回收，没提交的内容就再也回不来了。这里逐个提交，
 * 内容因此进入正文与同一份撤销历史，而不是被静默丢弃。
 *
 * 只提交、不取消：用户正在写的东西不该因为切了一下视图就消失。
 */
function commitLocalDrafts(view: EditorView | undefined) {
  if (!view) return
  activeTableEdit(view)?.commit()
  commitOpenRichEditors(view)
}

// 实时预览的选项。回调一律经 handlers 中转，因此这份选项只在作用域或平台变化时才需要重算，
// 不会因为父组件的每次渲染换引用而触发装饰整体重建。
function livePreviewOptionsFor(
  settings: EditorSettings,
  handlers: { current: { onLinkMenu?: (tap: EditorLinkTap) => void; onLoadWikiNote?: (target: string) => void; onOpenWikiLink?: (target: string) => void; onResolveAsset?: (source: string) => Promise<VaultAsset | null>; onResolveWikiNote?: (target: string) => EmbeddedWikiNoteResult; onFormatStateChange?: (state: EditorFormatState | null) => void } },
  platform: "desktop" | "mobile",
): LivePreviewOptions {
  return {
    assetScope: settings.assetScope,
    onLoadWikiNote: (target) => handlers.current.onLoadWikiNote?.(target),
    onOpenWikiLink: (target) => handlers.current.onOpenWikiLink?.(target),
    // 移动端点按链接交给宿主菜单（打开/编辑/移除），桌面端与只读笔记维持单击直接打开。
    onLinkTap: platform === "mobile" && !settings.readOnly ? (tap) => {
      const menu = handlers.current.onLinkMenu
      if (!menu) return false
      menu(tap)
      return true
    } : undefined,
    onResolveAsset: (source) => handlers.current.onResolveAsset?.(source) ?? Promise.resolve(null),
    onResolveWikiNote: (target) => handlers.current.onResolveWikiNote?.(target) ?? { status: "missing" },
    onTableFormatState: (state) => handlers.current.onFormatStateChange?.(state ? { ...state, heading: 0 } : null),
    tableStorageKey: settings.assetScope,
  }
}

function isImageClipboardWithIncidentalName(files: File[], text: string | null, html: string | null) {
  if (html || files.some((file) => !file.type.startsWith("image/"))) return false
  if (!text) return true
  const normalized = text.trim().replace(/^file:\/\//, "").split(/[\\/]/).pop()?.toLocaleLowerCase()
  return files.some((file) => normalized === file.name.toLocaleLowerCase())
}

async function pasteClipboardAtSnapshot(view: EditorView, onInsertFiles: (files: File[], position?: number) => void, onError?: (message: string) => void, isCurrent: () => boolean = () => true) {
  const state = view.state
  try {
    const content = await readClipboardContent()
    if (!isCurrent() || !view.dom.isConnected || view.state.doc !== state.doc || !view.state.selection.eq(state.selection) || view.state.readOnly) return false
    if (content.text) {
      const range = state.selection.main
      view.dispatch({ changes: { from: range.from, to: range.to, insert: content.text }, selection: { anchor: range.from + content.text.length }, scrollIntoView: true, userEvent: "input.paste" })
      return true
    }
    if (content.files.length > 0) {
      onInsertFiles(content.files)
      return true
    }
    if (isCurrent()) onError?.("剪贴板中没有可粘贴的内容")
  } catch (error) {
    if (isCurrent()) onError?.(error instanceof Error ? error.message : "读取剪贴板失败")
  }
  return false
}

// 粘贴为纯文本：只取剪贴板的 text/plain，完全不看 HTML，也不做链接包裹与附件插入。
// 与 pasteAtSelection 的区别就在这里——那条路径面向「贴进来还要保留格式」，
// 这条面向「贴进来必须是我复制的字符本身」。
async function pastePlainTextAtSnapshot(
  view: EditorView,
  onError?: (message: string) => void,
  isCurrent: () => boolean = () => true,
) {
  const state = view.state
  try {
    const content = await readClipboardContent()
    // 读取剪贴板需要授权，是异步的；期间用户可能已经切走笔记或改了选区。
    if (!isCurrent() || !view.dom.isConnected || view.state.doc !== state.doc || !view.state.selection.eq(state.selection) || view.state.readOnly) return false
    if (!content.text) {
      onError?.("剪贴板里没有纯文本内容")
      return false
    }
    const range = state.selection.main
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: content.text },
      selection: { anchor: range.from + content.text.length },
      scrollIntoView: true,
      userEvent: "input.paste",
    })
    return true
  } catch (error) {
    if (isCurrent()) onError?.(error instanceof Error ? error.message : "读取剪贴板失败")
    return false
  }
}

export function selectedMarkdownRange(view: EditorView | undefined) {
  return selectedMarkdownRanges(view)[0] ?? null
}

function selectedMarkdownRanges(view: EditorView | undefined) {
  if (!view) return []
  const ranges = view.state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => normalizedMarkdownRange(view, range))
    .filter((range): range is { from: number; text: string; to: number } => range !== null)
  return mergeMarkdownRanges(view.state, ranges)
}

function mergeMarkdownRanges(state: EditorState, ranges: Array<{ from: number; text: string; to: number }>) {
  const merged: Array<{ from: number; text: string; to: number }> = []
  for (const range of [...ranges].sort((left, right) => left.from - right.from || left.to - right.to)) {
    const previous = merged[merged.length - 1]
    if (!previous || range.from > previous.to) {
      merged.push({ ...range })
      continue
    }
    previous.to = Math.max(previous.to, range.to)
    previous.text = state.sliceDoc(previous.from, previous.to)
  }
  return merged
}

function normalizedMarkdownRange(view: EditorView, range: SelectionRange) {
  let from = range.from
  let to = range.to
  const line = view.state.doc.lineAt(from)
  const decorations = clipboardLineDecorations(view, range.from, range.to)
  const hiddenPrefixEnd = hiddenStructuralPrefixEnd(view.state, decorations, line.from, line.text)
  let expandedStart = false
  // 即时预览只在源码标记被真实替换时才需要补范围；并且必须覆盖首项可见整行，
  // 否则从正文开头随手选几个字也会被误升级成整条 Markdown。
  if (
    hiddenPrefixEnd !== null
    && from >= hiddenPrefixEnd
    && rangeFullyHiddenSourceMarks(decorations, hiddenPrefixEnd, from)
    && selectionCoversVisibleLineEnd(decorations, to, line.to)
  ) {
    from = line.from
    expandedStart = true
  }
  const endLine = view.state.doc.lineAt(to)
  if ((expandedStart || range.from < endLine.from) && to < endLine.to && rangeFullyHiddenSourceMarks(decorations, to, endLine.to)) to = endLine.to
  if (from >= to) return null
  return { from, text: view.state.sliceDoc(from, to), to }
}

function clipboardLineDecorations(view: EditorView, from: number, to: number) {
  const startLine = view.state.doc.lineAt(from)
  const endLine = view.state.doc.lineAt(to)
  const ranges = startLine.number === endLine.number
    ? [{ from: startLine.from, to: startLine.to }]
    : [{ from: startLine.from, to: startLine.to }, { from: endLine.from, to: endLine.to }]
  return buildLivePreviewDecorationsForRanges(view, ranges)
}

function hiddenStructuralPrefixEnd(state: EditorState, decorations: DecorationSet, lineFrom: number, text: string) {
  const candidateEnd = structuralHiddenLineContentStart(text)
  if (candidateEnd === null) return null
  const to = lineFrom + candidateEnd
  return isStructuralMarkdownLine(state, lineFrom, to) && prefixNonWhitespaceHiddenByReplacement(state, decorations, lineFrom, to) ? to : null
}

function structuralHiddenLineContentStart(text: string) {
  let offset = 0
  let structural = false
  while (offset < text.length) {
    const quote = text.slice(offset).match(/^(?: {0,3}>\s?)/)
    if (!quote) break
    offset += quote[0].length
    structural = true
  }
  const rest = text.slice(offset)
  const heading = rest.match(/^#{1,6}\s+/)
  const task = rest.match(/^[ \t]*(?:[-+*]|\d+[.)])\s+\[[ xX]\]\s+/)
  const unordered = rest.match(/^[ \t]*[-+*]\s+/)
  const mark = heading?.[0] ?? task?.[0] ?? unordered?.[0]
  if (mark) {
    offset += mark.length
    structural = true
  }
  return structural && offset > 0 && offset <= text.length ? offset : null
}

function selectionCoversVisibleLineEnd(decorations: DecorationSet, to: number, lineTo: number) {
  if (to >= lineTo) return true
  return rangeFullyHiddenSourceMarks(decorations, to, lineTo)
}

function prefixNonWhitespaceHiddenByReplacement(state: EditorState, decorations: DecorationSet, from: number, to: number) {
  if (from >= to) return false
  const hidden: Array<{ from: number; to: number }> = []
  decorations.between(from, to, (rangeFrom, rangeTo, decoration) => {
    if (rangeFrom < rangeTo && isReplacementDecoration(decoration.spec)) hidden.push({ from: rangeFrom, to: rangeTo })
  })
  for (let position = from; position < to; position += 1) {
    if (state.sliceDoc(position, position + 1).trim() === "") continue
    if (!hidden.some((range) => position >= range.from && position < range.to)) return false
  }
  return hidden.length > 0
}

function rangeFullyHiddenSourceMarks(decorations: DecorationSet, from: number, to: number) {
  if (from >= to) return true
  let cursor = from
  decorations.between(from, to, (rangeFrom, rangeTo, decoration) => {
    if (!isSourceHiddenDecoration(decoration.spec) || rangeFrom > cursor) return
    cursor = Math.max(cursor, rangeTo)
  })
  return cursor >= to
}

function isReplacementDecoration(spec: Record<string, unknown>) {
  return !("class" in spec) && (!("attributes" in spec) || !spec.attributes)
}

function isSourceHiddenDecoration(spec: Record<string, unknown>) {
  return isReplacementDecoration(spec) && (!("widget" in spec) || !spec.widget)
}

function writeClipboardEventText(event: ClipboardEvent, text: string) {
  if (!event.clipboardData || !text) return false
  try {
    event.clipboardData.clearData()
    event.clipboardData.setData("text/plain", text)
    return true
  } catch {
    return false
  }
}

function hasEditorClipboardContext(view: EditorView) {
  const selection = document.getSelection()
  if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
    const anchor = selection.anchorNode
    const focus = selection.focusNode
    return !!anchor && !!focus && view.contentDOM.contains(anchor) && view.contentDOM.contains(focus)
  }
  return view.hasFocus || view.dom.contains(document.activeElement)
}

function isEditableFormControl(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
}

// 点击「本行文字右侧的空白」时，把光标明确落到本行行尾。
// CodeMirror 的 posAtCoords 是按字形矩形就近匹配的，而正文行高（1.85 × 14px ≈ 25.9px/行）
// 明显高于字形本身（约 18px），文字右侧的空白没有任何字形矩形可匹配，纵向落点就会就近落到
// 相邻行的字形上；高度缓存与真实排版一旦不一致（改字号、缩放、字体加载完成后重排），行框
// 下半段就会被判给下一行，表现为「点同一块空白，纵向位置不同结果不同」。
// 只在规则单行、且鼠标确实位于文字右侧时接手，其余情况（软换行、Bidi、只读、带修饰键）
// 一律返回 null，交回 CodeMirror 自己定位。
function blankLineEndAt(view: EditorView, event: MouseEvent): number | null {
  if (event.button !== 0 || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return null
  if (view.state.readOnly) return null
  // 命中文字时事件目标是行内的 span，只有落在行的空白区域才会直接命中 .cm-line 本身。
  const target = event.target
  if (!(target instanceof HTMLElement) || !target.classList.contains("cm-line")) return null
  const line = view.state.doc.lineAt(view.posAtDOM(target, 0))
  const end = view.coordsAtPos(line.to, -1)
  const start = view.coordsAtPos(line.from, 1)
  if (!end || !start) return null
  // 软换行的逻辑行占多个视觉行，行尾不在鼠标所在的那一段，不能直接送到整个逻辑行末。
  if (Math.abs(start.top - end.top) > 1) return null
  // RTL 与混排内容里「行尾」的视觉位置与 LTR 不同，不做修正。
  if (view.textDirectionAt(line.from) !== Direction.LTR || view.bidiSpans(line).length > 1) return null
  if (event.clientX <= end.right) return null
  return line.to
}

function isStructuralMarkdownLine(state: EditorState, lineFrom: number, contentStart: number) {
  for (let node: MdNode | null = syntaxTree(state).resolveInner(Math.min(contentStart, state.doc.length), -1); node; node = node.parent) {
    if (node.name === "FencedCode" || node.name === "CodeBlock" || node.name === "Table") return false
    if (node.name === "Blockquote" || node.name === "ListItem" || /^ATXHeading[1-6]$/.test(node.name)) return true
  }
  for (let node: MdNode | null = syntaxTree(state).resolveInner(lineFrom, 1); node; node = node.parent) {
    if (node.name === "FencedCode" || node.name === "CodeBlock" || node.name === "Table") return false
    if (node.name === "Blockquote" || node.name === "ListItem" || /^ATXHeading[1-6]$/.test(node.name)) return true
  }
  return false
}

// 只用到节点名与父链；按结构声明，避免为类型引入 @lezer/common 显式依赖。
type MdNode = { name: string; parent: MdNode | null }

function isInsideTable(state: EditorState, position: number) {
  for (let node: MdNode | null = syntaxTree(state).resolveInner(position, 1); node; node = node.parent) {
    if (node.name === "Table") return true
  }
  return false
}

export function shouldPasteAsPlainText(state: EditorState) {
  const range = state.selection.main
  const positions = range.empty ? [range.head] : [range.from, Math.max(range.from, range.to - 1)]
  return positions.every((position) => {
    for (let node: MdNode | null = syntaxTree(state).resolveInner(position, 1); node; node = node.parent) {
      if (node.name === "InlineCode" || node.name === "FencedCode" || node.name === "CodeBlock") return true
    }
    return false
  })
}

// 在表格末行、或紧邻其后的空行插入块时都需要边界，不能只处理文档末尾。
function paragraphSeparatorAt(state: EditorState, position: number) {
  const line = state.doc.lineAt(position)
  if (position === line.to && isInsideTable(state, line.from)) return "\n\n"
  if (!line.text.trim() && line.number > 1 && isInsideTable(state, state.doc.line(line.number - 1).from)) return "\n"
  return ""
}

// 表格会把紧随其后的非空行并进自己，只有隔开一个空行，新写的内容才是独立段落。
export function paragraphSeparatorAtEnd(state: EditorState) {
  const { doc } = state
  const lastLine = doc.line(doc.lines)
  if (lastLine.text.trim() !== "") return isInsideTable(state, lastLine.from) ? "\n\n" : ""
  if (doc.lines < 2) return ""
  const previous = doc.line(doc.lines - 1)
  if (previous.text.trim() === "") return ""
  return isInsideTable(state, previous.from) ? "\n" : ""
}


export function findPlainTextMatches(text: string, query: string) {
  if (!query) return []
  const matches: Array<{ from: number; to: number }> = []
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu")
  for (const match of text.matchAll(pattern)) {
    const from = match.index
    matches.push({ from, to: from + match[0].length })
  }
  return matches
}

function findTextInView(
  view: EditorView | undefined,
  query: string,
  direction: "next" | "previous",
  fromStart: boolean,
): MarkdownFindResult {
  if (!view || !query) return { current: 0, total: 0 }
  const matches = findPlainTextMatches(view.state.doc.toString(), query)
  if (matches.length === 0) return { current: 0, total: 0 }

  const selection = view.state.selection.main
  let index = 0
  if (!fromStart && direction === "next") {
    index = matches.findIndex((match) => match.from >= selection.to)
    if (index < 0) index = 0
  } else if (!fromStart) {
    index = matches.length - 1
    while (index >= 0 && matches[index].to > selection.from) index -= 1
    if (index < 0) index = matches.length - 1
  }
  const match = matches[index]
  // 查找栏需要持续接收键盘输入；这里只移动编辑器选区，不抢回输入框焦点。
  view.dispatch({ selection: { anchor: match.from, head: match.to }, scrollIntoView: true })
  return { current: index + 1, total: matches.length }
}

// 工具栏的加粗 / 斜体 / 删除线 / 行内代码按钮走 toggleInlineMark，选区已在对应标记里时可以取消。
const INLINE_MARK_TEMPLATES: Record<string, { kind: InlineMarkKind; placeholder: string }> = {
  "**加粗文字**": { kind: "strong", placeholder: "加粗文字" },
  "*斜体文字*": { kind: "emphasis", placeholder: "斜体文字" },
  "~~删除线文字~~": { kind: "strike", placeholder: "删除线文字" },
  "`行内代码`": { kind: "code", placeholder: "行内代码" },
}

// 工具栏模板 → 包裹选中文字用的前后缀。没有选区时按原模板（含占位文案）整段插入。
const WRAP_TEMPLATES: Record<string, [string, string]> = {
  "**加粗文字**": ["**", "**"],
  "*斜体文字*": ["*", "*"],
  "~~删除线文字~~": ["~~", "~~"],
  "`行内代码`": ["`", "`"],
}

export function formatToolbarText(template: string, selected: string) {
  if (template === "[链接](https://)") {
    const label = selected || "链接"
    const from = label.length + 3
    return { text: `[${label}](https://)`, selection: { from, to: from + 8 } }
  }
  if (template === "\n```\n\n```\n") {
    return { text: `\n\`\`\`\n${selected}\n\`\`\`\n`, selection: { from: 5, to: 5 + selected.length } }
  }
  if (!selected) return { text: template }
  const wrap = WRAP_TEMPLATES[template]
  if (wrap) return { text: `${wrap[0]}${selected}${wrap[1]}` }

  const prefix = template.match(/^\n(#{1,3} |> |- |- \[ \] )$/)?.[1]
  if (prefix) return { text: selected.split("\n").map((line) => `${prefix}${line}`).join("\n") }
  return { text: template }
}

function runHistory(control: EditorControl | null | undefined, forward: boolean) {
  if (!control || control.getSettings().readOnly) return
  // 未提交的单元格先形成同一份文档历史，再执行撤销；不能只撤销正文而留下悬空的 textarea。
  activeTableEdit(control.getView())?.commit()
  if (forward) control.redo()
  else control.undo()
}

export default MarkdownEditor
