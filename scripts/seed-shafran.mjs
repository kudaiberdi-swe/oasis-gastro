#!/usr/bin/env node
// Demo chain «Шафран» on the DEV deployment dapper-lobster-404 ONLY (never prod, no override):
//
//   npm run seed:shafran                       wipe + chain + 30 days of sales + demo sign-ins + counts
//   npm run seed:shafran -- --days=14 --orders=10
//
// 1. Wipes the previous client's data (every table except sign-in and the client-neutral reference setup —
//    convex/domains/seed/shafran.ts WIPE_TABLES) and the stored files.
// 2. Seeds the chain (16 branches with tills, warehouses, tables; menu, prices, recipes, stock items, suppliers,
//    staff, guests, loyalty, delivery channels) and re-points office users' scopes.
// 3. Plays `--days` of sales per branch through the real settlement core, with weekly stock receipts.
// 4. Re-creates the demo sign-ins (scripts/seed-demo-logins.mjs) and prints row counts.
// A full re-run starts from the wipe, so it is safe; the push of convex/ (`npx convex dev --once`) comes first.

import { spawn, spawnSync } from "node:child_process"

import { DEMO_OFFICE_LOGINS } from "../frontend/app/shared/demo/demo-logins.ts"
import { SHAFRAN_BRANCHES } from "../convex/domains/seed/shafranData.ts"
import { convex, fail, requireDevTarget } from "./dev-target.mjs"

const options = { days: 30, orders: 16 }
for (const arg of process.argv.slice(2)) {
  const match = /^--(days|orders)=(\d+)$/.exec(arg)
  if (!match) fail(`Unknown argument ${arg} (only --days=<n> and --orders=<n>; there is no --prod)`)
  options[match[1]] = Number(match[2])
}
if (options.days < 1 || options.days > 60 || options.orders < 1 || options.orders > 80) fail("--days is 1…60, --orders is 1…80")
requireDevTarget()

const run = (name, args = {}) => JSON.parse(convex(["run", `domains/seed/shafran:${name}`, JSON.stringify(args), "--typecheck", "disable"]))

// Branches are independent (own till, warehouse, shift); four at a time.
function runAsync(name, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["convex", "run", `domains/seed/shafran:${name}`, JSON.stringify(args), "--typecheck", "disable"], { stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    let err = ""
    child.stdout.on("data", (chunk) => (out += chunk))
    child.stderr.on("data", (chunk) => (err += chunk))
    child.on("close", (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err.trim().split("\n").slice(-3).join(" ")))))
  })
}

console.log("1/4 Wiping the previous dev data…")
const wiped = run("wipeAll")
console.log(Object.entries(wiped).map(([table, count]) => `  ${table.padEnd(26)} ${count}`).join("\n") || "  nothing to wipe")

console.log("2/4 Seeding the chain «Шафран»…")
console.log(JSON.stringify(run("seedChain", { demoEmails: DEMO_OFFICE_LOGINS.map((login) => login.email) }), null, 2))

console.log(`3/4 Sales history: ${options.days} days, base ${options.orders} checks a day…`)
const queue = SHAFRAN_BRANCHES.map((branch) => branch.externalId)
let total = 0
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      const result = await runAsync("seedHistory", { restaurantExternalId: id, days: options.days, baseOrders: options.orders }).catch((error) => fail(`${id}: ${error.message}`))
      total += result.orders
      console.log(`  ${id}: ${result.orders} checks`)
    }
  }),
)
console.log(`  total: ${total} checks`)

console.log("4/4 Demo sign-ins…")
const logins = spawnSync("node", ["scripts/seed-demo-logins.mjs"], { stdio: "inherit" })
if (logins.status !== 0) fail("demo logins failed")

const { counts, leftoverNames } = run("summary")
console.log(Object.entries(counts).map(([table, count]) => `  ${table.padEnd(22)} ${count}`).join("\n"))
if (leftoverNames.length) fail(`Names still mention the previous client: ${leftoverNames.join(", ")}`)
console.log("\n✔ Demo chain «Шафран» ready on dev.")
