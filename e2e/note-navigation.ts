import { expect, type Page } from "@playwright/test"

export function currentWorkspace(page: Page) {
  return page.locator(".desktop-workspace:visible, .mobile-workspace:visible .mobile-edge-swipe-current")
}

export function currentNoteEditor(page: Page) {
  return currentWorkspace(page).locator(".cm-content")
}

export async function enterFirstNote(page: Page) {
  await expect(currentWorkspace(page)).toBeVisible()
  const mobile = page.locator(".mobile-workspace:visible")
  if (await mobile.count() === 0) return
  if (await mobile.getAttribute("data-screen") === "editor") {
    await expect(currentNoteEditor(page)).toBeVisible()
    return
  }
  if (await mobile.getAttribute("data-screen") === "library") {
    await currentWorkspace(page).getByRole("button", { name: /^测试 \d+$/ }).click()
    await expect(mobile).toHaveAttribute("data-screen", "notes")
  }
  await currentWorkspace(page).locator(".note-list-row").getByText("第一篇", { exact: true }).click()
  await expect(currentNoteEditor(page)).toBeVisible()
}

export async function noteList(page: Page) {
  const mobile = page.locator(".mobile-workspace:visible")
  if (await mobile.count()) {
    // 恢复副本会叠加正文页；每次返回等待 React 当前页完成切换。
    for (let depth = 0; depth < 4 && await mobile.getAttribute("data-screen") === "editor"; depth++) {
      const entry = currentWorkspace(page)
      const key = await entry.getAttribute("data-route-entry-key")
      if (!key) throw new Error("当前移动正文页缺少路由标识")
      await entry.getByRole("button", { name: /^返回/ }).click()
      await expect(currentWorkspace(page)).not.toHaveAttribute("data-route-entry-key", key)
    }
    if (await mobile.getAttribute("data-screen") === "library") {
      await currentWorkspace(page).getByRole("button", { name: /^测试 \d+$/ }).click()
    }
    await expect(mobile).toHaveAttribute("data-screen", "notes")
  }
  await expect(currentWorkspace(page).locator(".note-list-row").first()).toBeVisible()
  return currentWorkspace(page).locator(".note-list-row")
}

export async function switchNote(page: Page, title: string) {
  const rows = await noteList(page)
  await rows.getByText(title, { exact: true }).click()
  await expect(currentNoteEditor(page)).toBeVisible()
}
