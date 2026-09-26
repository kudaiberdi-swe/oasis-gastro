import { mkdirSync } from "node:fs"
import path from "node:path"

import AxeBuilder from "@axe-core/playwright"
import { test as base, expect, type Page } from "@playwright/test"

export type E2EOptions = { theme: "day" | "night"; surface: "pos" | "office" | "kitchen" }

const SCREENS_DIR = path.resolve("reference/app-screenshots/W0")

type Fixtures = {
  /** reference/app-screenshots/W0/<surface>/<name>-<theme>.png */
  snap: (name: string) => Promise<void>
  /** Serious and critical axe violations on the current page (color contrast included). */
  axeViolations: () => Promise<{ id: string; impact: string | null | undefined; targets: string[] }[]>
}

export const test = base.extend<E2EOptions & Fixtures>({
  theme: ["day", { option: true }],
  surface: ["pos", { option: true }],
  page: async ({ page, theme }, use) => {
    // Theme is applied before the app boots, the way a returning cashier's browser has it stored.
    await page.addInitScript((value) => {
      try {
        window.localStorage.setItem("sandyq-pos-theme", value)
      } catch {
        /* storage blocked */
      }
    }, theme)
    await use(page)
  },
  snap: async ({ page, theme, surface }, use) => {
    await use(async (name) => {
      const dir = path.join(SCREENS_DIR, surface)
      mkdirSync(dir, { recursive: true })
      await page.screenshot({ path: path.join(dir, `${name}-${theme}.png`), fullPage: true, animations: "disabled" })
    })
  },
  axeViolations: async ({ page }, use) => {
    await use(async () => {
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
      return results.violations
        .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
        .map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          targets: violation.nodes.map((node) => `${node.target.join(" ")} — ${(node.failureSummary ?? "").split("\n").slice(1, 2).join("").trim()}`),
        }))
    })
  },
})

export { expect }

/** Office sections are reached by the sidebar, exactly as a user would. */
export async function openSection(page: Page, label: string) {
  await page.getByRole("navigation").getByRole("link", { name: label, exact: true }).click()
  await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible()
}

/**
 * Cashier sign-in with credentials from the environment (E2E_POS_CODE / E2E_POS_PIN, from
 * `npm run seed:e2e` on a dev deployment). Never hard-coded.
 */
export async function loginPos(page: Page, code: string, pin: string) {
  // The POS route is a lazy chunk: keys typed before the pad mounts are lost, so wait for each pad.
  await expect(page.getByRole("status", { name: /^Код сотрудника: введено 0/ })).toBeVisible()
  await page.keyboard.type(code)
  await page.keyboard.press("Enter")
  await expect(page.getByRole("status", { name: /^PIN-код: введено 0/ })).toBeVisible()
  await page.keyboard.type(pin)
  await page.keyboard.press("Enter")
}

export const posCredentials = () => {
  const code = process.env.E2E_POS_CODE
  const pin = process.env.E2E_POS_PIN
  const terminal = process.env.E2E_POS_TERMINAL
  return code && pin && terminal ? { code, pin, terminal } : null
}

/** The terminal picker, even when the build has a default terminal (VITE_POS_TERMINAL_ID). */
export async function showTerminalPicker(page: Page) {
  await page.addInitScript(() => window.localStorage.removeItem("sandyq-pos-terminal"))
  await page.goto("/pos")
  const heading = page.getByRole("heading", { name: "Выберите рабочее место" })
  const change = page.getByRole("button", { name: "Сменить рабочее место" })
  await expect(heading.or(change)).toBeVisible()
  if (await change.isVisible()) await change.click()
  await expect(heading).toBeVisible()
}
