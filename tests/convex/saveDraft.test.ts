import type { TestConvex } from "convex-test"
import type { FunctionArgs } from "convex/server"
import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import schema from "../../convex/schema"
import { cashier, setup } from "./fixtures/pos"

type T = TestConvex<typeof schema>
type SaveArgs = FunctionArgs<typeof api.domains.orders.mutations.saveDraft>

async function save(t: T, productId: Id<"products">, overrides: Partial<SaveArgs> = {}) {
  const result = await t.mutation(api.domains.orders.mutations.saveDraft, { sessionToken: cashier, clientOrderId: crypto.randomUUID(), orderType: "dine-in", discountPercent: 0, comment: "", lines: [{ clientLineId: "l1", productId, quantity: 2 }], ...overrides })
  if ("outcome" in result) throw new Error(result.outcome)
  return result
}

async function discountType(t: T, code: string, data: { mode: "percent" | "fixed" | "markup"; value: number; managerApprovalAbove: number; minimumOrder?: number }) {
  await t.run((ctx) =>
    ctx.db.insert("retailSettings", {
      externalId: `discount-type-${code}`,
      kind: "discount-type",
      code,
      name: code,
      status: "published",
      effectiveFrom: 0,
      sortOrder: 1,
      restaurantExternalIds: [],
      data: { kind: "discount-type", mode: data.mode, value: data.value, minimumOrder: data.minimumOrder ?? 0, priority: 1, managerApprovalAbove: data.managerApprovalAbove, manual: true, automatic: false, combinable: false },
      version: 1,
      searchText: code,
      createdAt: 0,
      updatedAt: 0,
    }),
  )
  return `discount-type-${code}`
}

describe("saveDraft pricing (W1-POS-03)", () => {
  it("takes the service charge from the order type: 15 % in the hall, 0 % takeaway — with and without retail settings", async () => {
    for (const ledger of [true, false]) {
      const { t, productId } = await setup({ ledger })
      expect(await save(t, productId)).toMatchObject({ subtotal: 2000, serviceChargePercent: 15, serviceChargeAmount: 300, total: 2300, orderTypeName: "В зале" })
      expect(await save(t, productId, { orderType: "takeaway" })).toMatchObject({ serviceChargePercent: 0, serviceChargeAmount: 0, total: 2000, orderTypeName: "С собой" })
    }
    const { t, productId } = await setup()
    const hall = await save(t, productId, { orderType: undefined, orderTypeExternalId: "order-type-dine-in", guestCount: 4, hallLabel: "Терраса" })
    expect(hall).toMatchObject({ orderType: "dine-in", guestCount: 4, hallLabel: "Терраса", retailConfigVersion: "order-type:dine-in@1" })
  })

  it("applies fixed, percent and markup discount types; above the threshold needs a manager", async () => {
    const { t, productId } = await setup()
    const fixed = await discountType(t, "minus500", { mode: "fixed", value: 500, managerApprovalAbove: 50, minimumOrder: 1500 })
    expect(await save(t, productId, { discountTypeExternalId: fixed })).toMatchObject({ discountAmount: 500, discountTypeName: "minus500", serviceChargeAmount: 225, total: 1725 })
    await expect(save(t, productId, { discountTypeExternalId: fixed, lines: [{ productId, quantity: 1 }] })).rejects.toThrow(/от 1500/)

    const big = await discountType(t, "staff", { mode: "percent", value: 30, managerApprovalAbove: 20 })
    await expect(save(t, productId, { discountTypeExternalId: big })).rejects.toThrow(/менеджер/i)
    expect(await save(t, productId, { discountTypeExternalId: big, managerApprovalToken: "m1" })).toMatchObject({ discountPercent: 30, discountAmount: 600, total: 1610 })

    const markup = await discountType(t, "banquet", { mode: "markup", value: 10, managerApprovalAbove: 50 })
    expect(await save(t, productId, { discountTypeExternalId: markup })).toMatchObject({ discountAmount: -200, total: 2530 })
  })

  it("prices sizes and modifiers on the server: free portions, over-max rejected", async () => {
    const { t, productId } = await setup()
    await t.run(async (ctx) => {
      const scaleId = await ctx.db.insert("sizeScales", { externalId: "s", name: "s", nameSort: "s", searchText: "s", sortOrder: 1 })
      await ctx.db.insert("sizeOptions", { externalId: "half", scaleId, label: "Половина", kitchenLabel: "½", coefficient: 0.5, sortOrder: 1, isDefault: true, available: true })
      await ctx.db.insert("sizeOptions", { externalId: "big", scaleId, label: "Большой", kitchenLabel: "Б", coefficient: 1.5, sortOrder: 2, isDefault: false, available: true })
      await ctx.db.patch(productId, { sizeScaleId: scaleId })
      const groupId = await ctx.db.insert("modifierGroups", { externalId: "g", name: "Добавки", nameSort: "добавки", searchText: "добавки", sortOrder: 1, active: true })
      const cheese = await ctx.db.insert("modifiers", { externalId: "cheese", groupId, name: "Сыр", nameSort: "сыр", searchText: "сыр", price: 300, ingredientName: "Сыр", ingredientQuantity: 0.03, unit: "кг", available: true, sortOrder: 1 })
      const assignment = await ctx.db.insert("productModifierGroups", { productId, groupId, required: false, minQuantity: 0, maxQuantity: 3, freeQuantity: 0, enforceItemLimits: true, sortOrder: 1 })
      await ctx.db.insert("productModifierRules", { productModifierGroupId: assignment, modifierId: cheese, minQuantity: 0, maxQuantity: 3, defaultQuantity: 0, freeQuantity: 1, sortOrder: 1 })
    })
    const order = await save(t, productId, { lines: [{ clientLineId: "l1", productId, quantity: 2, sizeExternalId: "big", modifierSelections: [{ modifierExternalId: "cheese", quantity: 2 }] }] })
    // 1000 × 1.5 = 1500 per portion + one paid cheese (300) → 1800 × 2
    expect(order.lines[0]).toMatchObject({ unitPrice: 1500, sizeLabel: "Большой", lineTotal: 3600, kitchenModifiers: [{ label: "+СЫР ×2" }] })
    expect(order.subtotal).toBe(3600)
    expect((await save(t, productId, { lines: [{ productId, quantity: 1 }] })).lines[0]).toMatchObject({ unitPrice: 500, sizeLabel: "Половина" })
    await expect(save(t, productId, { lines: [{ productId, quantity: 1, modifierSelections: [{ modifierExternalId: "cheese", quantity: 4 }] }] })).rejects.toThrow(/количество «Сыр»/)
    await expect(save(t, productId, { lines: [{ productId, quantity: 1, sizeExternalId: "nope" }] })).rejects.toThrow(/размер/)
  })

  it("refuses a stop-listed dish, a stale version and changing a line already on the kitchen ticket", async () => {
    const { t, productId } = await setup()
    const order = await save(t, productId)
    await expect(save(t, productId, { orderId: order._id, clientOrderId: order.clientOrderId!, expectedVersion: 99 })).rejects.toThrow(/изменён на другой кассе/)

    const [line] = order.lines
    await t.run((ctx) => ctx.db.patch(line._id, { sentToKitchenAt: Date.now() }))
    await expect(save(t, productId, { orderId: order._id, clientOrderId: order.clientOrderId!, lines: [{ clientLineId: "l1", productId, quantity: 1 }] })).rejects.toThrow(/уже на кухне/)
    await expect(save(t, productId, { orderId: order._id, clientOrderId: order.clientOrderId!, lines: [] })).rejects.toThrow(/уже на кухне/)
    const added = await save(t, productId, { orderId: order._id, clientOrderId: order.clientOrderId!, lines: [{ clientLineId: "l1", productId, quantity: 2 }, { clientLineId: "l2", productId, quantity: 1 }] })
    expect(added.subtotal).toBe(3000)
    expect(added.lines.find((row) => row.clientLineId === "l1")?.sentToKitchenAt).toBeDefined()

    await t.run((ctx) => ctx.db.insert("productAvailability", { productId, restaurantExternalId: "almaty", available: false, reason: "Закончилось", updatedBy: "test", updatedAt: Date.now() }))
    await expect(save(t, productId, { lines: [{ productId, quantity: 1 }] })).rejects.toThrow(/нет в наличии/)
  })
})
