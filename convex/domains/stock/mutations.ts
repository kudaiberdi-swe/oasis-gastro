import { v, ConvexError } from "convex/values"

import { mutation } from "../../_generated/server"
import type { Id } from "../../_generated/dataModel"
import type { MutationCtx } from "../../_generated/server"
import { postLedgerEntry } from "../../lib/finance"
import { getOfficeAuthEmail, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"
import { unit } from "../../lib/validators"
import { assertPeriodOpen } from "../../lib/periods"
import { businessDateFor } from "../../lib/time"

async function getOrCreateBalance(ctx: MutationCtx, restaurantExternalId: string, inventoryItemId: Id<"inventoryItems">) {
  const existing = await ctx.db
    .query("stockBalances")
    .withIndex("by_restaurant_item", (q) => q.eq("restaurantExternalId", restaurantExternalId).eq("inventoryItemId", inventoryItemId))
    .unique()
  if (existing) return existing
  const id = await ctx.db.insert("stockBalances", { restaurantExternalId, inventoryItemId, quantity: 0, averageUnitCost: 0, updatedAt: Date.now() })
  return (await ctx.db.get(id))!
}

export const createInventoryItem = mutation({
  args: { name: v.string(), unit, minimumStock: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.stock.*")
    const email = await getOfficeAuthEmail(ctx)
    const externalId = crypto.randomUUID()
    const itemId = await ctx.db.insert("inventoryItems", {
      externalId,
      name: args.name,
      nameSort: args.name,
      searchText: args.name.toLocaleLowerCase("ru"),
      unit: args.unit,
      minimumStock: args.minimumStock,
      active: true,
    })
    await writeOfficeAudit(ctx, email!, { action: "stock.item.create", summary: `Добавлен товар «${args.name}»`, resourceType: "inventory-item", resourceExternalId: externalId })
    return itemId
  },
})

export const receiveStock = mutation({
  args: { inventoryItemId: v.id("inventoryItems"), restaurantExternalId: v.string(), quantity: v.number(), unitCost: v.number() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.stock.*")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    await assertStockPeriodOpen(ctx, args.restaurantExternalId)
    if (args.quantity <= 0) throw new ConvexError("Количество должно быть больше нуля")
    if (args.unitCost < 0) throw new ConvexError("Цена не может быть отрицательной")
    const email = await getOfficeAuthEmail(ctx)
    const item = await ctx.db.get(args.inventoryItemId)
    if (!item) throw new ConvexError("Товар не найден")

    const balance = await getOrCreateBalance(ctx, args.restaurantExternalId, args.inventoryItemId)
    const newQuantity = balance.quantity + args.quantity
    const newAverageCost = newQuantity > 0 ? (balance.quantity * balance.averageUnitCost + args.quantity * args.unitCost) / newQuantity : 0
    const now = Date.now()
    await ctx.db.patch(balance._id, { quantity: newQuantity, averageUnitCost: newAverageCost, updatedAt: now })
    const movementId = await ctx.db.insert("stockMovements", {
      restaurantExternalId: args.restaurantExternalId,
      inventoryItemId: args.inventoryItemId,
      kind: "receipt",
      quantityDelta: args.quantity,
      unitCost: args.unitCost,
      balanceAfter: newQuantity,
      averageUnitCostAfter: newAverageCost,
      actorEmail: email!,
      occurredAt: now,
    })
    await postLedgerEntry(ctx, {
      restaurantExternalId: args.restaurantExternalId,
      occurredAt: now,
      kind: "expense",
      category: "Закупка сырья",
      amount: args.quantity * args.unitCost,
      sourceModuleId: "stock",
      sourceExternalId: String(movementId),
      description: `Приход «${item.name}»: ${args.quantity} ${item.unit}`,
      createdByEmail: email!,
    })
    await writeOfficeAudit(ctx, email!, {
      action: "stock.receipt",
      summary: `Приход «${item.name}»: +${args.quantity} ${item.unit} по ${args.unitCost} ₸`,
      resourceType: "inventory-item",
      resourceExternalId: item.externalId,
      restaurantExternalId: args.restaurantExternalId,
    })
  },
})

export const writeOffStock = mutation({
  args: { inventoryItemId: v.id("inventoryItems"), restaurantExternalId: v.string(), quantity: v.number(), reason: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.stock.*")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    await assertStockPeriodOpen(ctx, args.restaurantExternalId)
    if (args.quantity <= 0) throw new ConvexError("Количество должно быть больше нуля")
    if (!args.reason.trim()) throw new ConvexError("Укажите причину списания")
    const email = await getOfficeAuthEmail(ctx)
    const item = await ctx.db.get(args.inventoryItemId)
    if (!item) throw new ConvexError("Товар не найден")

    const balance = await getOrCreateBalance(ctx, args.restaurantExternalId, args.inventoryItemId)
    if (balance.quantity < args.quantity) throw new ConvexError(`Недостаточно остатка: на складе ${balance.quantity} ${item.unit}`)
    const newQuantity = balance.quantity - args.quantity
    const now = Date.now()
    await ctx.db.patch(balance._id, { quantity: newQuantity, updatedAt: now })
    await ctx.db.insert("stockMovements", {
      restaurantExternalId: args.restaurantExternalId,
      inventoryItemId: args.inventoryItemId,
      kind: "writeoff",
      quantityDelta: -args.quantity,
      unitCost: balance.averageUnitCost,
      balanceAfter: newQuantity,
      averageUnitCostAfter: balance.averageUnitCost,
      reason: args.reason.trim(),
      actorEmail: email!,
      occurredAt: now,
    })
    await writeOfficeAudit(ctx, email!, {
      action: "stock.writeoff",
      summary: `Списание «${item.name}»: -${args.quantity} ${item.unit} (${args.reason.trim()})`,
      resourceType: "inventory-item",
      resourceExternalId: item.externalId,
      restaurantExternalId: args.restaurantExternalId,
    })
  },
})

export const adjustStock = mutation({
  args: { inventoryItemId: v.id("inventoryItems"), restaurantExternalId: v.string(), actualQuantity: v.number(), reason: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.stock.*")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    await assertStockPeriodOpen(ctx, args.restaurantExternalId)
    if (args.actualQuantity < 0) throw new ConvexError("Остаток не может быть отрицательным")
    if (!args.reason.trim()) throw new ConvexError("Укажите причину корректировки")
    const email = await getOfficeAuthEmail(ctx)
    const item = await ctx.db.get(args.inventoryItemId)
    if (!item) throw new ConvexError("Товар не найден")

    const balance = await getOrCreateBalance(ctx, args.restaurantExternalId, args.inventoryItemId)
    const delta = args.actualQuantity - balance.quantity
    if (delta === 0) return
    const now = Date.now()
    await ctx.db.patch(balance._id, { quantity: args.actualQuantity, updatedAt: now })
    await ctx.db.insert("stockMovements", {
      restaurantExternalId: args.restaurantExternalId,
      inventoryItemId: args.inventoryItemId,
      kind: "adjustment",
      quantityDelta: delta,
      unitCost: balance.averageUnitCost,
      balanceAfter: args.actualQuantity,
      averageUnitCostAfter: balance.averageUnitCost,
      reason: args.reason.trim(),
      actorEmail: email!,
      occurredAt: now,
    })
    await writeOfficeAudit(ctx, email!, {
      action: "stock.adjustment",
      summary: `Инвентаризация «${item.name}»: ${delta > 0 ? "+" : ""}${delta} ${item.unit} (${args.reason.trim()})`,
      resourceType: "inventory-item",
      resourceExternalId: item.externalId,
      restaurantExternalId: args.restaurantExternalId,
    })
  },
})

/** Stock documents post today; a closed period for this restaurant (or its organization) blocks them. */
async function assertStockPeriodOpen(ctx: MutationCtx, restaurantExternalId: string) {
  const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", restaurantExternalId)).unique()
  if (!restaurant) throw new ConvexError("Ресторан не найден")
  await assertPeriodOpen(ctx, {
    organizationExternalId: restaurant.organizationExternalId,
    restaurantExternalId,
    businessDate: businessDateFor(Date.now(), restaurant.businessDayCutoffMinutes),
    moduleId: "stock",
  })
}
