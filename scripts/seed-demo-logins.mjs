#!/usr/bin/env node
// Fixed demo sign-ins for the demo frontend (sandyq-demo SWA) — DEV deployment dapper-lobster-404 ONLY.
//
//   npm run demo:logins
//
// Codes, PINs, e-mails and the password live in frontend/app/shared/demo/demo-logins.ts (the demo buttons
// read the same file). No backend changes: POS employees go through the same internal seedAll mutation and
// PBKDF2 PIN hashing as scripts/seed-sandyq.mjs (with the live org/Almaty rows passed back unchanged, so
// nothing else is touched); office users are appended with `convex import --append` only when their
// e-mail is missing (there is no internal office-user creation path), then setOfficePassword sets the
// password. Re-running is safe. Refuses any deployment except dapper-lobster-404, and never takes --prod.

import { pbkdf2Sync, randomBytes } from "node:crypto"
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

import { DEMO_KITCHEN_LOGIN, DEMO_OFFICE_LOGINS, DEMO_OFFICE_PASSWORD, DEMO_POS_LOGINS, DEMO_RESTAURANT } from "../frontend/app/shared/demo/demo-logins.ts"

const DEV = "dapper-lobster-404"

function fail(message) {
  console.error(`✖ ${message}`)
  process.exit(1)
}

// --- Target guard: the inverse of seed-sandyq.mjs — dev only, by name, with no override.
if (process.argv.slice(2).length) fail("No arguments accepted (there is no --prod for demo logins)")
if (process.env.CONVEX_DEPLOY_KEY) fail("CONVEX_DEPLOY_KEY is set — it would redirect the CLI; unset it")
if (process.env.CONVEX_URL || process.env.CONVEX_SELF_HOSTED_URL) fail("CONVEX_URL / CONVEX_SELF_HOSTED_URL is set — unset it")
function deploymentFromEnvLocal() {
  try {
    return readFileSync(".env.local", "utf8").match(/^CONVEX_DEPLOYMENT=(\S+)/m)?.[1] ?? ""
  } catch {
    return ""
  }
}
const deployment = process.env.CONVEX_DEPLOYMENT ?? deploymentFromEnvLocal()
if (deployment !== `dev:${DEV}`) fail(`Refusing: deployment is "${deployment || "not configured"}", expected dev:${DEV}`)

function convex(args, { quiet = false } = {}) {
  const result = spawnSync("npx", ["convex", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) fail(`convex ${args[0]} failed${quiet ? "" : `: ${(result.stderr || result.stdout).trim().split("\n").slice(-3).join(" ")}`}`)
  return result.stdout
}
// What the CLI actually resolves to, not just what the env file says.
const resolved = convex(["dashboard", "--no-open"]).trim()
if (!resolved.endsWith(`/d/${DEV}`)) fail(`Refusing: the Convex CLI resolves to ${resolved}, expected ${DEV}`)
console.log(`Target: ${DEV} (dev)`)

const table = (name) =>
  convex(["data", name, "--limit", "10000", "--format", "jsonLines"])
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line))

// --- POS employees through seedAll (it creates an employee once per code and never rewrites a PIN).
const restaurant = table("restaurants").find((row) => row.externalId === DEMO_RESTAURANT)
if (!restaurant?.active) fail(`Restaurant ${DEMO_RESTAURANT} not found or inactive on dev`)
const organization = table("organizations").find((row) => row.externalId === restaurant.organizationExternalId)
if (!organization) fail(`Organization ${restaurant.organizationExternalId} not found`)

const derivePinHash = (pin, salt) => pbkdf2Sync(pin, Buffer.from(salt, "utf8"), 120_000, 32, "sha256").toString("hex")
const posLogins = [...DEMO_POS_LOGINS, DEMO_KITCHEN_LOGIN]
const employees = posLogins.map(({ code, name, role, pin }) => {
  const pinSalt = randomBytes(16).toString("hex")
  return { code, displayName: name, role, restaurantExternalIds: [DEMO_RESTAURANT], pinSalt, pinHash: derivePinHash(pin, pinSalt) }
})
const pick = (row, keys) => Object.fromEntries(keys.map((key) => [key, row[key]]))
const payload = {
  organization: pick(organization, ["externalId", "name", "currency", "timezone"]),
  restaurants: [pick(restaurant, ["externalId", "organizationExternalId", "name", "address", "city", "timezone"])],
  terminals: [],
  categories: [],
  products: [],
  prices: [],
  employees,
}
convex(["run", "domains/seed/mutations:seedAll", JSON.stringify(payload), "--typecheck", "disable"], { quiet: true })

const employeeRows = table("employees")
for (const login of posLogins) {
  const row = employeeRows.find((candidate) => candidate.code === login.code)
  if (!row) fail(`Employee ${login.code} was not created`)
  const problems = [
    row.role !== login.role && `role is ${row.role}`,
    !row.active && "inactive",
    !row.restaurantIds.includes(restaurant._id) && `not scoped to ${DEMO_RESTAURANT}`,
    row.terminalIds?.length && "restricted to specific terminals",
    derivePinHash(login.pin, row.pinSalt) !== row.pinHash && "PIN differs from demo-logins.ts",
  ].filter(Boolean)
  if (problems.length) fail(`Employee ${login.code} already exists but ${problems.join(", ")} — fix it in the office (Кадры) or pick another code`)
  console.log(`  POS  ${login.label.padEnd(14)} ${login.code}  ok`)
}

// --- Office users: append the missing ones (insert only — existing rows are never touched).
const officeUsers = table("officeUsers")
const roles = new Set(table("officeRoles").map((row) => row.externalId))
const warehouses = table("warehouses").filter((row) => row.restaurantExternalId === DEMO_RESTAURANT && row.active).map((row) => row.externalId)
const missing = []
for (const login of DEMO_OFFICE_LOGINS) {
  if (!roles.has(login.role)) fail(`Office role ${login.role} not found on dev`)
  const existing = officeUsers.find((row) => row.email === login.email)
  if (existing) {
    if (!existing.active || existing.roleExternalId !== login.role) fail(`Office user ${login.email} exists but is inactive or has role ${existing.roleExternalId} — fix it in the office`)
    continue
  }
  missing.push({
    externalId: `demo-${login.role}`,
    email: login.email,
    name: login.name,
    roleExternalId: login.role,
    restaurantScopes: [DEMO_RESTAURANT],
    organizationScopes: [restaurant.organizationExternalId],
    warehouseScopes: warehouses,
    active: true,
  })
}
if (missing.length) {
  const clash = missing.find((row) => officeUsers.some((user) => user.externalId === row.externalId))
  if (clash) fail(`Office user code ${clash.externalId} is taken by another e-mail`)
  const dir = mkdtempSync(path.join(tmpdir(), "demo-office-users-"))
  const file = path.join(dir, "officeUsers.jsonl")
  try {
    writeFileSync(file, missing.map((row) => JSON.stringify(row)).join("\n") + "\n")
    convex(["import", "--table", "officeUsers", "--append", file])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- Office passwords (Convex Auth account), through the existing internal action. The password is passed
// as an argument but never printed (the action returns only { email, created }).
for (const login of DEMO_OFFICE_LOGINS) {
  convex(["run", "domains/office/adminMaintenance:setOfficePassword", JSON.stringify({ email: login.email, password: DEMO_OFFICE_PASSWORD })], { quiet: true })
  console.log(`  Office ${login.label.padEnd(24)} ${login.email}  ok`)
}

console.log("\n✔ Demo logins ready on dev. Codes/PINs/e-mails/password: frontend/app/shared/demo/demo-logins.ts")
