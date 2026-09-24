import { expect, test } from "../fixtures"

// L-5: after a dialog closes, the very next click on a control that was under its overlay must work —
// the closing overlay may not keep catching pointers during its fade-out.
test("a click right after closing a dialog reaches the control underneath", async ({ page, surface }) => {
  test.skip(surface !== "pos", "one surface is enough")
  await page.goto("/dev/ui")
  await page.getByRole("button", { name: "Открыть диалог" }).click()
  await expect(page.getByRole("dialog", { name: "Скидка на чек" })).toBeVisible()

  await page.getByRole("dialog").getByRole("button", { name: "Отмена" }).click()
  // No waiting for the animation: click immediately.
  await page.getByRole("button", { name: "Тост", exact: true }).click({ timeout: 1000 })
  await expect(page.getByRole("status").filter({ hasText: "Чек отложен" })).toBeVisible()
})

test("Escape closes a dialog and the next click still works", async ({ page, surface }) => {
  test.skip(surface !== "pos", "one surface is enough")
  await page.goto("/dev/ui")
  await page.getByRole("button", { name: "Открыть диалог" }).click()
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Тост", exact: true }).click({ timeout: 1000 })
  await expect(page.getByRole("status").filter({ hasText: "Чек отложен" })).toBeVisible()
})
