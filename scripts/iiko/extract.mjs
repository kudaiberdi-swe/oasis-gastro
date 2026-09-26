#!/usr/bin/env node
// Discovers the iiko API surface (--discover-only, pulls no data) or extracts the endpoints in
// endpoint-registry.mjs into a local, sanitized, gitignored staging file. Never writes anything back to
// iiko — see lib.mjs's IikoClient, which only ever exposes GET.
//
//   npm run iiko:extract -- [--with-stock-master] [--with-products] [--with-balances] [--with-prices]
//                           [--with-sales --from=YYYY-MM-DD --to=YYYY-MM-DD] [--brand=<term>]

import path from "node:path"

import { IikoClient, contentHash, ensureDirectory, parseArgs, parseResponse, parseWadl, readIikoConfig, recordExternalKey, recordsFromPayload, sanitizeRecord, writeJson, writeJsonl } from "./lib.mjs"
import { ENDPOINTS, endpointByKey } from "./endpoint-registry.mjs"

const args = parseArgs(process.argv.slice(2))
const config = readIikoConfig({ credentialsFile: args.credentialsFile })
const runExternalId = String(args.runId ?? `run-${new Date().toISOString().replace(/[:.]/g, "-")}`)
const outputRoot = path.resolve(args.output ?? ".iiko-cache", runExternalId)

// The iiko account behind these credentials is a holding of 8 brands sharing one corporate structure
// (verified: ~30 branches, ~2716 employees). This project is scoped to Sandyq only — see BRD.md §5 and
// CLAUDE.md. Other brands' departments, employees, stores, terminals, products and sales never reach the
// staging file. Default aliases cover the observed spellings (including the Cyrillic «Сандык») — pass
// --brand to match a single exact term instead.
const BRAND_ALIASES = args.brand ? [String(args.brand)] : ["sandyq", "sandyk", "сандык", "сандық"]
const matchesBrand = (name) => {
  const lower = String(name ?? "").toLocaleLowerCase()
  return BRAND_ALIASES.some((alias) => lower.includes(alias.toLocaleLowerCase()))
}
const asArray = (value) => (value === null || value === undefined ? [] : Array.isArray(value) ? value : [value])
const isoDay = (value) => value.toISOString().slice(0, 10)
const today = isoDay(new Date())
const dotted = (iso) => iso.split("-").reverse().join(".")
const nextDay = (iso) => isoDay(new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000))

const client = new IikoClient(config)
console.log(`Logging in to ${config.host} as ${config.login}…`)
await client.login()

const rows = []
const endpointResults = []

async function fetchRecords(key, query = "") {
  const endpoint = endpointByKey(key)
  const response = await client.get(`${endpoint.path}${query}`, { accept: endpoint.accept ?? "application/xml" })
  return { endpoint, payload: parseResponse(response) }
}

function stage(endpoint, records, totalSeen, derive = () => ({})) {
  for (const record of records) {
    const sanitized = { ...sanitizeRecord(record, endpoint.domain), ...derive(record) }
    rows.push({ endpointKey: endpoint.key, domain: endpoint.domain, recordExternalId: recordExternalKey(sanitized, endpoint.key), payload: sanitized, payloadHash: contentHash(sanitized) })
  }
  endpointResults.push({ endpointKey: endpoint.key, status: "ok", count: records.length, totalSeen })
  console.log(`  ✔ ${endpoint.key}: staged ${records.length} of ${totalSeen} record(s) seen`)
}

async function step(key, work) {
  try {
    await work()
  } catch (error) {
    endpointResults.push({ endpointKey: key, status: "error", message: error.message })
    console.error(`  ✖ ${key}: ${error.message}`)
  }
}

try {
  if (args.discoverOnly) {
    console.log("Fetching application.wadl (discovery only — no business data pulled)…")
    const wadl = await client.get("application.wadl?detail=true", { accept: "application/xml" })
    const operations = parseWadl(wadl.text).filter((operation) => operation.method !== "OPTIONS")
    console.log(`\n✔ Discovered ${operations.length} operations (excluding OPTIONS) at ${config.host}`)
    console.log(`  This project only ever calls (GET): ${ENDPOINTS.map((endpoint) => `/${endpoint.path}`).join(", ")}`)
  } else {
    console.log(`Extracting into ${outputRoot}, scoped to brand aliases [${BRAND_ALIASES.join(", ")}]…`)
    let departmentIds = new Set()
    let departmentCodes = new Set()

    await step("corporation/departments", async () => {
      const { endpoint, payload } = await fetchRecords("corporation/departments")
      const all = recordsFromPayload(payload)
      const records = all.filter((record) => matchesBrand(record.name))
      departmentIds = new Set(records.filter((record) => record.type === "DEPARTMENT").map((record) => String(record.id)))
      departmentCodes = new Set(records.map((record) => record.code).filter(Boolean).map(String))
      console.log(`  Matched departments: ${records.map((record) => record.name).join(" | ")}`)
      stage(endpoint, records, all.length)
    })

    await step("employees", async () => {
      const { endpoint, payload } = await fetchRecords("employees")
      const all = recordsFromPayload(payload)
      const records = all.filter((record) => [asArray(record.departmentCodes), asArray(record.responsibilityDepartmentCodes)].flat().map(String).some((code) => departmentCodes.has(code)))
      stage(endpoint, records, all.length)
    })

    // Restaurant sections and cash registers of Sandyq departments: terminals and cash shifts map through them.
    const pointOfSaleDepartment = new Map()
    const pointsOfSale = []
    const storeIds = new Set()
    const unitNames = new Map()
    if (args.withStockMaster || args.withSales) {
      await step("corporation/groups", async () => {
        const { payload } = await fetchRecords("corporation/groups")
        for (const group of recordsFromPayload(payload)) {
          const departmentId = String(group.departmentId ?? "")
          if (!departmentIds.has(departmentId)) continue
          for (const pointOfSale of asArray(group.pointOfSaleDtoes?.pointOfSaleDto)) {
            pointOfSaleDepartment.set(String(pointOfSale.id), departmentId)
            pointsOfSale.push({ id: String(pointOfSale.id), name: String(pointOfSale.name ?? "Касса"), departmentId })
          }
        }
        console.log(`  Sandyq cash registers: ${pointsOfSale.length}`)
      })
    }

    if (args.withStockMaster || args.withBalances) {
      await step("corporation/stores", async () => {
        const { endpoint, payload } = await fetchRecords("corporation/stores")
        const all = recordsFromPayload(payload)
        const records = all.filter((record) => departmentIds.has(String(record.parentId)))
        for (const record of records) storeIds.add(String(record.id))
        if (args.withStockMaster) stage(endpoint, records, all.length)
      })
    }

    if (args.withStockMaster) {
      // corporation/terminals lists only anonymous back-office machines on this account; the POS cash
      // registers of each department are the points of sale of corporation/groups.
      stage({ key: "corporation/groups", domain: "terminal" }, pointsOfSale, pointsOfSale.length, (record) => ({ departmentId: record.departmentId }))
      await step("suppliers", async () => {
        const { endpoint, payload } = await fetchRecords("suppliers")
        const all = recordsFromPayload(payload)
        stage(endpoint, all.filter((record) => record.supplier !== false), all.length)
      })
    }

    if (args.withStockMaster || args.withProducts) {
      await step("v2/entities/list?rootType=MeasureUnit", async () => {
        const { endpoint, payload } = await fetchRecords("v2/entities/list?rootType=MeasureUnit")
        const all = recordsFromPayload(payload)
        for (const record of all) unitNames.set(String(record.id), String(record.name ?? record.code ?? ""))
        if (args.withStockMaster) stage(endpoint, all, all.length)
      })
    }

    // Balances first: what lies in Sandyq stores belongs to the Sandyq scope even from a shared group.
    let balances = []
    const balanceAt = new Date()
    if (args.withBalances) {
      await step("v2/reports/balance/stores", async () => {
        const timestamp = `${today}T${balanceAt.toTimeString().slice(0, 8)}`
        const { payload } = await fetchRecords("v2/reports/balance/stores", `?timestamp=${timestamp}`)
        const all = recordsFromPayload(payload)
        balances = all.filter((record) => storeIds.has(String(record.store)))
        console.log(`  Sandyq store balances: ${balances.length} of ${all.length}`)
      })
    }

    const scope = new Set()
    if (args.withProducts) {
      let groups = []
      let products = []
      let charts = []
      await step("v2/entities/products/group/list", async () => {
        groups = recordsFromPayload((await fetchRecords("v2/entities/products/group/list")).payload)
      })
      await step("v2/entities/products/list", async () => {
        products = recordsFromPayload((await fetchRecords("v2/entities/products/list")).payload)
      })
      await step("v2/assemblyCharts/getAll", async () => {
        const { payload } = await fetchRecords("v2/assemblyCharts/getAll", `?dateFrom=${today}&dateTo=${today}&includeDeletedProducts=false&includePreparedCharts=false`)
        charts = asArray(payload?.assemblyCharts)
      })
      const groupById = new Map(groups.map((group) => [String(group.id), group]))
      const topGroupOf = (groupId) => {
        let group = groupById.get(String(groupId))
        while (group && group.parent && groupById.has(String(group.parent))) group = groupById.get(String(group.parent))
        return group
      }
      // A chart item applies to a department unless its store specification excludes it.
      const appliesToSandyq = (item) => {
        const spec = item.storeSpecification
        const listed = asArray(spec?.departments).map(String)
        if (!listed.length) return true
        return [...departmentIds].some((id) => (spec.inverse ? !listed.includes(id) : listed.includes(id)))
      }
      // The chart in force today per product (the latest dateFrom), with the items Sandyq departments use.
      const chartByProduct = new Map()
      for (const chart of charts) {
        const current = chartByProduct.get(String(chart.assembledProductId))
        if (!current || String(chart.dateFrom) > String(current.dateFrom)) chartByProduct.set(String(chart.assembledProductId), chart)
      }
      // Scope: products of Sandyq groups, whatever lies in Sandyq stores, and everything their charts use.
      for (const product of products) if (matchesBrand(topGroupOf(product.parent)?.name)) scope.add(String(product.id))
      for (const balance of balances) scope.add(String(balance.product))
      const queue = [...scope]
      while (queue.length) {
        const chart = chartByProduct.get(queue.pop())
        for (const item of asArray(chart?.items)) {
          const id = String(item.productId)
          if (appliesToSandyq(item) && !scope.has(id)) {
            scope.add(id)
            queue.push(id)
          }
        }
      }
      const scopedProducts = products.filter((product) => scope.has(String(product.id)))
      const groupScope = new Set()
      for (const product of scopedProducts) {
        let group = groupById.get(String(product.parent))
        while (group && !groupScope.has(String(group.id))) {
          groupScope.add(String(group.id))
          group = groupById.get(String(group.parent))
        }
      }
      const barGroup = (groupId) => {
        for (let group = groupById.get(String(groupId)); group; group = groupById.get(String(group.parent))) if (/бар|bar/i.test(String(group.name))) return true
        return false
      }
      stage(endpointByKey("v2/entities/products/group/list"), groups.filter((group) => groupScope.has(String(group.id))), groups.length)
      stage(endpointByKey("v2/entities/products/list"), scopedProducts, products.length, (product) => ({ unitName: unitNames.get(String(product.mainUnit)) ?? "", prepArea: barGroup(product.parent) ? "bar" : "hot" }))
      const scopedCharts = [...chartByProduct.values()].filter((chart) => scope.has(String(chart.assembledProductId)))
      // A line may be a per-branch variant (its store specification): keep which Sandyq departments it serves.
      const lineDepartments = (item) => {
        const spec = item.storeSpecification
        const listed = asArray(spec?.departments).map(String)
        if (!listed.length) return undefined
        const served = [...departmentIds].filter((id) => (spec.inverse ? !listed.includes(id) : listed.includes(id)))
        return served.length === departmentIds.size ? undefined : served
      }
      const items = (chart) => asArray(chart.items).filter(appliesToSandyq).map(({ storeSpecification, ...item }) => ({ ...item, departmentExternalIds: lineDepartments({ storeSpecification }) }))
      stage(endpointByKey("v2/assemblyCharts/getAll"), scopedCharts.map((chart) => ({ ...chart, items: items(chart) })), charts.length)
    }

    if (args.withBalances) {
      const endpoint = endpointByKey("v2/reports/balance/stores")
      const records = args.withProducts ? balances.filter((record) => scope.has(String(record.product))) : balances
      stage(endpoint, records, balances.length, () => ({ occurredAt: balanceAt.getTime() }))
    }

    if (args.withPrices) {
      await step("v2/price", async () => {
        const endpoint = endpointByKey("v2/price")
        const records = []
        let seen = 0
        for (const departmentId of departmentIds) {
          const { payload } = await fetchRecords("v2/price", `?dateFrom=${today}&dateTo=${today}&departmentId=${departmentId}`)
          const all = asArray(payload?.response)
          seen += all.length
          for (const row of all) {
            if (row.productSizeId) continue // sizes of iiko products are not carried over
            if (args.withProducts && !scope.has(String(row.productId))) continue
            const current = asArray(row.prices).find((price) => String(price.dateFrom) <= today && (!price.dateTo || String(price.dateTo) >= today) && price.included !== false)
            if (current) records.push({ ...row, prices: [current] })
          }
        }
        stage(endpoint, records, seen, (row) => ({ id: `${row.departmentId}:${row.productId}` }))
      })
    }

    if (args.withSales) {
      const from = String(args.from ?? isoDay(new Date(Date.now() - 7 * 86_400_000)))
      const to = String(args.to ?? today)
      await step("v2/cashshifts/list", async () => {
        const { endpoint, payload } = await fetchRecords("v2/cashshifts/list", `?openDateFrom=${from}&openDateTo=${to}&status=ANY`)
        const all = recordsFromPayload(payload)
        const records = all.filter((record) => pointOfSaleDepartment.has(String(record.pointOfSaleId)))
        stage(endpoint, records, all.length, (record) => ({ departmentId: pointOfSaleDepartment.get(String(record.pointOfSaleId)) }))
      })
      await step("reports/olap?report=SALES", async () => {
        const endpoint = endpointByKey("reports/olap?report=SALES")
        const columns = ["Department.Id", "UniqOrderId.Id", "OrderNum", "OpenTime", "OrderType", "SessionID"].map((column) => `&groupRow=${column}`).join("")
        const measures = ["DishSumInt", "DishDiscountSumInt", "GuestNum"].map((measure) => `&agr=${measure}`).join("")
        const response = await client.get(`${endpoint.path}?report=SALES&from=${dotted(from)}&to=${dotted(nextDay(to))}${columns}${measures}`, { accept: "application/xml" })
        const all = asArray(parseResponse(response)?.r)
        const records = all
          .filter((row) => departmentIds.has(String(row["Department.Id"])) && row["UniqOrderId.Id"])
          .map((row) => ({ departmentId: String(row["Department.Id"]), orderId: String(row["UniqOrderId.Id"]), orderNumber: row.OrderNum, openTime: String(row.OpenTime ?? ""), orderType: row.OrderType ? String(row.OrderType) : undefined, sessionId: row.SessionID ? String(row.SessionID) : undefined, grossAmount: row.DishSumInt, total: row.DishDiscountSumInt, guestCount: row.GuestNum }))
        stage(endpoint, records, all.length, (row) => ({ id: row.orderId }))
      })
    }

    ensureDirectory(outputRoot)
    writeJsonl(path.join(outputRoot, "staging.jsonl"), rows)
    writeJson(path.join(outputRoot, "manifest.json"), { runExternalId, extractedAt: new Date().toISOString(), host: config.host, rowCount: rows.length, endpointResults, stagingChecksum: contentHash(rows) })
    console.log(`\n✔ Staged ${rows.length} sanitized record(s) to ${outputRoot}/staging.jsonl`)
    console.log(`  Run this import with: npm run iiko:import -- --input=${outputRoot}`)
  }
} finally {
  await client.logout()
  console.log("Logged out.")
}
