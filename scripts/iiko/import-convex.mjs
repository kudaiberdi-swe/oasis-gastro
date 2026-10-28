#!/usr/bin/env node
// Reads a staged run's sanitized JSONL and pushes it into Convex in chunks via
// `npx convex run domains/iiko/mutations:importBatch` — never touches iiko itself.
//   npm run iiko:import -- [--input=.iiko-cache/<run>] [--prod] [--only=recipeCharts,prices,…]

import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

import { parseArgs, readJsonl } from "./lib.mjs"

const args = parseArgs(process.argv.slice(2))
const target = args.prod ? ["--prod"] : []

function fail(message) {
  console.error(`✖ ${message}`)
  process.exit(1)
}

function latestRunDirectory() {
  const root = ".iiko-cache"
  if (!fs.existsSync(root)) fail("No .iiko-cache/ runs found — run `npm run iiko:extract` first")
  const runs = fs
    .readdirSync(root)
    .filter((name) => fs.existsSync(path.join(root, name, "manifest.json")))
    .map((name) => ({ name, mtime: fs.statSync(path.join(root, name, "manifest.json")).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  if (!runs.length) fail("No completed runs found in .iiko-cache/")
  return path.join(root, runs[0].name)
}

const inputDir = path.resolve(args.input ?? latestRunDirectory())
const manifestPath = path.join(inputDir, "manifest.json")
if (!fs.existsSync(manifestPath)) fail(`No manifest.json in ${inputDir}`)
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
const rows = readJsonl(path.join(inputDir, "staging.jsonl"))

console.log(`Importing ${rows.length} staged record(s) from ${inputDir} (run ${manifest.runExternalId})…`)

const text = (value) => (value === undefined || value === null || value === "" ? undefined : String(value))
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback)
const payloadsOf = (domain) => rows.filter((row) => row.domain === domain)
// iiko Server gives local Almaty times without an offset ("2026-09-20T19:05:49.956").
const almatyTime = (value) => (value ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}+05:00`) : undefined)
// OLAP OpenTime looks like "Fri Sep 25 14:02:02 AQTT 2026".
const MONTHS = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" }
function olapTime(value) {
  const match = /^\w{3} (\w{3}) (\d{1,2}) (\d\d:\d\d:\d\d) \w+ (\d{4})$/.exec(String(value).trim())
  if (!match) return almatyTime(value)
  const [, month, day, time, year] = match
  return Date.parse(`${year}-${MONTHS[month]}-${day.padStart(2, "0")}T${time}+05:00`)
}

const departments = payloadsOf("organization").map((row) => ({ externalId: row.recordExternalId, parentExternalId: text(row.payload.parentId), code: text(row.payload.code), name: String(row.payload.name ?? ""), type: String(row.payload.type ?? "DEPARTMENT"), payloadHash: row.payloadHash }))
const employees = payloadsOf("workforce").map((row) => ({ externalId: row.recordExternalId, code: text(row.payload.code), displayName: String(row.payload.name ?? "Без имени"), mainRoleCode: text(row.payload.mainRoleCode), departmentCodes: [row.payload.departmentCodes ?? []].flat().map(String), active: row.payload.deleted !== true, payloadHash: row.payloadHash }))
const warehouses = payloadsOf("warehouse").map((row) => ({ externalId: row.recordExternalId, parentExternalId: text(row.payload.parentId), code: text(row.payload.code), name: String(row.payload.name ?? ""), type: text(row.payload.type), deleted: row.payload.deleted === true, payloadHash: row.payloadHash }))
const terminals = payloadsOf("terminal").map((row) => ({ externalId: row.recordExternalId, name: String(row.payload.name ?? ""), anonymous: row.payload.anonymous === true, departmentExternalId: text(row.payload.departmentId), deleted: row.payload.deleted === true, payloadHash: row.payloadHash }))
const units = payloadsOf("unit").map((row) => ({ externalId: row.recordExternalId, code: text(row.payload.code), name: String(row.payload.name ?? ""), fullName: text(row.payload.fullName), deleted: row.payload.deleted === true, payloadHash: row.payloadHash }))
const suppliers = payloadsOf("supplier").map((row) => ({ externalId: row.recordExternalId, code: text(row.payload.code), name: String(row.payload.name ?? ""), isSupplier: row.payload.supplier !== false, deleted: row.payload.deleted === true, payloadHash: row.payloadHash }))
const productGroups = payloadsOf("product-group").map((row) => ({ externalId: row.recordExternalId, parentExternalId: text(row.payload.parent), name: String(row.payload.name ?? ""), position: Number.isFinite(row.payload.position) ? row.payload.position : undefined, deleted: row.payload.deleted === true, payloadHash: row.payloadHash }))
const openingBalances = payloadsOf("balance").map((row) => ({ storeExternalId: String(row.payload.store), productExternalId: String(row.payload.product), amount: num(row.payload.amount), sum: num(row.payload.sum), occurredAt: num(row.payload.occurredAt, Date.now()) }))
const recipeCharts = payloadsOf("recipe").map((row) => ({
  externalId: row.recordExternalId,
  assembledProductExternalId: String(row.payload.assembledProductId),
  dateFrom: String(row.payload.dateFrom).slice(0, 10),
  assembledAmount: num(row.payload.assembledAmount, 1),
  technology: text(row.payload.technologyDescription),
  items: [row.payload.items ?? []].flat().map((item) => ({ productExternalId: String(item.productId), amountIn: num(item.amountIn), amountMiddle: num(item.amountMiddle), amountOut: num(item.amountOut), ...(Array.isArray(item.departmentExternalIds) && item.departmentExternalIds.length ? { departmentExternalIds: item.departmentExternalIds.map(String) } : {}) })),
  payloadHash: row.payloadHash,
}))
const prices = payloadsOf("price").map((row) => ({ departmentExternalId: String(row.payload.departmentId), productExternalId: String(row.payload.productId), price: num(row.payload.prices?.[0]?.price), payloadHash: row.payloadHash }))
const cashShifts = payloadsOf("cash-shift").map((row) => ({
  externalId: row.recordExternalId,
  departmentExternalId: String(row.payload.departmentId),
  sessionNumber: num(row.payload.sessionNumber),
  cashRegisterNumber: Number.isFinite(row.payload.cashRegNumber) ? row.payload.cashRegNumber : undefined,
  status: String(row.payload.sessionStatus ?? ""),
  openedAt: almatyTime(row.payload.openDate) ?? 0,
  closedAt: almatyTime(row.payload.closeDate),
  managerEmployeeExternalId: text(row.payload.managerId),
  startCash: num(row.payload.sessionStartCash),
  salesCash: num(row.payload.salesCash),
  salesCard: num(row.payload.salesCard),
  salesCredit: num(row.payload.salesCredit),
  payIn: num(row.payload.payIn),
  payOut: num(row.payload.payOut),
  cashDiff: num(row.payload.cashDiff),
  ordersTotal: num(row.payload.payOrders),
  payloadHash: row.payloadHash,
}))
const orders = payloadsOf("order").map((row) => ({ externalId: row.recordExternalId, departmentExternalId: String(row.payload.departmentId), orderNumber: num(row.payload.orderNumber), openedAt: olapTime(row.payload.openTime) ?? 0, orderTypeName: text(row.payload.orderType), cashShiftExternalId: text(row.payload.sessionId), grossAmount: num(row.payload.grossAmount), total: num(row.payload.total), guestCount: Math.round(num(row.payload.guestCount)), payloadHash: row.payloadHash }))

function convex(fn, jsonArgs, { capture = false } = {}) {
  const result = spawnSync("npx", ["convex", "run", ...target, fn, JSON.stringify(jsonArgs), "--typecheck", "disable"], capture ? { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 } : { stdio: ["ignore", "ignore", "inherit"] })
  if (result.status !== 0) fail(`convex run ${fn} failed`)
  return capture ? JSON.parse(result.stdout.trim() || "null") : null
}

// A seed dish (from the menu PDFs) and an iiko dish with the same name are one product (decision Б-B4).
const normalize = (name) => String(name).toLocaleLowerCase("ru").replace(/[«»"'`().,:;!?—–-]/g, " ").replace(/\s+/g, " ").trim()
let products = []
if (payloadsOf("product").length) {
  const seed = new Map()
  let cursor = null
  do {
    const page = convex("domains/iiko/internal:productsForMatching", { paginationOpts: { numItems: 200, cursor } }, { capture: true })
    for (const product of page.page) if (!product.linked) seed.set(normalize(product.name), product.externalId)
    cursor = page.isDone ? null : page.continueCursor
  } while (cursor)
  let matched = 0
  products = payloadsOf("product").map((row) => {
    const matchProductExternalId = row.payload.type === "DISH" ? seed.get(normalize(row.payload.name ?? "")) : undefined
    if (matchProductExternalId) {
      matched += 1
      seed.delete(normalize(row.payload.name ?? ""))
    }
    return {
      externalId: row.recordExternalId,
      name: String(row.payload.name ?? ""),
      num: text(row.payload.num),
      parentExternalId: text(row.payload.parent),
      type: String(row.payload.type ?? ""),
      unitExternalId: text(row.payload.mainUnit),
      unitName: text(row.payload.unitName),
      defaultSalePrice: Number.isFinite(row.payload.defaultSalePrice) ? row.payload.defaultSalePrice : undefined,
      includedInMenu: row.payload.defaultIncludedInMenu === true,
      unitWeightKg: Number.isFinite(row.payload.unitWeight) && row.payload.unitWeight > 0 ? row.payload.unitWeight : undefined,
      prepArea: text(row.payload.prepArea),
      matchProductExternalId,
      deleted: row.payload.deleted === true,
      payloadHash: row.payloadHash,
    }
  })
  console.log(`  Products: ${products.length} in the brand scope, ${matched} matched to seed dishes by name`)
}

const chunk = (array, size) => Array.from({ length: Math.ceil(array.length / size) }, (_, index) => array.slice(index * size, index * size + size))
const skippedTotals = {}
const only = args.only ? new Set(String(args.only).split(",")) : null
function importChunks(key, list, size) {
  if (!list.length || (only && !only.has(key))) return
  const batches = chunk(list, size)
  let changed = 0
  for (const [index, batch] of batches.entries()) {
    const result = convex("domains/iiko/mutations:importBatch", { departments: key === "departments" ? batch : [], employees: key === "employees" ? batch : [], ...(key === "departments" || key === "employees" ? {} : { [key]: batch }) }, { capture: true })
    changed += key === "departments" ? result.departmentsChanged : key === "employees" ? result.employeesChanged : Object.values(result.changed ?? {}).reduce((sum, value) => sum + value, 0)
    for (const list of Object.values(result.skipped ?? {})) (skippedTotals[key] ??= []).push(...list)
    process.stdout.write(`\r  ${key}: ${Math.min((index + 1) * size, list.length)}/${list.length}`)
  }
  process.stdout.write(`\r  ${key}: ${list.length} sent, ${changed} changed${skippedTotals[key]?.length ? `, ${skippedTotals[key].length} skipped` : ""}\n`)
}

convex("domains/iiko/mutations:beginRun", { runExternalId: manifest.runExternalId })
importChunks("departments", departments, 50)
importChunks("employees", employees, 50)
// Stores and terminals need the restaurant links (W1-IIKO-02); products before their balances, charts and prices.
importChunks("warehouses", warehouses, 50)
importChunks("terminals", terminals, 50)
importChunks("units", units, 50)
importChunks("suppliers", suppliers, 100)
importChunks("productGroups", productGroups, 200)
importChunks("products", products, 80)
importChunks("openingBalances", openingBalances, 100)
importChunks("recipeCharts", recipeCharts, 25)
importChunks("prices", prices, 200)
importChunks("cashShifts", cashShifts, 200)
importChunks("orders", orders, 200)

const countsByEndpoint = Object.fromEntries(
  [
    ["corporation/departments", departments],
    ["employees", employees],
    ["corporation/stores", warehouses],
    ["corporation/terminals", terminals],
    ["v2/entities/list?rootType=MeasureUnit", units],
    ["suppliers", suppliers],
    ["v2/entities/products/group/list", productGroups],
    ["v2/entities/products/list", products],
    ["v2/reports/balance/stores", openingBalances],
    ["v2/assemblyCharts/getAll", recipeCharts],
    ["v2/price", prices],
    ["v2/cashshifts/list", cashShifts],
    ["reports/olap?report=SALES", orders],
  ]
    .filter(([, list]) => list.length)
    .map(([key, list]) => [key, list.length]),
)
convex("domains/iiko/mutations:completeRun", { runExternalId: manifest.runExternalId, counts: { departments: departments.length, employees: employees.length }, countsByEndpoint })

for (const [key, list] of Object.entries(skippedTotals)) {
  console.log(`\n  Skipped ${key} (${list.length}):`)
  for (const line of list.slice(0, 10)) console.log(`    · ${line}`)
  if (list.length > 10) console.log(`    … and ${list.length - 10} more (see /office/data-exchange)`)
}
console.log("\n✔ Import finished. Records of iiko departments without a restaurant link were skipped — link them in «Обмен данными».")
