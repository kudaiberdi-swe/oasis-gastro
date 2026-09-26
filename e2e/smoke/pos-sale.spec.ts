import { expect, loginPos, posCredentials, test } from "../fixtures"

// Smoke sale on a seeded dev deployment: terminal → PIN → shift → dish → cash → kitchen.
// Needs E2E_POS_TERMINAL / E2E_POS_CODE / E2E_POS_PIN (from `npm run seed:e2e`); skipped otherwise.
test("a cashier sells a dish for cash and the kitchen sees it", async ({ page, surface }) => {
  const credentials = posCredentials()
  test.skip(!credentials, "set E2E_POS_TERMINAL, E2E_POS_CODE and E2E_POS_PIN (npm run seed:e2e)")
  test.skip(surface !== "pos", "pos surface only")

  await page.goto(`/pos?terminal=${credentials!.terminal}`)
  await loginPos(page, credentials!.code, credentials!.pin)

  // After sign-in either the open-shift dialog or the workspace appears (the shift query is async).
  const openShift = page.getByRole("dialog", { name: /Открытие смены/ })
  // «Зал · N открыто» in the order panel opens the hall grid; «Без стола» starts a check with no table
  // (works with or without a floor plan on the seeded branch).
  const hall = page.getByRole("button", { name: /^Зал · \d+ открыто/ })
  await expect(openShift.or(hall)).toBeVisible()
  if (await openShift.isVisible()) {
    await openShift.getByRole("button", { name: /Открыть смену/ }).click()
    await expect(openShift).toBeHidden()
  }

  await hall.click()
  await page.getByRole("dialog", { name: "Зал" }).getByRole("button", { name: /Без стола/ }).click()
  // The first dish in the menu may be on the stop list («нет в наличии», disabled): take the first sellable one.
  await page.getByRole("region", { name: "Меню" }).locator("button:enabled").filter({ hasText: /₸/ }).first().click()
  await page.getByRole("button", { name: /Оплатить/ }).click()
  // With several payment methods none is preselected: the cashier picks cash explicitly.
  const payment = page.getByRole("dialog", { name: /Оплата заказа/ })
  await payment.getByRole("radio", { name: /Наличн/ }).click()
  await payment.getByRole("button", { name: "Без сдачи" }).click()
  await payment.getByRole("button", { name: /^Подтвердить/ }).click()
  // Success is a calm «Оплачено» screen; «Новый стол» closes it.
  const paid = page.getByRole("dialog", { name: /Оплачено/ })
  await expect(paid).toBeVisible()
  await paid.getByRole("button", { name: "Новый стол" }).click()
  await expect(paid).toBeHidden()

  await page.getByRole("button", { name: /Экран кухни/ }).click()
  await expect(page.getByText(/№\s*\d+/).first()).toBeVisible()
})
