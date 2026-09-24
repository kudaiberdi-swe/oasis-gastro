import { officeNavigation } from "../../src/office/model/navigation"
import { expect, test } from "../fixtures"

// Walks every office section in the shell harness (/dev/office), so it runs without an office
// account: each item opens its page with the right title, and nothing throws.
test("every office section opens with its title", async ({ page, surface }) => {
  test.skip(surface !== "office", "office surface only")
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))

  for (const group of officeNavigation) {
    for (const item of group.items) {
      if (item.kind === "link") continue
      await page.goto(`/dev/office/${item.id}`)
      await expect(page.getByRole("heading", { level: 1, name: item.label })).toBeVisible()
    }
  }
  expect(errors).toEqual([])
})

test("sidebar search finds documents by description", async ({ page, surface }) => {
  test.skip(surface !== "office", "office surface only")
  await page.goto("/dev/office/stock")
  await page.getByRole("searchbox", { name: "Поиск по разделам" }).fill("накладн")
  await expect(page.getByRole("link", { name: /Расходные накладные/ })).toBeVisible()
  await expect(page.getByRole("link", { name: /Номенклатура/ })).toHaveCount(0)
})

test("the active section is marked in the sidebar", async ({ page, surface }) => {
  test.skip(surface !== "office", "office surface only")
  await page.goto("/dev/office/stock")
  await expect(page.getByRole("link", { name: "Остатки", exact: true })).toHaveAttribute("aria-current", "page")
})
