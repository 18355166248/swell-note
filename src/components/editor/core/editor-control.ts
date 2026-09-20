import { Annotation, type EditorState, type Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { redo as redoCommand, undo as undoCommand } from "@codemirror/commands"

import { EditorEventBus, type EditorEventListener, type EditorEventType } from "./editor-events"
import type { EditorSessionFields, EditorSessionStore } from "./editor-session-store"
import {
  type EditorCommand,
  type EditorCommandResult,
  type EditorDocumentIdentity,
  type EditorSelectionSnapshot,
  type EditorSettings,
} from "./editor-types"
import {
  buildEditorState,
  createEditorCompartments,
  createEditorView,
  editableExtension,
  themeExtension,
  type EditorCompartments,
  type EditorExtensionFactory,
  type EditorStateOptions,
} from "./create-editor"

/**
 * 外部变更标注。宿主据此区分「用户输入」与「笔记切换 / 版本恢复 / 远端合并」，
 * 避免把回写当成新输入再触发一次保存。
 */
export const externalDocumentChange = Annotation.define<boolean>()

export type UpdateDocumentOptions = {
  /**
   * 允许在输入法组合期间落笔。只有「用户已明确切走」时才该置位：
   * 此时不结束组合态，新笔记就会一直停在旧正文上。
   * 同一篇笔记的外部回写绝不能置位，否则会把用户正在拼的中文冲掉。
   */
  forceSwitch?: boolean
  /**
   * 随这次正文更新一起生效的设置。切换笔记时先更新设置再由 buildEditorState 产出新扩展，
   * 因此不必先 reconfigure 一次再重建状态——实时预览的装饰重建代价很高，能省一次就省一次。
   */
  settings?: Partial<EditorSettings>
}

type PendingDocumentUpdate = {
  doc: string
  identity: EditorDocumentIdentity
}

export type EditorControlOptions = {
  parent: HTMLElement
  doc: string
  identity: EditorDocumentIdentity
  settings: EditorSettings
  /** 固定扩展：语言。顺序敏感，由上层决定。 */
  languageExtensions: Extension
  /** 固定扩展：行为（输入增强、选区渲染、滚动处理、事件转发）。 */
  buildBehaviorExtensions: (control: EditorControl) => Extension
  /** 随平台 / 预览 / 表格开关变化的扩展，经 Compartment 动态重配置。 */
  platformExtensions: EditorExtensionFactory
  livePreviewExtensions: EditorExtensionFactory
  tableEditingExtensions: EditorExtensionFactory
  /** 会话快照的序列化字段（historyField），用于跨重挂载保留撤销栈。 */
  sessionFields: EditorSessionFields
  /**
   * 会话快照存储。必须跨「编辑器卸载」存活，否则切到阅读态再切回来会丢撤销历史。
   * 与改造前一致：进程内共享一份，按 sessionKey 隔离。
   */
  sessionStore: EditorSessionStore
}

/**
 * 编辑器唯一命令入口。Workspace、工具栏与命令面板都只经它操作编辑器，
 * 不再各自查找 EditorView 或 DOM。
 *
 * 生命周期契约：
 * - 一个挂载中的编辑区域只有一个 EditorView。切换笔记走 updateDocument，
 *   不重建视图，因此焦点、输入法状态、DOM 与滚动容器都得以保留。
 * - 每个笔记的撤销历史、选区与滚动按 sessionKey 隔离，互不串联。
 * - EditorView 只在 destroy() 里销毁；只读、主题、平台、预览与表格开关走 reconfigure。
 */
export class EditorControl {
  private view: EditorView
  private readonly events = new EditorEventBus()
  private readonly options: EditorControlOptions
  private readonly compartments: EditorCompartments = createEditorCompartments()
  private settings: EditorSettings
  private identity: EditorDocumentIdentity
  private destroyed = false
  private composing = false
  private pending: PendingDocumentUpdate | null = null
  /** 组合期间挂起的设置，随挂起的正文一起在 compositionend 落地。 */
  private pendingSettings: Partial<EditorSettings> = {}
  /**
   * 最近一次已知的正文快照（引用即 CodeMirror 当前正文对应的字符串）。
   *
   * 宿主的 value 是「onChange 出去的字符串」原样回传的，因此绝大多数外部更新
   * 都能在这一步用 O(1) 的引用比较短路掉 getDocument()。
   * 这一步是热路径：每次按键都会经 onChange → 宿主 state → value 回传跑一次，
   * 长文里每键new 一个 MB 级字符串正是要避免的开销。
   */
  private lastKnownDoc: string
  /**
   * 程序化更新期间抑制事件外发（笔记切换、外部回写、重建状态）。
   * 这些更新不是用户输入，外发会让宿主误判成新内容再存一次。
   */
  private suppressEvents = false
  private detachDomListeners: () => void = () => {}

  constructor(options: EditorControlOptions) {
    this.options = options
    this.settings = options.settings
    this.identity = options.identity
    // 初始化同样走会话恢复：挂载前该会话若已有快照（编辑态 ↔ 阅读态互切），
    // 必须连同撤销历史与选区一起恢复，否则返回时历史会被清空。
    const restored = this.buildRestoredState(options.doc, options.identity)
    this.view = createEditorView(restored ?? buildEditorState(this.stateOptions(options.doc, undefined)), options.parent)
    // 恢复出来的正文就是 options.doc（buildRestoredState 校验过），因此两者可共用同一引用，
    // 紧接着的 updateDocument 调用便能直接短路。
    this.lastKnownDoc = options.doc
    this.attachDomListeners()
  }

  // ---------------------------------------------------------------------------
  // 文档
  // ---------------------------------------------------------------------------

  getDocument(): string {
    return this.view.state.doc.toString()
  }

  /**
   * 更新正文。sessionKey 不变时只换内容；变了就是切换会话：
   * 先存档旧笔记的选区 / 滚动 / 历史，再恢复新笔记的那一份。
   *
   * 输入法组合期间刻意分两条路：
   * - 同一笔记的外部回写（保存回写、远端合并）→ 挂起，等 compositionend 再落笔，
   *   否则会把用户正在拼的中文直接冲掉。
   * - 换笔记且显式 forceSwitch → 结束组合态再落笔。用户已经离开这段输入，
   *   继续挂起只会让新笔记停在旧正文上。
   */
  updateDocument(doc: string, identity: EditorDocumentIdentity, options: UpdateDocumentOptions = {}): void {
    if (this.destroyed) return
    const switching = identity.sessionKey !== this.identity.sessionKey
    if (this.composing) {
      if (switching && options.forceSwitch) {
        // 用户已经明确切到别的笔记：组合态不能再拦住新笔记的正文。
        // 结束组合不会丢已上屏的字（那些早已由 CodeMirror 写进文档），
        // 只丢掉尚未上屏的拼音串——而它属于用户已经离开的那篇笔记。
        this.endComposition()
      } else {
        // 换笔记时不结束组合态：用户可能只是敲了空格让候选框展开、正文其实还没变，
        // 就此中断输入法会丢掉正在拼的字。挂起到 compositionend 再落笔即可。
        // 设置同样挂起——连同 assetScope 一起在 compositionend 落地，
        // 避免刚重配置完实时预览又因重建状态再算一遍。
        this.pending = { doc, identity }
        this.pendingSettings = { ...this.pendingSettings, ...options.settings }
        return
      }
    }
    // 正文是否一致先看引用：宿主的 value 由 onChange 原样回传，因此同一次编辑的回传
    // 命中同一份字符串，O(1) 短路掉全文序列化。引用不同再退回逐字比较，
    // 保证「内容确实相同但字符串不是同一个」也不会白重建一次状态。
    if (!switching && (doc === this.lastKnownDoc || doc === this.getDocument())) {
      this.lastKnownDoc = doc
      // 不重建状态：设置必须走 reconfigure，否则只读 / 主题之类的开关不会生效。
      if (options.settings) this.updateSettings(options.settings)
      // 正文没变但身份可能变了（同一份内容被重新指派给另一篇笔记）；
      // 身份是异步回写的判据，必须跟着更新，否则后续的迟到结果守卫会判错。
      if (identity.noteId !== this.identity.noteId || identity.revision !== this.identity.revision) {
        this.identity = identity
      }
      return
    }
    // 会走到重建状态这条路：设置先落地，由 buildEditorState 一次性按新设置产出扩展。
    // 若晚于重建，新笔记会先带着上一篇的只读 / 主题渲染一次。
    // 同会话的正文替换不重建配置，把设置透传给 applyDocument 让它补一次 reconfigure。
    if (options.settings) this.settings = { ...this.settings, ...options.settings }
    this.applyDocument(doc, identity, switching, switching ? undefined : options.settings)
  }

  private applyDocument(doc: string, identity: EditorDocumentIdentity, switching: boolean, reconfigure?: Partial<EditorSettings>): void {
    this.pending = null
    const previous = this.identity
    this.identity = identity
    // 切换前先存档旧会话，返回时才有选区、滚动与撤销历史可恢复。
    if (switching) this.rememberSnapshot(previous)
    this.suppressEvents = true
    try {
      // 目标笔记有可用快照就整份恢复（历史 + 选区）；否则重建状态——
      // 重建出来的历史天然为空，这正是「撤销不跨笔记」的保证。
      const restored = switching ? this.buildRestoredState(doc, identity) : null
      if (restored) this.applyState(restored)
      else if (switching) this.applyState(buildEditorState(this.stateOptions(doc, undefined)))
      else this.replaceDocumentInPlace(doc)
      // 三条路径落地的正文都是 doc，直接记下引用，省掉后面一次全文序列化。
      this.lastKnownDoc = doc
      // 同一篇笔记的正文替换不重建配置，设置变更必须在这里补一次 reconfigure。
      if (reconfigure) this.updateSettings(reconfigure)
    } finally {
      this.suppressEvents = false
    }
    // 切换后补发一次：宿主据此刷新工具栏与历史按钮。
    this.events.emit("documentChange", { composing: false, doc, external: true, identity })
    this.events.emit("selectionChange", {
      hasSelection: !this.view.state.selection.main.empty,
      identity,
      selection: this.readSelection(this.view.state),
    })
  }

  /**
   * 取出目标会话可恢复的状态。无快照、或快照正文与要显示的正文不一致时返回 null。
   * 后者意味着期间被同步或版本恢复改过正文——沿用旧撤销栈会把「撤销」变成
   * 跳回一份并不存在的历史，必须放弃恢复。
   */
  private buildRestoredState(doc: string, identity: EditorDocumentIdentity): EditorState | null {
    const snapshot = this.options.sessionStore.read(identity.sessionKey)
    if (!snapshot || snapshot.doc !== doc) return null
    try {
      return buildEditorState(this.stateOptions(doc, { fields: snapshot.fields, json: snapshot.json }))
    } catch {
      // 快照可能来自不同扩展组合（例如实时预览开关变化后字段不兼容）。
      // 恢复失败不是致命错误，退回重建状态即可，不能让编辑器停摆。
      this.options.sessionStore.forget(identity.sessionKey)
      return null
    }
  }

  /** 同笔记的正文替换：历史、选区与滚动都随事务映射保留。 */
  private replaceDocumentInPlace(doc: string): void {
    const length = this.view.state.doc.length
    this.view.dispatch({
      annotations: [externalDocumentChange.of(true)],
      changes: { from: 0, insert: doc, to: length },
    })
  }

  /**
   * 重建视图状态但复用同一个 EditorView——DOM、焦点与滚动容器都保持不动。
   *
   * setState 会先跑一遍插件的 destroy()（DocView.destroy → 递归回收 widget，
   * TableWidget 挂在 document 上的监听随之释放），再重建 DocView。
   * 视图销毁同样走这条路，所以 setState 不会比 destroy 多留下任何残留。
   */
  private applyState(state: EditorState): void {
    if (this.destroyed) return
    this.view.setState(state)
  }

  /**
   * 结束进行中的输入法组合。contenteditable 失焦会让浏览器派发 compositionend，
   * 已上屏的组合内容此前已由 CodeMirror 写入文档，所以这里只结束状态、不额外改正文。
   */
  private endComposition(): void {
    if (!this.composing && !this.view.compositionStarted) return
    this.view.contentDOM.blur()
    this.composing = false
  }

  private flushPendingDocument(): void {
    const pending = this.pending
    if (!pending) return
    this.pending = null
    const settings = this.pendingSettings
    this.pendingSettings = {}
    if (Object.keys(settings).length) this.settings = { ...this.settings, ...settings }
    const switching = pending.identity.sessionKey !== this.identity.sessionKey
    if (!switching && pending.doc === this.getDocument()) return
    this.applyDocument(pending.doc, pending.identity, switching)
  }

  // ---------------------------------------------------------------------------
  // 设置
  // ---------------------------------------------------------------------------

  getSettings(): EditorSettings {
    return { ...this.settings }
  }

  /**
   * 动态配置一律经 Compartment reconfigure，不重建 EditorView。
   * 切换只读、主题、平台与预览开关时，焦点、输入法状态与滚动都不会被打断。
   */
  updateSettings(patch: Partial<EditorSettings>): void {
    if (this.destroyed) return
    const previous = this.settings
    const next: EditorSettings = { ...previous, ...patch }
    this.settings = next
    const effects = []
    if (next.readOnly !== previous.readOnly) {
      effects.push(this.compartments.editable.reconfigure(editableExtension(next.readOnly)))
    }
    if (next.theme !== previous.theme) {
      effects.push(this.compartments.theme.reconfigure(themeExtension(next.theme)))
    }
    // 平台 / 预览 / 表格的扩展由上层工厂产出（实时预览还绑定 assetScope），
    // 只有相关项真的变了才重配置，避免每次 settings 更新都白跑一次语法与装饰重建。
    // readOnly 也算在内：移动端链接点按的拦截器（onLinkTap）只在可写时注册，
    // 锁屏切只读后若不带它重配置，点链接仍会弹「编辑 / 移除」菜单。
    const factoryChanged = next.platform !== previous.platform
      || next.assetScope !== previous.assetScope
      || next.livePreview !== previous.livePreview
      || next.tableEditing !== previous.tableEditing
      || next.readOnly !== previous.readOnly
    if (factoryChanged) {
      effects.push(this.compartments.platform.reconfigure(this.options.platformExtensions(this.extensionContext())))
      effects.push(this.compartments.livePreview.reconfigure(this.options.livePreviewExtensions(this.extensionContext())))
      effects.push(this.compartments.tableEditing.reconfigure(this.options.tableEditingExtensions(this.extensionContext())))
    }
    if (effects.length) this.view.dispatch({ effects })
  }

  // ---------------------------------------------------------------------------
  // 焦点 / 选区 / 滚动
  // ---------------------------------------------------------------------------

  focus(): void {
    if (!this.destroyed) this.view.focus()
  }

  hasFocus(): boolean {
    return this.view.hasFocus
  }

  isComposing(): boolean {
    return this.composing
  }

  getSelection(): EditorSelectionSnapshot {
    return this.readSelection(this.view.state)
  }

  setSelection(anchor: number, head = anchor): void {
    if (this.destroyed) return
    this.view.dispatch({ selection: clampSelection(anchor, head, this.view.state.doc.length) })
  }

  /** 与 setSelection 的区别：这是「导航到某处」，因此带滚动定位。 */
  revealRange(anchor: number, head = anchor, options: { focus?: boolean; y?: "center" | "end" | "start" } = {}): void {
    if (this.destroyed) return
    const length = this.view.state.doc.length
    this.view.dispatch({
      effects: EditorView.scrollIntoView(clampPosition(head, length), { y: options.y ?? "center" }),
      selection: clampSelection(anchor, head, length),
    })
    if (options.focus) this.view.focus()
  }

  revealLine(line: number, options: { focus?: boolean; y?: "center" | "end" | "start" } = {}): void {
    if (this.destroyed) return
    const target = this.view.state.doc.line(clampLine(line, this.view.state))
    this.revealRange(target.from, target.from, options)
  }

  // ---------------------------------------------------------------------------
  // 命令
  // ---------------------------------------------------------------------------

  /**
   * 类型化命令入口。通用能力从这里进入；依赖表格单元格、链接面板等 UI 现场的操作
   * 暂留在 MarkdownEditorHandle 兼容层，后续阶段再迁入。
   */
  dispatchCommand<K extends EditorCommand["type"]>(
    command: Extract<EditorCommand, { type: K }>,
  ): EditorCommandResult[K] {
    // 实现签名放宽到联合类型：泛型 K 无法在 switch 里收窄，
    // 这里做一次实现级断言，对外仍由泛型保证类型正确。
    return this.runCommand(command as EditorCommand) as EditorCommandResult[K]
  }

  private runCommand(command: EditorCommand): unknown {
    switch (command.type) {
      case "history.undo":
        this.undo()
        return undefined
      case "history.redo":
        this.redo()
        return undefined
      case "selection.all":
        if (this.destroyed) return undefined
        this.view.dispatch({ selection: { anchor: 0, head: this.view.state.doc.length } })
        this.view.focus()
        return undefined
      case "selection.collapse":
        if (this.destroyed) return undefined
        if (!this.view.state.selection.main.empty) {
          // 不抢焦点：调用方（点空白、点标题输入框）刚把焦点交出去，抢回来会立刻夺走。
          this.view.dispatch({ selection: { anchor: this.view.state.selection.main.head } })
        }
        return undefined
      case "navigation.revealLine":
        if (this.destroyed) return undefined
        this.revealLine(command.line, { focus: true })
        return undefined
      case "navigation.scrollLineToTop":
        // 不动选区也不抢焦点：这是切换视图时的对位，手机上抢焦点会顺带把键盘顶起来。
        // 销毁后返回 false 而非 undefined：调用方按 `=== true` 判定对位是否成功，
        // 返回类型既然声明为 boolean，就不能在这条路径上漏出 undefined。
        if (this.destroyed) return false
        this.revealLine(command.line, { y: "start" })
        return true
      default:
        // 穷尽性检查：新增命令类型却忘了实现时，这里会变成编译错误，
        // 而不是留到运行时由上一层拿到一个与声明不符的返回值。
        return assertNever(command)
    }
  }

  undo(): void {
    if (this.destroyed || this.view.state.readOnly) return
    undoCommand(this.view)
    this.view.focus()
  }

  redo(): void {
    if (this.destroyed || this.view.state.readOnly) return
    redoCommand(this.view)
    this.view.focus()
  }

  /** 定向派发事务。组合期间拒绝，避免外部改写打断正在拼的中文。 */
  dispatch(spec: Parameters<EditorView["dispatch"]>[0]): boolean {
    if (this.destroyed || this.composing) return false
    this.view.dispatch(spec)
    return true
  }

  getView(): EditorView {
    return this.view
  }

  getState(): EditorState {
    return this.view.state
  }

  // ---------------------------------------------------------------------------
  // 事件
  // ---------------------------------------------------------------------------

  on<K extends EditorEventType>(type: K, listener: EditorEventListener<K>): () => void {
    return this.events.on(type, listener)
  }

  /** 判定事件是否仍属于当前笔记。宿主用它在异步回调里做迟到结果守卫。 */
  owns(event: { identity: EditorDocumentIdentity }): boolean {
    return event.identity.sessionKey === this.identity.sessionKey
  }

  /**
   * 由上层 updateListener 转发。事件外发统一在这里判定文档身份，
   * 上层不需要自己比较 sessionKey。
   */
  notifyViewUpdate(update: Parameters<Parameters<typeof EditorView.updateListener.of>[0]>[0]): void {
    if (this.destroyed || this.suppressEvents) return
    const external = update.transactions.some((transaction) => transaction.annotation(externalDocumentChange))
    if (update.docChanged) {
      // 序列化只做一次：这里算出的字符串既发事件、也留作下次回传的引用短路基准。
      // 宿主把同一份字符串经 value 传回时，updateDocument 因此不必再序列化一遍全文。
      const doc = update.state.doc.toString()
      this.lastKnownDoc = doc
      this.events.emit("documentChange", {
        composing: this.composing,
        doc,
        external,
        identity: this.identity,
        update,
      })
    }
    if (update.selectionSet || update.docChanged) {
      const selection = this.readSelection(update.state)
      this.events.emit("selectionChange", {
        hasSelection: selection.anchor !== selection.head,
        identity: this.identity,
        selection,
      })
    }
    // 适配层订阅它同步「当前是否在编辑表格单元格」，因此它必须保留外发。
    if (update.focusChanged) {
      this.events.emit("focusChange", { focused: update.view.hasFocus, identity: this.identity })
    }
  }

  // ---------------------------------------------------------------------------
  // 销毁
  // ---------------------------------------------------------------------------

  destroy(): void {
    if (this.destroyed) return
    this.rememberSnapshot(this.identity)
    this.destroyed = true
    this.detachDomListeners()
    this.events.clear()
    this.view.destroy()
  }

  // ---------------------------------------------------------------------------
  // 内部
  // ---------------------------------------------------------------------------

  private extensionContext() {
    return { compartments: this.compartments, settings: this.settings }
  }

  private stateOptions(doc: string, initialState?: EditorStateOptions["initialState"]): EditorStateOptions {
    return {
      behaviorExtensions: this.options.buildBehaviorExtensions(this),
      compartments: this.compartments,
      doc,
      initialState,
      languageExtensions: this.options.languageExtensions,
      livePreviewExtensions: this.options.livePreviewExtensions,
      platformExtensions: this.options.platformExtensions,
      settings: this.settings,
      tableEditingExtensions: this.options.tableEditingExtensions,
    }
  }

  private readSelection(state: EditorState): EditorSelectionSnapshot {
    const range = state.selection.main
    const line = state.doc.lineAt(range.head)
    return { anchor: range.anchor, column: range.head - line.from + 1, head: range.head, line: line.number }
  }

  private rememberSnapshot(identity: EditorDocumentIdentity): void {
    if (!identity.sessionKey) return
    this.options.sessionStore.write(identity.sessionKey, {
      doc: this.getDocument(),
      fields: this.options.sessionFields,
      json: this.view.state.toJSON(this.options.sessionFields as never),
      selection: this.readSelection(this.view.state),
      updatedAt: Date.now(),
    })
  }

  /**
   * 组合态只做内部状态，不外发事件：宿主需要的两件事各有更直接的通道——
   * 「现在能不能改正文」由 updateDocument 自己按 composing 分流，
   * 「组合期间不打断」由挂起 + flushPendingDocument 在 compositionend 落地。
   * 事件表里留一个没有订阅方的 compositionChange 只会让人以为外部已经能感知组合态。
   */
  private attachDomListeners(): void {
    const contentDOM = this.view.contentDOM
    const onCompositionStart = () => {
      this.composing = true
    }
    const onCompositionEnd = () => {
      this.composing = false
      // 组合结束后补上挂起的外部回写——这正是「外部更新不覆盖中文输入」的落点。
      if (this.pending) this.flushPendingDocument()
    }
    contentDOM.addEventListener("compositionstart", onCompositionStart)
    contentDOM.addEventListener("compositionend", onCompositionEnd)
    this.detachDomListeners = () => {
      contentDOM.removeEventListener("compositionstart", onCompositionStart)
      contentDOM.removeEventListener("compositionend", onCompositionEnd)
    }
  }
}

/** 穷尽性检查。走到这里说明有命令类型漏了实现，交给编译器报错。 */
function assertNever(value: never): never {
  throw new Error(`未实现的编辑器命令: ${JSON.stringify(value)}`)
}

function clampPosition(position: number, length: number): number {
  if (!Number.isFinite(position)) return 0
  return Math.max(0, Math.min(Math.round(position), length))
}

function clampLine(line: number, state: EditorState): number {
  if (!Number.isFinite(line)) return 1
  return Math.max(1, Math.min(Math.round(line), state.doc.lines))
}

function clampSelection(anchor: number, head: number, length: number) {
  return { anchor: clampPosition(anchor, length), head: clampPosition(head, length) }
}
