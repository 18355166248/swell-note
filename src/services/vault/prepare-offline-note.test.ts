import { expect, it } from "vitest"
import { prepareOfflineNote, type OfflineAssetResult } from "./prepare-offline-note"
it("准备引用式和含空格附件，忽略代码示例、未使用定义、网页与笔记", async () => {
  const requested: string[] = []
  const content = '![图][PIC]\n[资料][]\n[shortcut]\n![直接](<folder/a b.png>)\n\n[PIC]: <folder/a b.png> "说明"\n[pic]: wrong.png\n[资料]: docs/a.pdf\n[shortcut]: movie.mp4\n[unused]: unused.pdf\n\n`![假图](fake.png)`\n```md\n![[fake.pdf]]\n```'
  await prepareOfflineNote(content, async (source) => { requested.push(source); return { data: new Uint8Array([1]) } }, () => {}, () => true)
  expect(requested).toEqual(["folder/a b.png", "docs/a.pdf", "movie.mp4"])
})
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
