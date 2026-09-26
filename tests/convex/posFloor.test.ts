import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { cashier, setup } from "./fixtures/pos"

// orders.floor — the cashier's «Зал»: tables by hall with the open checks at them (redesign item 2).

type T = Awaited<ReturnType<typeof setup>>["t"]

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

const tableBase = { capacity: 4, shape: "rect" as const, x: 0, y: 0, width: 2, height: 2, rotation: 0, updatedAt: 0 }

async function addTables(t: T, rows: Array<{ restaurant?: string; hall: string; label: string; active?: boolean; capacity?: number }>) {
  await t.run(async (ctx) => {
    for (const row of rows) await ctx.db.insert("diningTables", { ...tableBase, externalId: `table-${row.restaurant ?? "almaty"}-${row.hall}-${row.label}`, restaurantExternalId: row.restaurant ?? "almaty", hall: row.hall, label: row.label, active: row.active ?? true, capacity: row.capacity ?? 4 })
  })
}

async function open(t: T, productId: Id<"products">, seat: { tableLabel?: string; hallLabel?: string }, sessionToken = cashier) {
  const result = await t.mutation(api.domains.orders.mutations.saveDraft, { sessionToken, clientOrderId: crypto.randomUUID(), orderType: "dine-in", ...seat, discountPercent: 0, comment: "", lines: [{ productId, quantity: 1 }] })
  if ("outcome" in result) throw new Error(result.outcome)
  return result
}

/** A second terminal of the same restaurant with its own cashier session and open shift; and a terminal of another restaurant. */
async function otherTerminals(t: T) {
  await t.run(async (ctx) => {
    const almaty = (await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", "almaty")).unique())!
    const astana = await ctx.db.insert("restaurants", { externalId: "astana", organizationExternalId: "sandyq", name: "Астана", address: "—", timezone: "Asia/Almaty", active: true })
    const second = await ctx.db.insert("posTerminals", { externalId: "t2", restaurantId: almaty._id, name: "Касса 2", terminalNumber: 2, nextOrderNumber: 1, active: true })
    const foreign = await ctx.db.insert("posTerminals", { externalId: "t9", restaurantId: astana, name: "Касса Астана", terminalNumber: 9, nextOrderNumber: 1, active: true })
    const base = { pinSalt: "s", pinHash: "h", active: true, failedAttempts: 0 }
    const secondCashier = await ctx.db.insert("employees", { ...base, restaurantIds: [almaty._id], code: "102", displayName: "Кассир 2", role: "cashier" })
    const astanaCashier = await ctx.db.insert("employees", { ...base, restaurantIds: [astana], code: "103", displayName: "Кассир Астана", role: "cashier" })
    const session = { createdAt: Date.now(), lastActivityAt: Date.now(), expiresAt: Date.now() + 3_600_000, purpose: "operator" as const }
    await ctx.db.insert("posSessions", { ...session, tokenHash: await digest("cashier-2"), employeeId: secondCashier, terminalId: second })
    await ctx.db.insert("posSessions", { ...session, tokenHash: await digest("cashier-astana"), employeeId: astanaCashier, terminalId: foreign })
    const kitchen = await ctx.db.insert("employees", { ...base, restaurantIds: [almaty._id], code: "700", displayName: "Повар", role: "kitchen" })
    await ctx.db.insert("posSessions", { ...session, tokenHash: await digest("kitchen-token"), employeeId: kitchen, terminalId: second })
  })
  await t.mutation(api.domains.shifts.mutations.open, { sessionToken: "cashier-2", openingCash: 0, note: "" })
  await t.mutation(api.domains.shifts.mutations.open, { sessionToken: "cashier-astana", openingCash: 0, note: "" })
}

describe("orders.floor", () => {
  it("needs a live cashier session: no token, an unknown one or the kitchen role are refused", async () => {
    const { t } = await setup()
    await otherTerminals(t)
    await expect(t.query(api.domains.orders.floor.floor, { sessionToken: "" })).rejects.toThrow("Касса заблокирована")
    await expect(t.query(api.domains.orders.floor.floor, { sessionToken: "nope" })).rejects.toThrow("Сессия истекла")
    await expect(t.query(api.domains.orders.floor.floor, { sessionToken: "kitchen-token" })).rejects.toThrow("Кухня")
  })

  it("groups the restaurant's active tables by hall and joins the open checks by hall and label", async () => {
    const { t, productId } = await setup()
    await addTables(t, [
      { hall: "Основной зал", label: "Стол 2" },
      { hall: "Основной зал", label: "Стол 1", capacity: 6 },
      { hall: "Терраса", label: "Стол 1" },
      { hall: "Основной зал", label: "Стол 9", active: false },
      { restaurant: "astana", hall: "Основной зал", label: "Стол 1" },
    ])
    const terrace = await open(t, productId, { tableLabel: "Стол 1", hallLabel: "Терраса" })
    const legacy = await open(t, productId, { tableLabel: "Стол 2" }) // opened by a typed number, no hall
    await t.mutation(api.domains.orders.mutations.hold, { sessionToken: cashier, orderId: legacy._id })

    const floor = await t.query(api.domains.orders.floor.floor, { sessionToken: cashier })
    expect(floor.tableCount).toBe(3) // the inactive table and the other restaurant's are not on the plan
    expect(floor.truncated).toBe(false)
    expect(floor.halls.map((hall) => [hall.name, hall.tables.map((table) => table.label)])).toEqual([
      ["Основной зал", ["Стол 1", "Стол 2"]],
      ["Терраса", ["Стол 1"]],
    ])
    const [main, terraceHall] = floor.halls
    expect(main.tables[0]).toMatchObject({ label: "Стол 1", capacity: 6, checks: [] })
    expect(main.tables[1].checks).toEqual([expect.objectContaining({ orderId: legacy._id, status: "held", total: legacy.total, mine: true, kitchenSentAt: null })])
    expect(terraceHall.tables[0].checks).toEqual([expect.objectContaining({ orderId: terrace._id, status: "draft", hallLabel: "Терраса", number: terrace.number, createdAt: expect.any(Number) })])
    expect(floor.orphans).toEqual([])
  })

  it("keeps checks whose table is not on the plan — typed, takeaway — and drops paid ones", async () => {
    const { t, productId } = await setup()
    await addTables(t, [{ hall: "Зал", label: "Стол 1" }])
    const typed = await open(t, productId, { tableLabel: "Стол 40" })
    const takeaway = await open(t, productId, {})
    const wrongHall = await open(t, productId, { tableLabel: "Стол 1", hallLabel: "Веранда" })
    const paid = await open(t, productId, { tableLabel: "Стол 1", hallLabel: "Зал" })
    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: paid._id, idempotencyKey: "pay-1", payments: [{ method: "card", amount: paid.total }] })

    const floor = await t.query(api.domains.orders.floor.floor, { sessionToken: cashier })
    expect(floor.halls[0].tables[0].checks).toEqual([])
    expect(floor.orphans.map((check) => check.orderId)).toEqual([typed._id, takeaway._id, wrongHall._id])
    expect(floor.orphans[1].tableLabel).toBeUndefined()
  })

  it("a check of another terminal marks its table taken but is not the cashier's; other restaurants never show", async () => {
    const { t, productId } = await setup()
    await otherTerminals(t)
    await addTables(t, [{ hall: "Зал", label: "Стол 1" }, { hall: "Зал", label: "Стол 2" }])
    await open(t, productId, { tableLabel: "Стол 2", hallLabel: "Зал" }, "cashier-astana") // another restaurant's «Стол 2»
    const theirs = await open(t, productId, { tableLabel: "Стол 1", hallLabel: "Зал" }, "cashier-2")
    await open(t, productId, {}, "cashier-2") // their takeaway check is not in our orphans

    const floor = await t.query(api.domains.orders.floor.floor, { sessionToken: cashier })
    const [one, two] = floor.halls[0].tables
    expect(one.checks).toEqual([expect.objectContaining({ orderId: theirs._id, mine: false, terminalName: "Касса 2" })])
    expect(two.checks).toEqual([])
    expect(floor.orphans).toEqual([])

    // The other terminal sees the same table as its own.
    const fromSecond = await t.query(api.domains.orders.floor.floor, { sessionToken: "cashier-2" })
    expect(fromSecond.halls[0].tables[0].checks).toEqual([expect.objectContaining({ orderId: theirs._id, mine: true })])
    expect(fromSecond.halls[0].tables[0].checks[0].terminalName).toBeUndefined()
    expect(fromSecond.orphans).toHaveLength(1)
  })

  it("a restaurant without a plan returns no halls, only the open checks", async () => {
    const { t, productId } = await setup()
    const check = await open(t, productId, { tableLabel: "Стол 3" })
    const floor = await t.query(api.domains.orders.floor.floor, { sessionToken: cashier })
    expect(floor).toMatchObject({ halls: [], tableCount: 0, truncated: false })
    expect(floor.orphans.map((row) => row.orderId)).toEqual([check._id])
  })
})
