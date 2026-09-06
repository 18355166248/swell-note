import { historyField } from "@codemirror/commands"
import type { EditorState } from "@codemirror/state"

const sessions = new Map<string, EditorState>()
export const sessionFields = { history: historyField }

// 内存中保留最近 20 篇的状态引用，避免每次按键序列化全文；重新挂载时才还原当前扩展下的历史。
export function rememberEditorSession(key: string | undefined, state: EditorState) {
  if (!key) return
  sessions.delete(key)
  sessions.set(key, state)
  if (sessions.size > 20) sessions.delete(sessions.keys().next().value!)
}
export function restoreEditorSession(key: string | undefined, value: string) {
  const state = key ? sessions.get(key) : undefined
  // 外部同步或恢复版本已改变正文时，不能把旧内容和撤销栈覆盖回来。
  return state?.doc.toString() === value ? { json: state.toJSON(sessionFields), fields: sessionFields } : undefined
}
