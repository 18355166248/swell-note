import { expect, test, type Page } from "@playwright/test"

async function seed(page: Page) {
  await page.goto("/#/notes/view/all")
  await page.evaluate(async () => {
    const modulePath = "/src/services/cache/vault-cache.ts"
    const { saveVaultCache } = await import(/* @vite-ignore */ modulePath)
    const notes = ["甲", "乙", "丙"].map((name) => ({
      id: `webdav:/SwellNote/${name}.md`, remotePath: `/SwellNote/${name}.md`, title: name,
      content: `---\ntags: [原标签]\n---\n# ${name}\n正文 苹果`, contentLoaded: true,
      baseContent: `---\ntags: [原标签]\n---\n# ${name}\n正文 苹果`,
      source: "webdav", syncStatus: "synced", readOnly: false, starred: false,
      preview: "正文", tags: ["原标签"], updatedAt: "刚刚", folder: "根目录",
    }))
    await saveVaultCache({ id: "batch-test", label: "批量测试库", activeNoteId: notes[0].id,
      notes, directories: ["目标"], sourceKind: "webdav", savedAt: Date.now() })
  })
  await page.reload()
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const modulePath = "/src/services/cache/vault-cache.ts"
    return (await import(/* @vite-ignore */ modulePath)).loadVaultCache("batch-test", { hydrate: "all" })
  })
}
async function openBatch(page: Page) {
  await page.getByRole("button", { name: "批量整理笔记" }).filter({ visible: true }).click()
  return page.getByRole("dialog", { name: "批量整理笔记" })
}
test("批量标签、移动、删除持久化，未选笔记保留", async ({ page }, testInfo) => {
  await seed(page)
  let dialog = await openBatch(page)
  await dialog.getByRole("checkbox", { name: "甲 根目录" }).check()
  await dialog.getByRole("checkbox", { name: "乙 根目录" }).check()
  await dialog.getByLabel("批量操作", { exact: true }).selectOption("add-tags")
  await dialog.getByLabel("批量标签").fill("项目, 待处理")
  await page.screenshot({ path: testInfo.outputPath("batch-dialog.png") })
  await dialog.getByRole("button", { name: "执行（2）" }).click()
  await expect(dialog).toContainText("已完成 2 / 2 篇")
  await dialog.getByRole("button", { name: "完成", exact: true }).click()
  let snapshot = await stored(page)
  expect(snapshot.notes.find((note: { title: string }) => note.title === "甲").tags).toEqual(["原标签", "项目", "待处理"])
  expect(snapshot.notes.find((note: { title: string }) => note.title === "乙").baseContent).toContain("# 乙")
  expect(snapshot.notes.find((note: { title: string }) => note.title === "丙").tags).toEqual(["原标签"])
  await page.reload()
  dialog = await openBatch(page)
  await dialog.getByRole("checkbox", { name: "甲 根目录" }).check()
  await dialog.getByRole("checkbox", { name: "乙 根目录" }).check()
  await dialog.getByLabel("批量操作", { exact: true }).selectOption("move")
  await dialog.getByLabel("批量移动目标目录").selectOption("目标")
  await dialog.getByRole("button", { name: "执行（2）" }).click()
  await expect(dialog).toContainText("已完成 2 / 2 篇")
  await dialog.getByRole("button", { name: "完成", exact: true }).click()
  snapshot = await stored(page)
  expect(snapshot.notes.find((note: { title: string }) => note.title === "甲")).toMatchObject({ remotePath: "/SwellNote/目标/甲.md", previousRemotePath: "/SwellNote/甲.md", pendingOperation: "move" })
  await page.reload()
  dialog = await openBatch(page)
  await dialog.getByRole("checkbox", { name: "甲 目标" }).check()
  await dialog.getByLabel("批量操作", { exact: true }).selectOption("delete")
  await dialog.getByRole("button", { name: "执行（1）" }).click()
  await expect(dialog).toContainText("确认将所选 1 篇")
  expect((await stored(page)).trash).toHaveLength(0)
  await dialog.getByRole("button", { name: "确认移入回收站（1）" }).click()
  await expect(dialog).toContainText("已完成 1 / 1 篇")
  snapshot = await stored(page)
  expect(snapshot.trash).toHaveLength(1)
  expect(snapshot.notes.find((note: { title: string }) => note.title === "甲")).toMatchObject({ pendingOperation: "delete", operationBeforeDelete: "move" })
  await page.reload()
  await expect(page.locator(".note-list-row:visible")).toHaveCount(2)
})
