#!/usr/bin/env node
// Dev only: puts the POS of the three pilot branches on the iiko menu, the way prod is set up.
//   1. links the iiko departments of Алматы / Шымкент / Түркістан to the restaurants sandyq-almaty /
//      sandyq-shymkent / sandyq-turkistan (prod's «Сопоставление филиалов»);
//   2. re-imports iiko branch prices into them (read-only GET calls to iiko, writes to dev only);
//   3. shows the iiko dishes priced in those branches and hides the PDF stand-in menu — the same code as the
//      office button «Показать блюда iiko с ценой».
// Refuses anything but a dev deployment. Prod: the owner does 1 and 3 in the office, 2 is scripts/prod-iiko-import.sh.
//
//   npm run dev:iiko-menu            (add --skip-import to reuse the prices already imported)

import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

const LINKS = [
  { restaurantExternalId: "sandyq-almaty", iikoDepartmentExternalId: "700917ce-77e5-479a-a4a9-68c2a9e76fc2" },
  { restaurantExternalId: "sandyq-shymkent", iikoDepartmentExternalId: "9c5883c4-ebe9-4182-ba19-269457e3cc3d" },
  { restaurantExternalId: "sandyq-turkistan", iikoDepartmentExternalId: "e8cba932-e56d-4fe7-bbc9-01c92b765a4c" },
]

function fail(message) {
  console.error(`✖ ${message}`)
  process.exit(1)
}

function deployment() {
  if (process.env.CONVEX_DEPLOYMENT) return process.env.CONVEX_DEPLOYMENT
  try {
    return readFileSync(".env.local", "utf8").match(/^CONVEX_DEPLOYMENT=(.+)$/m)?.[1]?.split(" ")[0] ?? ""
  } catch {
    return ""
  }
}

if (process.argv.includes("--prod")) fail("Dev only — on prod the owner links branches and shows the iiko menu in the office.")
if (!deployment().startsWith("dev:")) fail(`Refusing to run against a non-development deployment: ${deployment() || "not configured"}.`)

function run(fn, args) {
  const result = spawnSync("npx", ["convex", "run", fn, JSON.stringify(args), "--typecheck", "disable"], { encoding: "utf8" })
  if (result.status !== 0) fail(`${fn} failed:\n${result.stderr}`)
  const text = result.stdout.trim()
  return text ? JSON.parse(text.slice(text.indexOf("{"))) : null
}

console.log("1/3 linking the pilot branches to their iiko departments…")
run("domains/iiko/devMenu:linkDepartments", { links: LINKS })

if (!process.argv.includes("--skip-import")) {
  console.log("2/3 importing iiko branch prices (read-only from iiko)…")
  const imported = spawnSync("node", ["--env-file=.env", "scripts/iiko/seed.mjs", "--with-prices"], { stdio: ["inherit", "inherit", "inherit"] })
  if (imported.status !== 0) fail("iiko price import failed")
} else console.log("2/3 skipped (--skip-import)")

console.log("3/3 showing the iiko dishes with a branch price, hiding the PDF menu…")
const restaurantExternalIds = LINKS.map((link) => link.restaurantExternalId)
let shown = 0
for (let cursor = null; ; ) {
  const page = run("domains/iiko/devMenu:showIikoMenuPage", { restaurantExternalIds, cursor })
  shown += page.shown
  if (page.isDone) break
  cursor = page.continueCursor
}
let hidden = 0
for (let cursor = null; ; ) {
  const page = run("domains/iiko/devMenu:hidePdfMenuPageDev", { cursor })
  hidden += page.hidden
  if (page.isDone) break
  cursor = page.continueCursor
}
console.log(`✔ iiko dishes shown: ${shown}; PDF dishes hidden: ${hidden}. The POS of the three branches is on the iiko menu.`)
