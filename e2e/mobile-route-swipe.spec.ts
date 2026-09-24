import { expect, test, type Locator } from "@playwright/test"

async function swipeFromLeft(surface: Locator) {
  await surface.evaluate((element) => {
    const send = (type: string, x: number) => element.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: 180,
      isPrimary: true,
      pointerId: 1,
      pointerType: "touch",
    }))
    send("pointerdown", 6)
    send("pointermove", 110)
    send("pointerup", 110)
  })
}

test.describe("移动端跨功能侧滑", () => {
  test.skip(({ isMobile }) => !isMobile)

  test("待办和设置首页右滑可以打开主导航", async ({ page }) => {
    for (const route of ["todos", "settings"]) {
      await page.goto(`/#/${route}`)
      const surface = page.locator(".mobile-route-swipe")
      await expect(surface).toBeVisible()
      await swipeFromLeft(surface)
      await expect(page.getByRole("dialog", { name: "主导航" })).toBeVisible()
      await page.getByRole("dialog", { name: "主导航" }).getByRole("button", { name: "关闭主导航" }).click()
    }
  })

  test("设置子页右滑露出设置首页并返回", async ({ page }) => {
    await page.goto("/#/settings")
    await page.getByRole("button", { name: /外观/ }).last().click()
    await expect(page).toHaveURL(/#\/settings\/appearance$/)
    const surface = page.locator(".mobile-route-swipe")
    await surface.evaluate((element) => {
      const send = (type: string, x: number) => element.dispatchEvent(new PointerEvent(type, {
        bubbles: true, clientX: x, clientY: 180, isPrimary: true, pointerId: 1, pointerType: "touch",
      }))
      send("pointerdown", 6)
      send("pointermove", 110)
    })
    await expect(surface).toHaveAttribute("data-edge-swipe-state", "dragging")
    await expect(surface.locator(".settings-swipe-preview")).toBeVisible()
    await surface.evaluate((element) => element.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true, clientX: 110, clientY: 180, isPrimary: true, pointerId: 1, pointerType: "touch",
    })))
    await expect(surface).toHaveAttribute("data-edge-swipe-state", "completing")
    await surface.locator(":scope > .mobile-edge-swipe-current").dispatchEvent("transitionend", { propertyName: "transform" })
    await expect(page).toHaveURL(/#\/settings$/)
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible()
  })
})
