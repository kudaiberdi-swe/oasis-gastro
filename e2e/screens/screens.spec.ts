import { officeNavigation } from "../../frontend/app/office/model/navigation"
import { showTerminalPicker, test } from "../fixtures"

// Screenshot harness (npm run e2e:screens): W0 screens per surface and theme into
// reference/app-screenshots/W0/<surface>/<name>-<theme>.png, for scripts/compare-screens.mjs.
test.skip(!process.env.SCREENS, "run with npm run e2e:screens")

test("pos screens", async ({ page, surface, snap }) => {
  test.skip(surface !== "pos")
  await page.goto("/pos")
  await page.getByRole("heading", { name: /Вход в кассу|Выберите рабочее место/ }).waitFor()
  await snap("02-login-empty")
  await showTerminalPicker(page)
  await snap("01-terminal-picker")
  await page.goto("/dev/ui")
  await snap("00-primitives")
})

test("office screens", async ({ page, surface, snap }) => {
  test.skip(surface !== "office")
  test.setTimeout(180_000)
  await page.goto("/office")
  await snap("00-sign-in")
  for (const group of officeNavigation) {
    for (const item of group.items) {
      if (item.kind === "link") continue
      await page.goto(`/dev/office/${item.id}`)
      await page.getByRole("heading", { level: 1, name: item.label }).waitFor()
      await snap(item.id)
    }
  }
  const engine: [string, string][] = [
    ["engine-register", "/dev/engine/transactions"],
    ["engine-editor", "/dev/engine/transactions/tx-1"],
    ["engine-master", "/dev/engine/cashflow-categories"],
  ]
  for (const [name, url] of engine) {
    await page.goto(url)
    await snap(name)
  }
})
