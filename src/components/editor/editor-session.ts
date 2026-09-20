import { historyField } from "@codemirror/commands"

import { createMemorySessionStore } from "./core/editor-session-store"

export const sessionFields = { history: historyField }

/**
 * 进程内共享的会话快照存储，按 sessionKey 隔离。
 *
 * 快照必须跨编辑器卸载存活：切到阅读态再切回来、移动端路由保活切换，
 * 都要求撤销历史与选区原样还在（滚动位置不在此列，由工作区的 noteEditorScrollMemory
 * 按「缓存库:笔记ID」管理）。改造前由模块级 Map 承担这件事，现在由 core 的存储实现持有。
 *
 * 快照的读写全部由 EditorControl 负责（rememberSnapshot / buildRestoredState），
 * 这里只提供那份共享实例，不再对外暴露独立的存取函数——两条路径并存会让
 * 「谁写的快照生效」变得不确定。
 */
export const editorSessionStore = createMemorySessionStore()
