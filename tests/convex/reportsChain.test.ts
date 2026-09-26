import type { TestConvex } from "convex-test"
import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import schema from "../../convex/schema"
import { setup } from "./fixtures/pos"

// W3-RPT-05: the 12 chain reports on a synthetic network — «Алматы» (open since 2025), «Шымкент» (new in
// 2026) and «Астана» (with iiko history); POS facts and the read-only iiko projection side by side.

type T = TestConvex<typeof schema>
const AUGUST = { dateFrom: "2026-08-01", dateTo: "2026-08-31", restaurantExternalIds: [] as string[] }
const at = (date: string, hour = 6) => Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`)
const ZERO = { orderCount: 0, guestCount: 0, quantity: 0, grossAmount: 0, discountAmount: 0, serviceChargeAmount: 0, netAmount: 0, costAmount: 0, refundAmount: 0, refundCount: 0, serviceMinutesTotal: 0, zeroRevenueCount: 0, updatedAt: 0 }

async function network(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["*"], active: true })
    for (const [externalId, name] of [["astana", "Астана"], ["shymkent", "Шымкент"]]) await ctx.db.insert("restaurants", { externalId, organizationExternalId: "sandyq", name, address: "—", timezone: "Asia/Almaty", active: true })
    const branch = (restaurant: string, date: string, orders: number, revenue: number, cost: number, refund = 0) =>
      ctx.db.insert("dailySalesFacts", { ...ZERO, restaurantExternalId: restaurant, businessDate: date, factType: "branch", dimensionKey: restaurant, dimensionLabel: restaurant, orderCount: orders, guestCount: orders, netAmount: revenue, costAmount: cost, refundAmount: refund })
    await branch("almaty", "2025-07-10", 30, 90_000, 27_000) // opened before the LFL base
    await branch("almaty", "2025-08-10", 35, 100_000, 30_000)
    await branch("almaty", "2026-07-15", 30, 100_000, 30_000)
    await branch("almaty", "2026-08-10", 20, 62_000, 18_000, 2_000)
    await branch("almaty", "2026-08-20", 20, 60_000, 18_000)
    await branch("shymkent", "2026-02-01", 5, 10_000, 4_000) // new in 2026 — not comparable
    await branch("shymkent", "2026-08-10", 10, 20_000, 8_000)
    const iiko = (restaurant: string, number: number, date: string, total: number) =>
      ctx.db.insert("iikoOrders", { externalId: `iiko-${restaurant}-${number}`, restaurantExternalId: restaurant, departmentExternalId: `dep-${restaurant}`, orderNumber: number, openedAt: at(date), businessDate: date, grossAmount: total, total, guestCount: 1, sourceHash: "h", importedAt: 0 })
    await iiko("astana", 1, "2025-06-01", 3_000)
    await iiko("astana", 2, "2025-08-05", 4_000)
    await iiko("astana", 3, "2026-08-05", 5_000)
    await iiko("astana", 4, "2026-08-06", 2_000)
  })
  const admin = t.withIdentity({ email: "admin@sandyq.test" })
  return (reportId: string, config: Partial<typeof AUGUST> & { extra?: Record<string, string | number | boolean> } = {}) => admin.query(api.domains.reports.queries.execute, { reportId, config: { ...AUGUST, ...config } })
}

describe("chain sales (W3-RPT-05: chain-01, 02, 04, 05)", () => {
  it("compares restaurants with POS and iiko columns, consolidates by day, LFL excludes the new restaurant, ranks", async () => {
    const { t } = await setup()
    const run = await network(t)

    const comparison = await run("chain-01")
    expect(comparison.rows.map((row) => [row.key, row.cells.orders, row.cells.revenue, row.cells.averageCheck, row.cells.foodCost, row.cells.iikoOrders, row.cells.iikoRevenue])).toEqual([
      ["almaty", 40, 120_000, 3_000, 30, 0, 0],
      ["shymkent", 10, 20_000, 2_000, 40, 0, 0],
      ["astana", 0, 0, 0, 0, 2, 7_000],
    ])
    expect(comparison.sourceLabel).toMatch(/iiko \(только чтение/)
    expect(comparison.totals).toMatchObject({ revenue: 140_000, iikoRevenue: 7_000 })

    const daily = await run("chain-02")
    expect(daily.rows.map((row) => [row.cells.group, row.cells.restaurants, row.cells.revenue, row.cells.iikoRevenue])).toEqual([
      ["2026-08-05", 0, 0, 5_000],
      ["2026-08-06", 0, 0, 2_000],
      ["2026-08-10", 2, 80_000, 0],
      ["2026-08-20", 1, 60_000, 0],
    ])

    const lfl = await run("chain-04")
    expect(lfl.rows.map((row) => [row.key, row.cells.baseRevenue, row.cells.revenue, row.cells.growth])).toEqual([["almaty", 100_000, 120_000, 20]])
    expect(lfl.kpis.find((kpi) => kpi.key === "excluded")?.value).toBe(2) // Шымкент (new) and Астана (no POS sales)
    expect(lfl.sourceLabel).toContain("Шымкент")
    const lflIiko = await run("chain-04", { extra: { source: "iiko" } })
    expect(lflIiko.rows.map((row) => [row.key, row.cells.baseRevenue, row.cells.revenue, row.cells.growth])).toEqual([["astana", 4_000, 7_000, 75]])

    const rating = await run("chain-05")
    expect(rating.rows.map((row) => [row.key, row.cells.place, row.cells.revenueRank, row.cells.foodCostRank, row.cells.growth])).toEqual([["almaty", 1, 1, 1, 20], ["shymkent", 2, 2, 2, 0]])
  })
})

describe("chain finance, stock and control (W3-RPT-05: chain-03, 06…12)", () => {
  it("P&L per restaurant, outbox, exchange errors, locks, menu changes, reference state, network stock, transfers", async () => {
    const { t } = await setup()
    const run = await network(t)
    await t.run(async (ctx) => {
      let n = 0
      const post = (restaurant: string, debit: string, credit: string, amount: number) => ctx.db.insert("journalEntries", { externalId: `je-${(n += 1)}`, organizationExternalId: "sandyq", restaurantExternalId: restaurant, sourceModuleId: "test", sourceExternalId: `src-${n}`, sourceNumber: "", occurredAt: at("2026-08-10"), businessDate: "2026-08-10", debitAccountExternalId: debit, creditAccountExternalId: credit, amount, description: "" })
      await post("almaty", "acc-1010", "acc-6010", 100_000)
      await post("almaty", "acc-6020", "acc-1010", 5_000)
      await post("almaty", "acc-7010", "acc-1310", 30_000)
      await post("almaty", "acc-7210", "acc-3310", 10_000)
      await post("astana", "acc-1010", "acc-6010", 20_000)

      const event = (externalId: string, status: "pending" | "published" | "failed", restaurant?: string) => ctx.db.insert("outboxEvents", { externalId, aggregateType: "order", aggregateExternalId: externalId, eventType: "order.paid", organizationExternalId: "sandyq", restaurantExternalId: restaurant, payload: {}, status, attempts: 1, availableAt: at("2026-08-10"), createdAt: at("2026-08-10"), publishedAt: status === "published" ? at("2026-08-10") + 120_000 : undefined, error: status === "failed" ? "Сеть недоступна" : undefined })
      await event("e1", "published", "almaty")
      await event("e2", "failed", "almaty")
      await event("e3", "pending")

      await ctx.db.insert("integrationJobs", { externalId: "job-1c", provider: "1c", direction: "outbound", operation: "export-sales", idempotencyKey: "k1", status: "dead-letter", attempts: 5, payload: {}, error: "Провайдер не подключён", nextAttemptAt: 0, createdAt: at("2026-08-11"), updatedAt: at("2026-08-11", 9) })
      await ctx.db.insert("iikoImportRuns", { runExternalId: "run-1", status: "failed", startedAt: at("2026-08-12"), error: "401 Unauthorized" })
      await ctx.db.insert("iikoEndpointStates", { endpointKey: "products", lastStatus: "ok", lastRunAt: at("2026-08-12"), classification: "mirrored", domain: "catalog", path: "/resto/api/v2/entities/products/list", recordCount: 135 })
      await ctx.db.insert("iikoEndpointStates", { endpointKey: "stores", lastStatus: "error", lastRunAt: at("2026-08-13"), message: "timeout", classification: "mirrored", domain: "stock", path: "/resto/api/corporation/stores" })

      await ctx.db.insert("periodLocks", { externalId: "lock-org", organizationExternalId: "sandyq", kind: "final", lockedThrough: at("2026-07-31", 18), active: true, reason: "Закрытие июля", createdBy: "buh@sandyq.test", createdAt: at("2026-08-05") })
      await ctx.db.insert("periodLocks", { externalId: "lock-almaty", organizationExternalId: "sandyq", restaurantExternalId: "almaty", kind: "preliminary", lockedThrough: at("2026-08-15", 18), active: false, reason: "Сверка", createdBy: "buh@sandyq.test", createdAt: at("2026-08-16"), reopenedBy: "buh@sandyq.test", reopenedAt: at("2026-08-17"), reopenReason: "Поздний приход" })

      const audit = (action: string, summary: string, restaurant?: string) => ctx.db.insert("auditEvents", { actorKey: "chef@sandyq.test", action, summary, resourceType: "x", resourceExternalId: "x", organizationExternalId: "sandyq", restaurantExternalId: restaurant, occurredAt: at("2026-08-14") })
      await audit("price-order.publish", "Приказ ПЦ-7 проведён")
      await audit("recipe.save", "Техкарта «Бешбармак» v3", "almaty")
      await audit("order.checkout", "Оплата заказа", "almaty")

      for (const [externalId, type] of [["d1", "DEPARTMENT"], ["d2", "DEPARTMENT"], ["d3", "DEPARTMENT"], ["j1", "JURPERSON"]]) await ctx.db.insert("iikoDepartments", { externalId, name: externalId, type, sourceHash: "h", importedAt: 0 })
      for (const [restaurant, department] of [["almaty", "d1"], ["astana", "d2"]]) await ctx.db.insert("restaurantSourceLinks", { restaurantExternalId: restaurant, iikoDepartmentExternalId: department, confirmedBy: "admin", confirmedAt: 0 })

      const warehouse = (externalId: string, restaurant: string) => ctx.db.insert("warehouses", { externalId, name: externalId, shortName: externalId, restaurantExternalId: restaurant, organizationExternalId: "sandyq", kind: "storage", allowNegativeStock: false, internalTransfers: true, isSalesDefault: true, active: true, searchText: externalId })
      const almatyMain = await warehouse("almaty-main", "almaty")
      const almatyBar = await warehouse("almaty-bar", "almaty")
      const astanaMain = await warehouse("astana-main", "astana")
      const meat = await ctx.db.insert("inventoryItems", { externalId: "meat", name: "Конина", nameSort: "конина", searchText: "конина", unit: "кг", kind: "ingredient", active: true })
      await ctx.db.insert("stockMovements", { restaurantExternalId: "almaty", inventoryItemId: meat, kind: "receipt", quantityDelta: 10, unitCost: 1_000, balanceAfter: 10, averageUnitCostAfter: 1_000, actorEmail: "x", occurredAt: at("2026-08-05"), warehouseId: almatyMain })
      await ctx.db.insert("stockMovements", { restaurantExternalId: "almaty", inventoryItemId: meat, kind: "writeoff", quantityDelta: -4, unitCost: 1_000, balanceAfter: 6, averageUnitCostAfter: 1_000, actorEmail: "x", occurredAt: at("2026-09-05"), warehouseId: almatyMain })
      await ctx.db.insert("stockBalances", { restaurantExternalId: "almaty", inventoryItemId: meat, quantity: 6, averageUnitCost: 1_000, updatedAt: 0, warehouseId: almatyMain })
      await ctx.db.insert("dailyStockFacts", { warehouseId: almatyMain, restaurantExternalId: "almaty", inventoryItemId: meat, businessDate: "2026-08-05", inQuantity: 10, inValue: 10_000, outQuantity: 0, outValue: 0, byKind: { receipt: 10, sale: 0, writeoff: 0, transferIn: 0, transferOut: 0, inventory: 0, production: 0, supplierReturn: 0, outgoingInvoice: 0, other: 0 }, movementCount: 1, updatedAt: 0 })

      const transfer = (externalId: string, from: typeof almatyMain, to: typeof almatyMain, amount: number) => ctx.db.insert("stockDocuments", { externalId, type: "transfer", number: externalId, date: at("2026-08-10"), status: "posted", organizationExternalId: "sandyq", restaurantExternalId: "almaty", sourceWarehouseId: from, destinationWarehouseId: to, counterpartyName: "", reason: "", comment: "", totalQuantity: 3, totalAmount: amount, searchText: "", createdAt: 0, updatedAt: 0 })
      await transfer("ПМ-1", almatyMain, astanaMain, 3_000)
      await transfer("ПМ-2", almatyMain, almatyBar, 1_000) // inside one restaurant — not a chain transfer
    })

    const pnl = await run("chain-03")
    expect(pnl.columns.map((column) => column.label)).toEqual(["Статья", "Алматы", "Астана", "Итого по сети"])
    const pnlRows = Object.fromEntries(pnl.rows.map((row) => [row.key, row.cells]))
    expect(pnlRows.net).toMatchObject({ "r:almaty": 95_000, "r:astana": 20_000, total: 115_000 })
    expect(pnlRows.result).toMatchObject({ "r:almaty": 55_000, "r:astana": 20_000, total: 75_000 })

    const outbox = await run("chain-06")
    expect(outbox.rows).toEqual([{ key: "order.paid", cells: { group: "order.paid", total: 3, pending: 1, published: 1, failed: 1, delayMinutes: 2, lastError: "Сеть недоступна" } }])
    expect((await run("chain-06", { restaurantExternalIds: ["almaty"] })).totals).toMatchObject({ total: 2, pending: 0 })

    const errors = await run("chain-07")
    expect(errors.rows.map((row) => [row.cells.source, row.cells.error])).toEqual([["iiko (чтение)", "timeout"], ["iiko (чтение)", "401 Unauthorized"], ["1c", "Провайдер не подключён"]])
    const scoped = await run("chain-07", { restaurantExternalIds: ["almaty"] })
    expect(scoped.rows).toEqual([])
    expect(scoped.sourceLabel).toMatch(/сетевой отчёт/)

    const locks = await run("chain-08", { restaurantExternalIds: ["almaty"] })
    expect(locks.rows.map((row) => [row.cells.group, row.cells.kind, row.cells.lockedThrough, row.cells.status])).toEqual([
      ["Алматы", "Предварительная", "2026-08-15", "Открыт заново: Поздний приход"],
      ["Sandyq · вся организация", "Окончательная", "2026-07-31", "Действует"],
    ])

    const menu = await run("chain-09")
    expect(menu.rows.map((row) => [row.cells.action, row.cells.restaurant])).toEqual([["Техкарта изменена", "Алматы"], ["Приказ о ценах проведён", "Вся сеть"]]) // newest first
    expect((await run("chain-09", { restaurantExternalIds: ["almaty"] })).rows.map((row) => row.cells.action)).toEqual(["Техкарта изменена"])

    const references = await run("chain-10")
    expect(references.rows.find((row) => row.key === "departments")?.cells).toMatchObject({ iiko: 3, local: 2, difference: 1 })
    expect(references.rows.find((row) => row.key === "endpoint:stores")?.cells.status).toBe("Ошибка: timeout")
    expect(references.kpis.find((kpi) => kpi.key === "errors")?.value).toBe(1)

    const stock = await run("chain-11")
    expect(stock.rows.map((row) => [row.key, row.cells.warehouses, row.cells.items, row.cells.inValue, row.cells.value])).toEqual([["almaty", 2, 1, 10_000, 10_000], ["astana", 1, 0, 0, 0]])

    const transfers = await run("chain-12")
    expect(transfers.rows).toEqual([{ key: "almaty→astana", cells: { group: "Алматы → Астана", documents: 1, quantity: 3, amount: 3_000 } }])
    expect((await run("chain-12", { restaurantExternalIds: ["astana"] })).rows).toHaveLength(1)
  })
})
