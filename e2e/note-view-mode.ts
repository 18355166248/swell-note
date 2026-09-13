import { expect, type Page } from "@playwright/test"

function visibleNoteEditor(page: Page) {
  return page.locator(".note-editor:visible")
}

async function chooseViewAction(page: Page, name: string) {
  await visibleNoteEditor(page).getByRole("button", { name: "更多操作" }).click()
  await page.getByRole("menuitem", { name, exact: true }).click()
}

export async function useUnifiedCanvas(page: Page) {
  const editor = visibleNoteEditor(page)
  const mode = await editor.getAttribute("data-view-mode")
  if (mode === "unified") return
  await chooseViewAction(page, mode === "locked" ? "解除锁定，继续编辑" : "进入一体化编辑")
  await expect(editor).toHaveAttribute("data-view-mode", "unified")
  await expect(editor.locator(".cm-content")).toBeVisible()
}

export async function lockUnifiedCanvas(page: Page) {
  await useUnifiedCanvas(page)
  const editor = visibleNoteEditor(page)
  await chooseViewAction(page, "锁定为只读阅读")
  await expect(editor).toHaveAttribute("data-view-mode", "locked")
  await expect(editor.locator(".cm-content")).toHaveAttribute("contenteditable", "false")
}

export async function useCompatibilityPreview(page: Page) {
  const editor = visibleNoteEditor(page)
  if (await editor.getAttribute("data-view-mode") === "preview") return
  await chooseViewAction(page, "兼容阅读视图")
  await expect(editor).toHaveAttribute("data-view-mode", "preview")
  await expect(editor.locator(".markdown-preview")).toBeVisible()
}
