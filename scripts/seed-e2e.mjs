#!/usr/bin/env node
// LEGACY — runs scripts/seed-sandyq.mjs (the first client's real menu); see its header before using it on dev.
// e2e seed (W0-CI-03): dev deployments only — never production, there is no override flag.
// Runs the regular dev seed (org, 3 branches with a terminal each, the real menu, cashier/manager/
// administrator with PINs generated locally) and writes the cashier's login for the e2e sale smoke
// test to .sandyq-seed/e2e.env (mode 0600, gitignored). The PIN is never printed.
//
//   npm run seed:e2e
//   set -a; source .sandyq-seed/e2e.env; set +a; npm run e2e

import { spawnSync } from "node:child_process"
import { chmodSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

function fail(message) {
  console.error(`✖ ${message}`)
  process.exit(1)
}

function deploymentFromEnvFile() {
  try {
    return readFileSync(".env.local", "utf8").match(/^CONVEX_DEPLOYMENT=(.+)$/m)?.[1]?.split(" ")[0] ?? ""
  } catch {
    return ""
  }
}

if (process.argv.includes("--prod")) fail("The e2e seed never runs against production.")
const deployment = process.env.CONVEX_DEPLOYMENT ?? deploymentFromEnvFile()
if (!deployment.startsWith("dev:")) fail(`Refusing to seed a non-development deployment: ${deployment || "not configured"}.`)

const seed = spawnSync("node", ["scripts/seed-sandyq.mjs"], { stdio: ["inherit", "ignore", "inherit"] })
if (seed.status !== 0) fail("dev seed failed")

const dir = path.resolve(".sandyq-seed")
const latest = readdirSync(dir)
  .filter((name) => /^credentials-\d+\.json$/.test(name))
  .sort()
  .at(-1)
if (!latest) fail("no credentials file was written by the dev seed")

const { credentials } = JSON.parse(readFileSync(path.join(dir, latest), "utf8"))
const cashier = credentials.find((entry) => entry.role === "cashier")
if (!cashier) fail("the dev seed created no cashier")

const envFile = path.join(dir, "e2e.env")
writeFileSync(envFile, [`E2E_POS_TERMINAL=sandyq-almaty-01`, `E2E_POS_CODE=${cashier.code}`, `E2E_POS_PIN=${cashier.pin}`, ""].join("\n"), { mode: 0o600 })
chmodSync(envFile, 0o600)
console.log(`✔ e2e login for the Алматы terminal written to ${path.relative(process.cwd(), envFile)} (not printed).`)
