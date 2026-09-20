import type { StateField } from "@codemirror/state"

import type { EditorSelectionSnapshot } from "./editor-types"

/**
 * 需要随会话一起序列化的字段（当前只有历史栈）。类型必须是 CodeMirror
 * 认可的 StateField，否则 toJSON / fromJSON 无法还原。
 */
export type EditorSessionFields = Record<string, StateField<unknown>>

/**
 * 一个笔记的编辑会话快照。
 *
 * `doc` 是必填的校验基准：外部同步、版本恢复或远端合并改过正文后，
 * 旧快照里的撤销栈对应的是一份并不存在的历史，此时必须整份丢弃。
 *
 * 快照刻意不含滚动位置：滚动容器归工作区所有，阅读位置的记录与恢复由
 * noteEditorScrollMemory 按「缓存库:笔记ID」完成。这里再存一份只会有第二个
 * 事实来源，且没有任何路径写它。
 */
export type EditorSessionSnapshot = {
  json: unknown
  fields: EditorSessionFields
  doc: string
  selection: EditorSelectionSnapshot
  updatedAt: number
}

/**
 * 会话存储接口。core 只依赖这个接口，具体落在内存还是别处由上层决定。
 *
 * 快照必须跨「编辑器卸载」存活，否则「切到阅读态再切回来」会丢掉撤销历史——
 * 改造前由模块级 Map 承担这件事，行为保持不变。
 */
export type EditorSessionStore = {
  read(sessionKey: string): EditorSessionSnapshot | undefined
  write(sessionKey: string, snapshot: EditorSessionSnapshot): void
  forget(sessionKey: string): void
}

export function createMemorySessionStore(limit = 20): EditorSessionStore {
  const sessions = new Map<string, EditorSessionSnapshot>()
  return {
    read: (sessionKey) => sessions.get(sessionKey),
    write(sessionKey, snapshot) {
      // 重新插入以保证 LRU 顺序：最近使用的排在最后，淘汰时先丢最旧的。
      sessions.delete(sessionKey)
      sessions.set(sessionKey, snapshot)
      // 上限与改造前一致（最近 20 篇）。每份快照持有整棵状态，不能无限增长。
      if (sessions.size > limit) sessions.delete(sessions.keys().next().value!)
    },
    forget(sessionKey) {
      sessions.delete(sessionKey)
    },
  }
}
