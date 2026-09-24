import { expect, showTerminalPicker, test } from "../fixtures"

// W0 screens that render without signing in; each must have 0 serious/critical axe violations.
const PAGES: { surface: "pos" | "office"; name: string; url: string; picker?: boolean }[] = [
  { surface: "pos", name: "login", url: "/pos" },
  { surface: "pos", name: "terminal-picker", url: "/pos", picker: true },
  { surface: "pos", name: "primitives", url: "/dev/ui" },
  { surface: "office", name: "sign-in", url: "/office" },
  { surface: "office", name: "shell-register", url: "/dev/office/receipts" },
  { surface: "office", name: "engine-register", url: "/dev/engine/transactions" },
  { surface: "office", name: "engine-editor", url: "/dev/engine/transactions/tx-2" },
  { surface: "office", name: "engine-master", url: "/dev/engine/cashflow-categories" },
]

for (const target of PAGES) {
  test(`axe: ${target.name}`, async ({ page, surface, axeViolations }) => {
    test.skip(surface !== target.surface, `${target.surface} surface only`)
    if (target.picker) await showTerminalPicker(page)
    else await page.goto(target.url)
    await page.waitForLoadState("networkidle")
    expect(await axeViolations()).toEqual([])
  })
}
