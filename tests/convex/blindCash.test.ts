import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import { cashier, draft, setup } from "./fixtures/pos"

// POS follow-ups: the blind count holds on the server (a cashier's open shift carries no cash figures,
// «Сверить» reveals and logs), and a check's lines carry the Kazakh names of their changed modifiers.

const shifts = api.domains.shifts
const manager = "manager-operator-token"

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** A cash sale of 2300 ₸ on a shift opened with 0; plus the manager signed in on the same terminal. */
async function withCashSale() {
  const fixture = await setup()
  const { t, productId } = fixture
  const order = await draft(t, productId)
  await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: order._id, idempotencyKey: "cash-sale", payments: [{ method: "cash", amount: order.total }] })
  await t.run(async (ctx) => {
    const approval = (await ctx.db.query("posSessions").take(10)).find((session) => session.purpose === "manager-approval")!
    await ctx.db.insert("posSessions", { createdAt: Date.now(), lastActivityAt: Date.now(), expiresAt: Date.now() + 3_600_000, terminalId: approval.terminalId, tokenHash: await digest(manager), purpose: "operator", employeeId: approval.employeeId })
  })
  return fixture
}

describe("blind cash for cashiers", () => {
  it("leaves the expected cash and the figures it follows from out of a cashier's open shift", async () => {
    const { t } = await withCashSale()
    const current = await t.query(shifts.queries.current, { sessionToken: cashier })
    expect(current?.cashVisible).toBe(false)
    expect(current?.summary).toMatchObject({ expectedCash: null, cashSales: null, cashRefunds: null, grossSales: null, refunds: null, netSales: null, card: 0, qr: 0, cashIn: 0, cashOut: 0, paymentCount: 1 })

    const preview = await t.query(shifts.queries.closePreview, { sessionToken: cashier })
    expect(preview).toMatchObject({ expectedCash: null, netSales: null, cashVisible: false, blockers: [], managerThreshold: 1000 })

    const history = await t.query(shifts.queries.history, { sessionToken: cashier, paginationOpts: { numItems: 5, cursor: null } })
    expect(history.page[0].summary).toMatchObject({ expectedCash: null, netSales: null })
  })

  it("shows everything to a manager", async () => {
    const { t } = await withCashSale()
    const current = await t.query(shifts.queries.current, { sessionToken: manager })
    expect(current?.cashVisible).toBe(true)
    expect(current?.summary).toMatchObject({ expectedCash: 2300, cashSales: 2300, netSales: 2300 })
    expect(await t.query(shifts.queries.closePreview, { sessionToken: manager })).toMatchObject({ expectedCash: 2300, cashVisible: true })
  })

  it("«Сверить» logs the counted amount and only then answers with the expected cash", async () => {
    const { t } = await withCashSale()
    await expect(t.mutation(shifts.mutations.reconcileCount, { sessionToken: cashier, countedCash: -5 })).rejects.toThrow(/отрицательной/)
    expect(await t.mutation(shifts.mutations.reconcileCount, { sessionToken: cashier, countedCash: 2000 })).toEqual({ countedCash: 2000, expectedCash: 2300, variance: -300, managerThreshold: 1000 })
    const audit = await t.run((ctx) => ctx.db.query("auditEvents").take(50))
    expect(audit.filter((event) => event.action === "shift.count")).toEqual([expect.objectContaining({ details: { countedCash: 2000, expectedCash: 2300, variance: -300 } })])
  })

  it("a cash-out over the drawer's cash is refused without naming the amount", async () => {
    const { t } = await withCashSale()
    await expect(t.mutation(shifts.mutations.recordCashMovement, { sessionToken: cashier, direction: "cash-out", amount: 5000, reason: "Инкассация", idempotencyKey: "out", managerApprovalToken: "m1" })).rejects.toThrow("Сумма больше, чем учтено в кассе")
  })

  it("a closed shift shows its totals to the cashier again", async () => {
    const { t } = await withCashSale()
    await t.mutation(shifts.mutations.close, { sessionToken: cashier, countedCash: 2300, note: "" })
    const history = await t.query(shifts.queries.history, { sessionToken: cashier, paginationOpts: { numItems: 5, cursor: null } })
    expect(history.page[0].summary).toMatchObject({ expectedCash: 2300, netSales: 2300 })
  })
})

describe("Kazakh names of a line's modifiers", () => {
  it("getCheck resolves them by the modifier's externalId; a modifier without one is left out", async () => {
    const { t, productId } = await setup()
    await t.run(async (ctx) => {
      const groupId = await ctx.db.insert("modifierGroups", { externalId: "extras", name: "Добавки", nameSort: "добавки", searchText: "добавки", sortOrder: 1, active: true })
      const onion = await ctx.db.insert("modifiers", { externalId: "onion", groupId, name: "Лук", nameKk: "Пияз", nameSort: "лук", searchText: "лук", price: 0, ingredientName: "Лук", ingredientQuantity: 0.02, unit: "кг", available: true, sortOrder: 1 })
      const sauce = await ctx.db.insert("modifiers", { externalId: "sauce", groupId, name: "Соус", nameSort: "соус", searchText: "соус", price: 200, ingredientName: "Соус", ingredientQuantity: 0.03, unit: "кг", available: true, sortOrder: 2 })
      const assignment = await ctx.db.insert("productModifierGroups", { productId, groupId, required: false, minQuantity: 0, maxQuantity: 5, freeQuantity: 0, enforceItemLimits: true, sortOrder: 1 })
      await ctx.db.insert("productModifierRules", { productModifierGroupId: assignment, modifierId: onion, minQuantity: 0, maxQuantity: 1, defaultQuantity: 1, freeQuantity: 0, sortOrder: 1 })
      await ctx.db.insert("productModifierRules", { productModifierGroupId: assignment, modifierId: sauce, minQuantity: 0, maxQuantity: 3, defaultQuantity: 0, freeQuantity: 0, sortOrder: 2 })
    })
    const saved = await t.mutation(api.domains.orders.mutations.saveDraft, {
      sessionToken: cashier,
      clientOrderId: "kk-mods",
      orderType: "dine-in",
      tableLabel: "Стол 3",
      discountPercent: 0,
      comment: "",
      lines: [{ clientLineId: "line-1", productId, quantity: 1, modifierSelections: [{ modifierExternalId: "onion", quantity: 0 }, { modifierExternalId: "sauce", quantity: 1 }] }],
    })
    if ("outcome" in saved) throw new Error(saved.outcome)
    const check = await t.query(api.domains.orders.queries.getCheck, { sessionToken: cashier, orderId: saved._id })
    expect(check?.lines[0].kitchenModifiers?.map((change) => change.externalId).sort()).toEqual(["onion", "sauce"])
    expect(check?.lines[0].modifierNamesKk).toEqual([{ externalId: "onion", nameKk: "Пияз" }])
  })
})
