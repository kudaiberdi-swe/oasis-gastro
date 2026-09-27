import { mkdirSync } from "node:fs"
import path from "node:path"

import type { Page } from "@playwright/test"

import { expect, loginPos, posCredentials, test } from "../fixtures"

// Step-by-step screenshots for the project video (docs/11-VIDEO-BRIEF.md §5): walks the real cashier and
// kitchen screens on the seeded dev deployment under the e2e cashier and writes one screenshot per step to
// reference/video-assets/<theme>/ (gitignored). Run: npm run video:capture.
// Scenes that fail are logged and skipped, so one missing element never loses the rest of the footage.
test.skip(!process.env.VIDEO, "run with npm run video:capture")

const OUT_ROOT = path.resolve("reference/video-assets")

async function scene(label: string, run: () => Promise<void>) {
  try {
    await run()
  } catch (error) {
    console.warn(`[video] scene «${label}» skipped: ${(error as Error).message.split("\n")[0]}`)
  }
}

// The language link is named in the current interface language: «Язык интерфейса» / «Интерфейс тілі».
const LANGUAGE_SWITCH = { name: /^(Язык интерфейса|Интерфейс тілі)$/ }

async function addDishes(page: Page, count: number) {
  const dishes = page.getByRole("region", { name: "Меню" }).locator("button:enabled").filter({ hasText: /₸/ })
  for (let index = 0; index < count; index += 1) await dishes.nth(index).click()
}

async function openCheck(page: Page) {
  await page.getByRole("button", { name: /^Зал · \d+ открыто/ }).click()
  const hall = page.getByRole("dialog", { name: "Зал" })
  const free = hall.getByRole("button", { name: /: свободен/ })
  if (await free.count()) await free.first().click()
  else await hall.getByRole("button", { name: /Без стола/ }).click()
}

test("video screenshots: cashier and kitchen", async ({ page, surface, theme }) => {
  const credentials = posCredentials()
  test.skip(!credentials, "set E2E_POS_TERMINAL, E2E_POS_CODE and E2E_POS_PIN (bash scripts/e2e-pos.sh)")
  test.skip(surface !== "pos", "pos surface only")
  test.setTimeout(240_000)

  const out = path.join(OUT_ROOT, theme)
  mkdirSync(out, { recursive: true })
  const shot = async (name: string) => {
    await page.screenshot({ path: path.join(out, `${name}.png`), animations: "disabled" })
  }

  // A failed step gives up after 15 s instead of eating the whole test timeout.
  page.setDefaultTimeout(15_000)
  await page.goto(`/pos?terminal=${credentials!.terminal}`)
  await expect(page.getByRole("status", { name: /^Код сотрудника: введено 0/ })).toBeVisible()
  await scene("login", () => shot("01-login"))
  await scene("login-kk", async () => {
    await page.getByRole("button", LANGUAGE_SWITCH).click()
    await expect(page.getByRole("heading", { name: "Кассаға кіру" })).toBeVisible()
    await shot("02-login-kk")
    await page.getByRole("button", LANGUAGE_SWITCH).click()
    await expect(page.getByRole("heading", { name: "Вход в кассу" })).toBeVisible()
  })
  // Sign in in Russian whatever the scene above left behind (loginPos waits for the Russian pad label).
  if (await page.getByRole("heading", { name: "Кассаға кіру" }).isVisible()) await page.getByRole("button", LANGUAGE_SWITCH).click()
  await expect(page.getByRole("heading", { name: "Вход в кассу" })).toBeVisible()

  await loginPos(page, credentials!.code, credentials!.pin)
  const openShift = page.getByRole("dialog", { name: /Открытие смены/ })
  const hallButton = page.getByRole("button", { name: /^Зал · \d+ открыто/ })
  await expect(openShift.or(hallButton)).toBeVisible()
  if (await openShift.isVisible()) {
    await scene("open-shift", () => shot("03-open-shift"))
    await openShift.getByRole("button", { name: /Открыть смену/ }).click()
    await expect(openShift).toBeHidden()
  }

  await scene("floor", async () => {
    await hallButton.click()
    await expect(page.getByRole("dialog", { name: "Зал" })).toBeVisible()
    await shot("04-floor")
    await page.keyboard.press("Escape")
  })

  // Table 1: three dishes, sent to the kitchen — it stays open for the floor and kitchen shots.
  await scene("order", async () => {
    await openCheck(page)
    await addDishes(page, 3)
    await shot("05-order")
    await page.getByRole("button", { name: "На кухню" }).click()
    await page.waitForTimeout(800)
    await shot("06-order-sent")
  })

  // Table 2: two dishes, paid in cash.
  await scene("payment", async () => {
    await openCheck(page)
    await addDishes(page, 2)
    await page.getByRole("button", { name: /Оплатить/ }).click()
    const payment = page.getByRole("dialog", { name: /Оплата заказа/ })
    await expect(payment).toBeVisible()
    await shot("07-payment")
    await payment.getByRole("radio", { name: /Наличн/ }).click()
    await payment.getByRole("button", { name: "Без сдачи" }).click()
    await shot("08-payment-cash")
    await payment.getByRole("button", { name: /^Подтвердить/ }).click()
    const paid = page.getByRole("dialog", { name: /Оплачено/ })
    await expect(paid).toBeVisible()
    await shot("09-paid")
    await paid.getByRole("button", { name: "Новый стол" }).click()
  })

  await scene("floor-busy", async () => {
    await hallButton.click()
    await expect(page.getByRole("dialog", { name: "Зал" })).toBeVisible()
    await shot("10-floor-busy")
    await page.keyboard.press("Escape")
  })

  await scene("workspace-kk", async () => {
    await page.getByRole("button", { name: /^Профиль: / }).click()
    const profile = page.getByRole("dialog", { name: /Профиль сотрудника/ })
    await profile.getByText("Қазақша", { exact: true }).click()
    await page.keyboard.press("Escape")
    await page.waitForTimeout(400)
    await shot("11-workspace-kk")
    await page.getByRole("button", { name: /^Профиль/ }).first().click()
    await page.getByRole("dialog").getByText("Русский", { exact: true }).click()
    await page.keyboard.press("Escape")
  })

  await scene("offline", async () => {
    await page.context().setOffline(true)
    await expect(page.getByText(/Нет связи с сервером/)).toBeVisible({ timeout: 20_000 })
    await shot("12-offline")
    await page.context().setOffline(false)
    await expect(page.getByText(/Нет связи с сервером/)).toBeHidden({ timeout: 30_000 })
  })

  await scene("shift-blind", async () => {
    await page.getByRole("button", { name: "Главное меню" }).click()
    await page.getByRole("button", { name: /Текущая смена/ }).click()
    await page.waitForTimeout(400)
    await shot("13-shift-summary")
    await page.getByRole("tab", { name: "Закрыть смену" }).click()
    await page.waitForTimeout(400)
    await shot("14-shift-close-blind")
    await page.keyboard.press("Escape")
  })

  // The kitchen board in a second window, with table 1's ticket on it.
  await scene("kitchen", async () => {
    const kitchen = await page.context().newPage()
    kitchen.setDefaultTimeout(15_000)
    await kitchen.setViewportSize({ width: 1440, height: 900 })
    await kitchen.goto(`/kitchen?terminal=${credentials!.terminal}`)
    await loginPos(kitchen, credentials!.code, credentials!.pin)
    await expect(kitchen.getByRole("heading", { level: 1, name: "Заказы кухни" })).toBeVisible()
    await kitchen.waitForTimeout(800)
    await kitchen.screenshot({ path: path.join(out, "15-kitchen.png"), animations: "disabled" })
    const start = kitchen.getByRole("button", { name: "Начать готовить" }).first()
    if (await start.count()) {
      await start.click()
      await kitchen.waitForTimeout(600)
      await kitchen.screenshot({ path: path.join(out, "16-kitchen-cooking.png"), animations: "disabled" })
    }
    await kitchen.close()
  })
})
