import { expect, it } from "vitest"
import { prepareOfflineNote, type OfflineAssetResult } from "./prepare-offline-note"
it("去重并跳过网址/笔记，失败不阻止后续附件；停止后不发起新请求", async () => {
  const results: OfflineAssetResult[] = [], requested: string[] = []
  const content = "![a](a.png)\n[a](a.png)\n[pdf](b.pdf)\n![c](c.png)\n[note](n.md)\n[web](https://x.test/a.png)"
  await prepareOfflineNote(content, async (source) => {
    requested.push(source)
    if (source === "b.pdf") throw new Error("缺失")
    return { data: new Uint8Array([1, 2]) }
  }, (result) => results.push(result), () => true)
  expect(requested).toEqual(["a.png", "b.pdf", "c.png"])
  expect(results[1].error).toBe("缺失")
  expect(results[2].bytes).toBe(2)
  requested.length = 0
  let current = true
  await prepareOfflineNote(content, async (source) => { requested.push(source); current = false; return { data: new Uint8Array() } }, () => {}, () => current)
  expect(requested).toEqual(["a.png"])
})
