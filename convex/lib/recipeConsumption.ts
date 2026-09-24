import type { GenericMutationCtx, GenericQueryCtx } from "convex/server"

import type { DataModel, Doc, Id } from "../_generated/dataModel"
import { isSystemAccountKey, SYSTEM_ACCOUNTS } from "./accounts"
import { postJournalEntry, reverseJournalEntries } from "./ledger"
import { recipeLinesOf, recipeVersionAt, MAX_PREPARATION_DEPTH } from "./recipes"
import { weightKg } from "./recipeMath"
import { applyStockMovement, reverseSourceMovements, roundQuantity } from "./stockAccounting"
import { stockAccountOf } from "./stockPosting"

type QueryCtx = GenericQueryCtx<DataModel>
type MutationCtx = GenericMutationCtx<DataModel>

// Sale write-off (W1-RCP-03): the recipe version in force at the sale, sizes by their write-off
// coefficient, modifier ingredients, preparations either as a finished product or expanded — never
// both (the «double write-off» rule). A sale never fails because of stock setup: problems become
// salesWithoutRecipe rows.

export type ConsumptionComponent = { inventoryItemId: Id<"inventoryItems">; quantity: number; sourceLineId: Id<"orderLines">; reason: "recipe" | "modifier" | "finished-product" | "preparation" }
export type ConsumptionWarning = { productId?: Id<"products">; orderLineId: Id<"orderLines">; code: "no-recipe" | "no-inventory-item" | "zero-weight" }

async function itemOfProduct(ctx: QueryCtx, product: Doc<"products">) {
  return ctx.db.query("inventoryItems").withIndex("by_product", (q) => q.eq("productExternalId", product.externalId)).first()
}

/**
 * Expands `batches` of a product's recipe into inventory quantities. A preparation written off as a
 * finished product is taken from its own stock item; otherwise its recipe is expanded (depth ≤ 3).
 */
async function expand(
  ctx: QueryCtx,
  product: Doc<"products">,
  batches: number,
  at: number,
  lineId: Id<"orderLines">,
  out: { components: ConsumptionComponent[]; warnings: ConsumptionWarning[] },
  depth: number,
) {
  const version = await recipeVersionAt(ctx, product._id, at)
  if (!version) {
    out.warnings.push({ productId: product._id, orderLineId: lineId, code: "no-recipe" })
    return
  }
  const factor = batches / (version.batchYield > 0 ? version.batchYield : 1)
  for (const line of await recipeLinesOf(ctx, version._id)) {
    if (line.kind === "item" && line.inventoryItemId) {
      out.components.push({ inventoryItemId: line.inventoryItemId, quantity: line.quantity * factor, sourceLineId: lineId, reason: depth === 0 ? "recipe" : "preparation" })
      continue
    }
    if (line.kind !== "preparation" || !line.componentProductId) continue
    const component = await ctx.db.get(line.componentProductId)
    if (!component) continue
    const neededKg = weightKg(line) * factor
    if (component.writeOffMethod === "finished-product" || depth + 1 >= MAX_PREPARATION_DEPTH) {
      const item = await itemOfProduct(ctx, component)
      if (!item) out.warnings.push({ productId: component._id, orderLineId: lineId, code: "no-inventory-item" })
      else out.components.push({ inventoryItemId: item._id, quantity: line.quantity * factor, sourceLineId: lineId, reason: "preparation" })
      continue
    }
    const componentVersion = await recipeVersionAt(ctx, component._id, at)
    if (!componentVersion) {
      out.warnings.push({ productId: component._id, orderLineId: lineId, code: "no-recipe" })
      continue
    }
    // Batches of the preparation needed = kg needed / kg one batch yields.
    const lines = await recipeLinesOf(ctx, componentVersion._id)
    const outputKg = lines.reduce((sum, row) => sum + weightKg(row) * (1 - row.coldLossPercent / 100) * (1 - row.hotLossPercent / 100), 0)
    if (!(outputKg > 0)) {
      out.warnings.push({ productId: component._id, orderLineId: lineId, code: "zero-weight" })
      continue
    }
    await expand(ctx, component, (neededKg / outputKg) * (componentVersion.batchYield > 0 ? componentVersion.batchYield : 1), at, lineId, out, depth + 1)
  }
}

export async function planOrderConsumption(ctx: QueryCtx, args: { lines: Doc<"orderLines">[]; at: number }) {
  const out = { components: [] as ConsumptionComponent[], warnings: [] as ConsumptionWarning[] }
  for (const line of args.lines) {
    const product = await ctx.db.get(line.productId)
    if (!product) continue
    const size = line.sizeOptionId ? await ctx.db.get(line.sizeOptionId) : null
    const portions = line.quantity * (size?.writeOffCoefficient ?? size?.coefficient ?? 1)
    if (product.writeOffMethod === "finished-product") {
      const item = await itemOfProduct(ctx, product)
      if (!item) out.warnings.push({ productId: product._id, orderLineId: line._id, code: "no-inventory-item" })
      else out.components.push({ inventoryItemId: item._id, quantity: portions, sourceLineId: line._id, reason: "finished-product" })
    } else {
      await expand(ctx, product, portions, args.at, line._id, out, 0)
    }
    for (const selection of line.modifierSelections ?? []) {
      const modifier = await ctx.db.query("modifiers").withIndex("by_external_id", (q) => q.eq("externalId", selection.externalId)).unique()
      if (modifier?.ingredientInventoryItemId && modifier.ingredientQuantity > 0) {
        out.components.push({ inventoryItemId: modifier.ingredientInventoryItemId, quantity: modifier.ingredientQuantity * selection.quantity * line.quantity, sourceLineId: line._id, reason: "modifier" })
      }
    }
  }
  return out
}

/** Terminal's sales warehouse, else the restaurant's isSalesDefault warehouse. */
export async function resolveSalesWarehouse(ctx: QueryCtx, terminal: Doc<"posTerminals"> | null, restaurantExternalId: string) {
  if (terminal?.salesWarehouseId) {
    const warehouse = await ctx.db.get(terminal.salesWarehouseId)
    if (warehouse?.active) return warehouse
  }
  const warehouses = await ctx.db.query("warehouses").withIndex("by_restaurant_active", (q) => q.eq("restaurantExternalId", restaurantExternalId).eq("active", true)).take(50)
  return warehouses.find((warehouse) => warehouse.isSalesDefault) ?? null
}

async function accountsReady(ctx: QueryCtx) {
  const cogs = await ctx.db.query("accounts").withIndex("by_external_id", (q) => q.eq("externalId", SYSTEM_ACCOUNTS.cogs.externalId)).unique()
  return Boolean(cogs?.active)
}

/**
 * Writes off an order's stock by recipe and posts its cost. A voided line written off as spoilage
 * (W1-POS-04) passes its own source, movement kind and expense account, so a later refund of the
 * order never returns that stock.
 */
export async function consumeOrderStock(
  ctx: MutationCtx,
  args: {
    order: Doc<"orders">
    lines: Doc<"orderLines">[]
    restaurantExternalId: string
    terminal: Doc<"posTerminals"> | null
    idempotencyKey: string
    occurredAt: number
    businessDate?: string
    sourceExternalId?: string
    movementKind?: "sale" | "writeoff"
    debitAccount?: string
  },
) {
  const orderSource = args.sourceExternalId ?? String(args.order._id)
  const warnings = async (codes: { code: Doc<"salesWithoutRecipe">["code"]; orderLineId?: Id<"orderLines">; productId?: Id<"products"> }[]) => {
    for (const warning of codes) await ctx.db.insert("salesWithoutRecipe", { orderId: args.order._id, ...warning, restaurantExternalId: args.restaurantExternalId, occurredAt: args.occurredAt })
  }
  const warehouse = await resolveSalesWarehouse(ctx, args.terminal, args.restaurantExternalId)
  if (!warehouse) {
    await warnings([{ code: "no-warehouse" }])
    return { cost: 0, movementIds: [] as Id<"stockMovements">[] }
  }
  const plan = await planOrderConsumption(ctx, { lines: args.lines, at: args.occurredAt })
  await warnings(plan.warnings)

  // One movement per item, in the item's unit.
  const byItem = new Map<Id<"inventoryItems">, number>()
  for (const component of plan.components) byItem.set(component.inventoryItemId, (byItem.get(component.inventoryItemId) ?? 0) + component.quantity)
  const movementIds: Id<"stockMovements">[] = []
  const costByAccount = new Map<string, number>()
  let index = 0
  for (const [inventoryItemId, quantity] of byItem) {
    index += 1
    const rounded = roundQuantity(quantity)
    if (rounded <= 0) continue
    const item = await ctx.db.get(inventoryItemId)
    if (!item) continue
    const movement = await applyStockMovement(ctx, {
      externalId: `sale:${args.idempotencyKey}:${index}`,
      kind: args.movementKind ?? "sale",
      sourceModuleId: "orders",
      sourceExternalId: orderSource,
      sourceNumber: String(args.order.number),
      warehouseId: warehouse._id,
      inventoryItemId,
      quantityDelta: -rounded,
      occurredAt: args.occurredAt,
      allowNegative: true, // a sale is never refused because the stock book is behind
    })
    movementIds.push(movement._id)
    const account = stockAccountOf(item)
    costByAccount.set(account, (costByAccount.get(account) ?? 0) + (movement.amount ?? 0))
  }
  const cost = [...costByAccount.values()].reduce((sum, amount) => sum + amount, 0)
  if (cost > 0) {
    if (!(await accountsReady(ctx))) await warnings([{ code: "no-accounts" }])
    else {
      for (const [account, amount] of costByAccount) {
        if (amount <= 0 || !isSystemAccountKey(account)) continue
        await postJournalEntry(ctx, {
          externalId: `sale:${args.idempotencyKey}:cogs:${account}`,
          restaurantExternalId: args.restaurantExternalId,
          sourceModuleId: "orders",
          sourceExternalId: orderSource,
          sourceNumber: String(args.order.number),
          occurredAt: args.occurredAt,
          businessDate: args.businessDate,
          debitAccount: args.debitAccount ?? "cogs",
          creditAccount: account,
          amount: Math.round(amount),
          description: args.debitAccount ? `Списание по заказу №${args.order.number}` : `Себестоимость заказа №${args.order.number}`,
          warehouseExternalId: warehouse.externalId,
        })
      }
    }
  }
  return { cost: Math.round(cost), movementIds }
}

/** Refund share (0..1) of the sale's stock and cost back (B-9 stock part). */
export async function reverseOrderConsumption(ctx: MutationCtx, args: { order: Doc<"orders">; refundKey: string; share: number; occurredAt: number; businessDate?: string }) {
  const source = String(args.order._id)
  await reverseSourceMovements(ctx, { sourceExternalId: source, occurredAt: args.occurredAt, reversalKey: args.refundKey, share: args.share, reason: "Возврат" })
  const hasCogs = await ctx.db.query("journalEntries").withIndex("by_source", (q) => q.eq("sourceExternalId", source)).first()
  if (hasCogs) await reverseJournalEntries(ctx, { sourceExternalId: source, occurredAt: args.occurredAt, reversalKey: args.refundKey, share: args.share, businessDate: args.businessDate, description: `Возврат по заказу №${args.order.number}`, only: (entry) => entry.debitAccountExternalId === SYSTEM_ACCOUNTS.cogs.externalId })
}
