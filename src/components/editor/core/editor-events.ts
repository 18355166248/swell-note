import type { ViewUpdate } from "@codemirror/view"

import type { EditorDocumentIdentity, EditorSelectionSnapshot } from "./editor-types"

// 编辑器对外只发事件，不主动做保存、路由或文件选择。
// 每个事件都带文档身份：宿主据此丢弃已经不属于当前笔记的迟到事件。

export type EditorDocumentChangeEvent = {
  identity: EditorDocumentIdentity
  doc: string
  /**
   * 由外部 updateDocument 引起（笔记切换、恢复版本、远端合并）。
   * 宿主据此跳过「用户输入」的副作用（历史快照、索引重建），避免回写被当成新输入。
   */
  external: boolean
  /** 变更发生在输入法组合期间。宿主可推迟落盘，但不得丢弃内容。 */
  composing: boolean
  /**
   * 本次变更对应的 CodeMirror ViewUpdate，仅用户输入路径携带（外部更新为 undefined）。
   * 沿用改造前 @uiw/react-codemirror 的 onChange(value, viewUpdate) 签名，
   * 使既有调用方拿到的第二个参数语义不变。
   */
  update?: ViewUpdate
}

export type EditorSelectionChangeEvent = {
  identity: EditorDocumentIdentity
  /** 空选区也上报（hasSelection 为 false），宿主据此收起选区操作条。 */
  selection: EditorSelectionSnapshot
  hasSelection: boolean
}

export type EditorFocusChangeEvent = {
  identity: EditorDocumentIdentity
  focused: boolean
}

/**
 * 会话切换完成。切换笔记用 `EditorView.setState()`，它绕过普通 transaction 路径、
 * 不会触发 `updateListener`，因此历史按钮、光标、格式高亮这些由 updateListener 驱动的
 * 派生状态在切换后不会自动刷新。宿主据此事件立即重读状态，不必等到下一次用户输入。
 */
export type EditorSessionChangeEvent = {
  identity: EditorDocumentIdentity
}

/**
 * 对外事件表。这里只列确有订阅方的事件。
 *
 * 滚动刻意不在其中：滚动容器由工作区持有（外层 ScrollArea），阅读位置的记录与
 * 恢复也由工作区的 noteEditorScrollMemory 按「缓存库:笔记ID」完成。core 再发一份
 * 自己的 scrollChange 不会有订阅方，只会让人以为滚动位置由编辑器负责保存。
 *
 * 格式状态同样不在此列：它由宿主注入的检测器在 updateListener 里就地产出并上报，
 * 走事件总线只会多一份没有订阅方的抽象（切换会话后的格式刷新由 sessionChange 承接）。
 */
export type EditorEventMap = {
  documentChange: EditorDocumentChangeEvent
  selectionChange: EditorSelectionChangeEvent
  focusChange: EditorFocusChangeEvent
  sessionChange: EditorSessionChangeEvent
}

export type EditorEventType = keyof EditorEventMap
export type EditorEventListener<K extends EditorEventType> = (event: EditorEventMap[K]) => void

/**
 * 极简类型化事件总线。刻意不引入第三方依赖：
 * 订阅数量是个位数，用 Map + Set 足够，且销毁时能一次性清空，不留悬挂监听。
 */
export class EditorEventBus {
  // Set 的元素类型必然是某一具体 K 的监听器，但总线内部无法表达这种相关性，
  // 这里按 unknown 存储，在 emit 处做一次显式转换。
  private listeners = new Map<EditorEventType, Set<(event: never) => void>>()

  on<K extends EditorEventType>(type: K, listener: EditorEventListener<K>): () => void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    const stored = listener as (event: never) => void
    set.add(stored)
    return () => { set.delete(stored) }
  }

  emit<K extends EditorEventType>(type: K, event: EditorEventMap[K]): void {
    const set = this.listeners.get(type)
    if (!set) return
    // 快照后遍历：监听器内部退订不会影响本次派发。
    for (const listener of [...set]) {
      try {
        ;(listener as (value: EditorEventMap[K]) => void)(event)
      } catch (error) {
        // 单个监听器抛错不能中断编辑循环，也不能让其余监听器收不到事件。
        console.error(`[editor] ${type} 监听器执行失败`, error)
      }
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}
