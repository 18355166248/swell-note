type Prepare = (reason: "background" | "close") => void
const preparations = new Set<Prepare>()
const saves = new Set<() => Promise<void>>()
let pending = Promise.resolve()

export function registerSavePreparation(prepare: Prepare) {
  preparations.add(prepare)
  return () => { preparations.delete(prepare) }
}
export function registerLifecycleSave(save: () => Promise<void>) {
  saves.add(save)
  return () => { saves.delete(save) }
}
export async function flushLifecycleSave(reason: "background" | "close") {
  // 先捕获编辑器最后的单元格输入，再启动保存；关闭时任何失败都应阻止窗口退出。
  for (const prepare of preparations) prepare(reason)
  // 后台与窗口关闭可能紧邻触发，串行刷新快照，避免较旧快照在新快照之后落盘。
  const handlers = [...saves]
  const current = pending.catch(() => undefined).then(() => Promise.all(handlers.map((save) => save()))).then(() => undefined)
  pending = current
  await current
}
