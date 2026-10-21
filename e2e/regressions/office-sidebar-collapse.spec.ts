import type { Page } from "@playwright/test"

import { expect, test } from "../fixtures"

// fix-office-sidebar-collapse: in the wide office sidebar the group of the current page opens on entry and
// can then be closed (it used to reopen right away). Runs in the shell harness (/dev/office), no account.
const header = (page: Page, label: string) => page.getByRole("complementary", { name: "Навигация офиса" }).getByRole("button", { name: label, exact: true })

for (const { path, group, item } of [
  { path: "/dev/office/stock", group: "Товары и склады", item: "Остатки" },
  { path: "/dev/office/dashboard", group: "Главная", item: "Стартовая страница" },
]) {
  test(`the group of the current page closes and opens again: ${group}`, async ({ page, surface }) => {
    test.skip(surface !== "office", "office surface only")
    await page.goto(path)
    const link = page.getByRole("link", { name: item, exact: true })
    await expect(header(page, group)).toHaveAttribute("aria-expanded", "true")
    await expect(link).toHaveAttribute("aria-current", "page")

    await header(page, group).click()
    await expect(header(page, group)).toHaveAttribute("aria-expanded", "false")
    await expect(link).toHaveCount(0)

    await header(page, group).click()
    await expect(header(page, group)).toHaveAttribute("aria-expanded", "true")
    await expect(link).toBeVisible()
  })
}

test("Enter and Space toggle the group header «Главная»", async ({ page, surface }) => {
  test.skip(surface !== "office", "office surface only")
  await page.goto("/dev/office/dashboard")
  const home = header(page, "Главная")
  await expect(home).toHaveAttribute("aria-expanded", "true")
  await home.focus()
  await page.keyboard.press("Enter")
  await expect(home).toHaveAttribute("aria-expanded", "false")
  await expect(page.getByRole("link", { name: "Стартовая страница", exact: true })).toHaveCount(0)
  await page.keyboard.press("Space")
  await expect(home).toHaveAttribute("aria-expanded", "true")
  await expect(page.getByRole("link", { name: "Стартовая страница", exact: true })).toBeVisible()
})
