import { expect, it } from "vitest"
import { flushLifecycleSave, registerLifecycleSave, registerSavePreparation } from "./save-lifecycle"

it("先提交最后输入，再等待落盘；卸载的编辑器不再参与", async () => {
  const calls: string[] = []
  let finish!: () => void
  const stopPrepare = registerSavePreparation(() => { calls.push("prepare") })
  const stopSave = registerLifecycleSave(() => new Promise<void>((resolve) => { calls.push("save"); finish = resolve }))
  try {
    let done = false
    const result = flushLifecycleSave("close").then(() => { done = true })
    await Promise.resolve(); await Promise.resolve()
    expect(calls).toEqual(["prepare", "save"])
    expect(done).toBe(false)
    finish()
    await result
    expect(done).toBe(true)
  } finally { stopPrepare(); stopSave() }
  await flushLifecycleSave("close")
  expect(calls).toHaveLength(2)
})

it("组合输入与保存错误传播给关闭入口，不能当作成功退出", async () => {
  const stopPrepare = registerSavePreparation(() => { throw new Error("候选词") })
  await expect(flushLifecycleSave("close")).rejects.toThrow("候选词")
  stopPrepare()
  const stopSave = registerLifecycleSave(async () => { throw new Error("磁盘错误") })
  try { await expect(flushLifecycleSave("close")).rejects.toThrow("磁盘错误") } finally { stopSave() }
})
