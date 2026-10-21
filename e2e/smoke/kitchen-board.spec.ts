import { expect, loginPos, posCredentials, test } from "../fixtures"

// Kitchen screen on a seeded dev deployment (W1-KDS-02): terminal → PIN → full-screen board.
// Needs E2E_POS_TERMINAL / E2E_POS_CODE / E2E_POS_PIN (from `npm run seed:e2e`); skipped otherwise.
test("the kitchen signs in with a PIN and sees the three-column board", async ({ page, surface }) => {
  const credentials = posCredentials()
  test.skip(!credentials, "set E2E_POS_TERMINAL, E2E_POS_CODE and E2E_POS_PIN (npm run seed:e2e)")
  test.skip(surface !== "kitchen", "kitchen surface only")

  await page.goto(`/kitchen?terminal=${credentials!.terminal}`)
  await expect(page.getByText(/^Экран кухни/)).toBeVisible()
  await loginPos(page, credentials!.code, credentials!.pin)

  await expect(page.getByRole("heading", { level: 1, name: "Заказы кухни" })).toBeVisible()
  for (const column of ["Новые", "Готовятся", "Готово"]) {
    await expect(page.getByRole("region", { name: new RegExp(`^${column}`) })).toBeVisible()
  }
})
