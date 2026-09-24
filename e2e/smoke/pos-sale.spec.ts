import { expect, loginPos, posCredentials, test } from "../fixtures"

// Smoke sale on a seeded dev deployment: terminal → PIN → shift → dish → cash → kitchen.
// Needs E2E_POS_TERMINAL / E2E_POS_CODE / E2E_POS_PIN (from `npm run seed:e2e`); skipped otherwise.
test("a cashier sells a dish for cash and the kitchen sees it", async ({ page, surface }) => {
  const credentials = posCredentials()
  test.skip(!credentials, "set E2E_POS_TERMINAL, E2E_POS_CODE and E2E_POS_PIN (npm run seed:e2e)")
  test.skip(surface !== "pos", "pos surface only")

  await page.goto(`/pos?terminal=${credentials!.terminal}`)
  await loginPos(page, credentials!.code, credentials!.pin)

  const openShift = page.getByRole("dialog", { name: /Открытие смены/ })
  if (await openShift.isVisible().catch(() => false)) {
    await openShift.getByRole("button", { name: /Открыть смену/ }).click()
  }

  await page.getByRole("button", { name: /Новый стол/ }).click()
  await page.getByRole("dialog", { name: /Новый стол/ }).getByRole("button", { name: "Открыть стол" }).click()
  await page.getByRole("button").filter({ hasText: /₸/ }).first().click()
  await page.getByRole("button", { name: /Оплатить/ }).click()
  const payment = page.getByRole("dialog")
  await payment.getByRole("button", { name: "Без сдачи" }).click()
  await payment.getByRole("button", { name: /Оплатить|Провести оплату/ }).click()
  await expect(payment).toBeHidden()

  await page.getByRole("button", { name: /Кухня/ }).click()
  await expect(page.getByText(/№\s*\d+/).first()).toBeVisible()
})
