import { expect, type Locator, type Page } from "@playwright/test"

export async function selectRadix(page: Page, trigger: Locator, label: string) {
  await trigger.click()
  const content = page.locator('[data-slot="select-content"]:visible')
  await expect(content).toHaveCount(1)
  await content.getByRole("option", { name: label, exact: true }).click()
  await expect(content).toHaveCount(0)
  await expect(trigger).toHaveText(label)
}
