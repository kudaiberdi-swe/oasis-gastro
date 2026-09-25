import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { mutation, query, type MutationCtx, type QueryCtx } from "../../_generated/server"
import type { Doc, Id } from "../../_generated/dataModel"
import { postJournalEntry } from "../../lib/ledger"
import { nextNumber } from "../../lib/numbering"
import { getOfficeAuthEmail, requireOfficeCapability, requireRestaurantScope, requireWarehouseScope, writeOfficeAudit } from "../../lib/officeAccess"
import { appendOutboxEvent } from "../../lib/outbox"
import { assertPeriodOpen } from "../../lib/periods"
import { planRecipeOutput } from "../../lib/recipeConsumption"
import { applyStockMovement, roundQuantity } from "../../lib/stockAccounting"
import { reverseStockSource, stockAccountOf } from "../../lib/stockPosting"
import { businessDateFor } from "../../lib/time"

// Production and logistics (W2-PRD-02…06). Amounts are always the stock movements' own cost (B-17) —
// never a price sent by the client — and a reversal mirrors what was posted.

type DocType = Doc<"productionDocuments">["type"]
const TYPE = v.union(v.literal("production"), v.literal("processing"), v.literal("assembly"), v.literal("sales"), v.literal("internal-order"), v.literal("purchase-order"))
const CONFIG: Record<DocType, { section: string; prefix: string; label: string; approval: boolean }> = {
  production: { section: "production", prefix: "АП", label: "Акт приготовления", approval: false },
  processing: { section: "processing-acts", prefix: "АПР", label: "Акт переработки", approval: false },
  assembly: { section: "assembly-acts", prefix: "АР", label: "Акт разбора", approval: false },
  sales: { section: "sales-acts", prefix: "АРЛ", label: "Акт реализации", approval: false },
  "internal-order": { section: "internal-orders", prefix: "ВЗ", label: "Внутренний заказ", approval: true },
  "purchase-order": { section: "purchase-orders", prefix: "ЗП", label: "Заказ поставщику", approval: true },
}
const cap = (type: DocType, action: string) => `office.${CONFIG[type].section}.${action}`

const lineInput = v.object({ productExternalId: v.optional(v.string()), inventoryItemExternalId: v.optional(v.string()), quantity: v.number(), direction: v.optional(v.union(v.literal("input"), v.literal("output"))), expectedUnitCost: v.optional(v.number()), costShare: v.optional(v.number()) })

async function requireDoc(ctx: QueryCtx, externalId: string) {
  const doc = await ctx.db.query("productionDocuments").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!doc) throw new ConvexError("Документ не найден")
  return doc
}

async function warehouseOf(ctx: QueryCtx, externalId: string | undefined) {
  if (!externalId) return null
  const warehouse = await ctx.db.query("warehouses").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!warehouse?.active) throw new ConvexError("Склад не найден или отключён")
  return warehouse
}

export const listDocuments = query({
  args: { type: TYPE, status: v.optional(v.string()), restaurantExternalId: v.optional(v.string()), search: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, cap(args.type, "view"))
    if (args.restaurantExternalId) await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const needle = args.search?.trim().toLocaleLowerCase("ru")
    const status = args.status as Doc<"productionDocuments">["status"] | undefined
    const page = needle
      ? await ctx.db.query("productionDocuments").withSearchIndex("search_production_documents", (q) => {
          let scoped = q.search("searchText", needle).eq("type", args.type)
          if (args.restaurantExternalId) scoped = scoped.eq("restaurantExternalId", args.restaurantExternalId)
          return scoped
        }).filter((q) => (status ? q.eq(q.field("status"), status) : true)).paginate(args.paginationOpts)
      : args.restaurantExternalId
        ? await ctx.db.query("productionDocuments").withIndex("by_type_restaurant_date", (q) => q.eq("type", args.type).eq("restaurantExternalId", args.restaurantExternalId!)).order("desc").filter((q) => (status ? q.eq(q.field("status"), status) : true)).paginate(args.paginationOpts)
        : await ctx.db.query("productionDocuments").withIndex("by_type_status_date", (q) => (status ? q.eq("type", args.type).eq("status", status) : q.eq("type", args.type))).order("desc").paginate(args.paginationOpts)
    const network = user.restaurantScopes.includes("*")
    const rows = page.page.filter((doc) => (network || user.restaurantScopes.includes(doc.restaurantExternalId)) && (!status || doc.status === status))
    // Names for the register, so it needs no warehouse or supplier rights of its own.
    const names = new Map<string, string>()
    const nameOf = async (id: Id<"warehouses"> | Id<"suppliers"> | undefined) => {
      if (!id) return null
      if (!names.has(id)) names.set(id, (await ctx.db.get(id))?.name ?? "—")
      return names.get(id)!
    }
    return { ...page, page: await Promise.all(rows.map(async (doc) => ({ ...doc, sourceWarehouseName: await nameOf(doc.sourceWarehouseId), destinationWarehouseName: await nameOf(doc.destinationWarehouseId), supplierName: await nameOf(doc.supplierId) }))) }
  },
})

export const getDocument = query({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const doc = await ctx.db.query("productionDocuments").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!doc) return null
    const { user } = await requireOfficeCapability(ctx, cap(doc.type, "view"))
    await requireRestaurantScope(ctx, user, doc.restaurantExternalId)
    const [source, destination, supplier] = await Promise.all([doc.sourceWarehouseId ? ctx.db.get(doc.sourceWarehouseId) : null, doc.destinationWarehouseId ? ctx.db.get(doc.destinationWarehouseId) : null, doc.supplierId ? ctx.db.get(doc.supplierId) : null])
    // Lines carry the external ids saveDocument takes back.
    const lines = await Promise.all(doc.lines.map(async (line) => {
      const product = line.productId ? await ctx.db.get(line.productId) : null
      const item = line.inventoryItemId ? await ctx.db.get(line.inventoryItemId) : null
      return { ...line, productExternalId: product?.externalId ?? null, inventoryItemExternalId: item?.externalId ?? null, unit: item?.unit ?? product?.baseUnit ?? null }
    }))
    return { ...doc, lines, sourceWarehouse: source ? { externalId: source.externalId, name: source.name } : null, destinationWarehouse: destination ? { externalId: destination.externalId, name: destination.name } : null, supplier: supplier ? { externalId: supplier.externalId, name: supplier.name } : null }
  },
})

/** Saves a draft (creates it when externalId is absent). The server numbers and prices; lines are resolved here. */
export const saveDocument = mutation({
  args: {
    externalId: v.optional(v.string()),
    type: TYPE,
    restaurantExternalId: v.string(),
    date: v.number(),
    sourceWarehouseExternalId: v.optional(v.string()),
    destinationWarehouseExternalId: v.optional(v.string()),
    supplierExternalId: v.optional(v.string()),
    expectedDate: v.optional(v.number()),
    concept: v.optional(v.string()),
    comment: v.string(),
    lines: v.array(lineInput),
  },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, cap(args.type, "edit"))
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.restaurantExternalId)).unique()
    if (!restaurant) throw new ConvexError("Ресторан не найден")
    const source = await warehouseOf(ctx, args.sourceWarehouseExternalId)
    const destination = await warehouseOf(ctx, args.destinationWarehouseExternalId)
    for (const warehouse of [source, destination]) if (warehouse) await requireWarehouseScope(ctx, user, warehouse.externalId, role)
    const needsSource = args.type !== "purchase-order"
    const needsDestination = args.type === "production" || args.type === "processing" || args.type === "assembly" || args.type === "internal-order" || args.type === "purchase-order"
    if (needsSource && !source) throw new ConvexError("Выберите склад-источник")
    if (needsDestination && !destination) throw new ConvexError("Выберите склад назначения")
    // Both warehouses belong to the restaurant, except an internal order between restaurants of one organization.
    for (const warehouse of [source, destination]) {
      if (!warehouse) continue
      if (args.type === "internal-order") {
        if (warehouse.organizationExternalId !== restaurant.organizationExternalId) throw new ConvexError("Склады должны быть в одной организации")
        if (!warehouse.internalTransfers) throw new ConvexError(`Склад «${warehouse.name}» не принимает внутренние перемещения`)
      } else if (warehouse.restaurantExternalId !== restaurant.externalId && !(args.type === "purchase-order" && warehouse === destination && warehouse.restaurantExternalId === restaurant.externalId)) {
        throw new ConvexError("Склады документа должны принадлежать ресторану")
      }
    }
    if (source && destination && source._id === destination._id && args.type === "internal-order") throw new ConvexError("Склады источника и назначения совпадают")
    const supplier = args.supplierExternalId ? await ctx.db.query("suppliers").withIndex("by_external_id", (q) => q.eq("externalId", args.supplierExternalId!)).unique() : null
    if (args.type === "purchase-order" && !supplier) throw new ConvexError("Выберите поставщика")
    if (!args.lines.length) throw new ConvexError("Добавьте строки")

    const lines: Doc<"productionDocuments">["lines"] = []
    for (const [index, input] of args.lines.entries()) {
      if (!(input.quantity > 0)) throw new ConvexError("Количество должно быть больше нуля")
      if (args.type === "production") {
        const product = input.productExternalId ? await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", input.productExternalId!)).unique() : null
        if (!product || product.itemType !== "preparation") throw new ConvexError("Выпускать можно только заготовку")
        lines.push({ lineNo: index + 1, productId: product._id, name: product.name, quantity: roundQuantity(input.quantity), direction: "output" as const })
        continue
      }
      const item = input.inventoryItemExternalId ? await ctx.db.query("inventoryItems").withIndex("by_external_id", (q) => q.eq("externalId", input.inventoryItemExternalId!)).unique() : null
      if (!item) throw new ConvexError("Складская позиция не найдена")
      const direction = args.type === "processing" || args.type === "assembly" ? (input.direction ?? "input") : args.type === "purchase-order" ? "output" : "input"
      if (input.costShare !== undefined && !(input.costShare > 0)) throw new ConvexError("Доля себестоимости должна быть больше нуля")
      lines.push({ lineNo: index + 1, inventoryItemId: item._id, name: item.name, quantity: roundQuantity(input.quantity), direction, ...(input.expectedUnitCost !== undefined ? { expectedUnitCost: input.expectedUnitCost } : {}), ...(input.costShare !== undefined ? { costShare: input.costShare } : {}) })
    }
    if ((args.type === "processing" || args.type === "assembly") && (!lines.some((line) => line.direction === "input") || !lines.some((line) => line.direction === "output"))) throw new ConvexError("Нужны строки входа и выхода")

    const warnings: string[] = []
    if (args.type === "purchase-order" && supplier?.minimumOrder) {
      const expected = lines.reduce((sum, line) => sum + (line.expectedUnitCost ?? 0) * line.quantity, 0)
      if (expected < supplier.minimumOrder) warnings.push(`Минимальный заказ поставщика — ${supplier.minimumOrder} ₸`)
    }
    const now = Date.now()
    const value = {
      date: args.date,
      sourceWarehouseId: source?._id,
      destinationWarehouseId: destination?._id,
      supplierId: supplier?._id,
      expectedDate: args.expectedDate,
      concept: args.concept?.trim() || undefined,
      comment: args.comment.trim(),
      lines,
      totalAmount: args.type === "purchase-order" ? Math.round(lines.reduce((sum, line) => sum + (line.expectedUnitCost ?? 0) * line.quantity, 0)) : 0,
      updatedAt: now,
    }
    let externalId = args.externalId
    if (externalId) {
      const existing = await requireDoc(ctx, externalId)
      if (existing.type !== args.type || existing.restaurantExternalId !== args.restaurantExternalId) throw new ConvexError("Документ не найден")
      if (existing.status !== "draft") throw new ConvexError("Изменить можно только черновик")
      await ctx.db.patch(existing._id, { ...value, searchText: `${existing.number} ${lines.map((line) => line.name).join(" ")} ${value.comment}`.toLocaleLowerCase("ru"), version: existing.version + 1 })
    } else {
      const number = await nextNumber(ctx, { moduleId: CONFIG[args.type].section, prefix: CONFIG[args.type].prefix, organizationExternalId: restaurant.organizationExternalId, businessDate: businessDateFor(args.date, restaurant.businessDayCutoffMinutes) })
      externalId = `${args.type}-${crypto.randomUUID()}`
      await ctx.db.insert("productionDocuments", { ...value, externalId, type: args.type, number, status: "draft", organizationExternalId: restaurant.organizationExternalId, restaurantExternalId: restaurant.externalId, searchText: `${number} ${lines.map((line) => line.name).join(" ")} ${value.comment}`.toLocaleLowerCase("ru"), version: 1, createdBy: email, createdAt: now })
    }
    await writeOfficeAudit(ctx, email, { action: `${CONFIG[args.type].section}.save`, summary: `${CONFIG[args.type].label}: черновик, ${lines.length} строк`, resourceType: CONFIG[args.type].section, resourceExternalId: externalId, restaurantExternalId: restaurant.externalId, capability: cap(args.type, "edit") })
    return { externalId, warnings }
  },
})

/** Approval steps of internal and purchase orders, and cancelling any draft. */
export const transitionDocument = mutation({
  args: { externalId: v.string(), action: v.union(v.literal("submit"), v.literal("approve"), v.literal("cancel")), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const doc = await requireDoc(ctx, args.externalId)
    const config = CONFIG[doc.type]
    const { user } = await requireOfficeCapability(ctx, cap(doc.type, args.action === "submit" ? "edit" : args.action))
    await requireRestaurantScope(ctx, user, doc.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    const allowed: Record<string, string[]> = { submit: ["draft"], approve: ["pending-approval"], cancel: config.approval ? ["draft", "pending-approval", "approved"] : ["draft"] }
    if (!config.approval && args.action !== "cancel") throw new ConvexError("Действие недоступно для этого документа")
    if (!allowed[args.action].includes(doc.status)) throw new ConvexError("Действие недоступно для текущего статуса")
    if (args.action === "cancel" && (args.reason?.trim().length ?? 0) < 3) throw new ConvexError("Укажите причину")
    const status = args.action === "submit" ? "pending-approval" : args.action === "approve" ? "approved" : "cancelled"
    await ctx.db.patch(doc._id, { status, version: doc.version + 1, updatedAt: Date.now() })
    await writeOfficeAudit(ctx, email, { action: `${config.section}.${args.action}`, summary: `${config.label} ${doc.number}: ${status}`, resourceType: config.section, resourceExternalId: doc.externalId, restaurantExternalId: doc.restaurantExternalId, capability: cap(doc.type, args.action === "submit" ? "edit" : args.action) })
  },
})

type Shortage = { inventoryItemExternalId: string; name: string; needed: number; onHand: number }

async function onHandAt(ctx: QueryCtx, warehouseId: Id<"warehouses">, itemId: Id<"inventoryItems">) {
  const balance = await ctx.db.query("stockBalances").withIndex("by_warehouse_item", (q) => q.eq("warehouseId", warehouseId).eq("inventoryItemId", itemId)).unique()
  return balance?.quantity ?? 0
}

/** Posts a document. Production acts first report shortages and post only with confirmShortage. */
export const postDocument = mutation({
  args: { externalId: v.string(), confirmShortage: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const doc = await requireDoc(ctx, args.externalId)
    const config = CONFIG[doc.type]
    const { user } = await requireOfficeCapability(ctx, cap(doc.type, "post"))
    await requireRestaurantScope(ctx, user, doc.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    if (doc.type === "purchase-order") throw new ConvexError("Заказ поставщику закрывается приходной накладной")
    if (doc.status === "posted") return { kind: "posted" as const, totalAmount: doc.totalAmount }
    if (config.approval ? doc.status !== "approved" : doc.status !== "draft") throw new ConvexError(config.approval ? "Провести можно только согласованный документ" : "Провести можно только черновик")
    await assertPeriodOpen(ctx, { organizationExternalId: doc.organizationExternalId, restaurantExternalId: doc.restaurantExternalId, businessDate: businessDateFor(doc.date), moduleId: config.section })
    const source = doc.sourceWarehouseId ? (await ctx.db.get(doc.sourceWarehouseId))! : null
    const destination = doc.destinationWarehouseId ? (await ctx.db.get(doc.destinationWarehouseId))! : null
    const base = { sourceModuleId: config.section, sourceExternalId: doc.externalId, sourceNumber: doc.number, occurredAt: doc.date, actorEmail: email }
    const entries = new Map<string, { debit: string; credit: string; amount: number; restaurant: string }>()
    const addEntry = (debit: string, credit: string, amount: number, restaurant = doc.restaurantExternalId) => {
      if (amount <= 0 || debit === credit) return
      const key = `${debit}:${credit}:${restaurant}`
      const row = entries.get(key) ?? { debit, credit, amount: 0, restaurant }
      row.amount += amount
      entries.set(key, row)
    }
    const lines = doc.lines.map((line) => ({ ...line }))
    let total = 0

    if (doc.type === "production") {
      // The recipe version at the act date × quantity; shortages confirmed in a second step.
      const plans = []
      for (const line of lines) {
        const product = (await ctx.db.get(line.productId!))!
        if (product.writeOffMethod !== "finished-product") throw new ConvexError(`«${product.name}» должна списываться готовым продуктом — иначе её состав спишется дважды`)
        const output = await ctx.db.query("inventoryItems").withIndex("by_product", (q) => q.eq("productExternalId", product.externalId)).first()
        if (!output) throw new ConvexError(`У заготовки «${product.name}» нет складской позиции`)
        const plan = await planRecipeOutput(ctx, product, line.quantity, doc.date)
        if (plan.warnings.length || !plan.components.length) throw new ConvexError(`У «${product.name}» нет действующей техкарты или состава`)
        plans.push({ line, output, plan })
      }
      const needed = new Map<Id<"inventoryItems">, number>()
      for (const { plan } of plans) for (const component of plan.components) needed.set(component.inventoryItemId, (needed.get(component.inventoryItemId) ?? 0) + component.quantity)
      const shortages: Shortage[] = []
      for (const [itemId, quantity] of needed) {
        const onHand = await onHandAt(ctx, source!._id, itemId)
        if (onHand + 1e-6 < quantity) {
          const item = (await ctx.db.get(itemId))!
          shortages.push({ inventoryItemExternalId: item.externalId, name: item.name, needed: roundQuantity(quantity), onHand: roundQuantity(onHand) })
        }
      }
      if (shortages.length && !args.confirmShortage) return { kind: "shortage-confirmation" as const, shortages }
      for (const { line, output, plan } of plans) {
        let lineCost = 0
        for (const [index, component] of plan.components.entries()) {
          const item = (await ctx.db.get(component.inventoryItemId))!
          const movement = await applyStockMovement(ctx, { ...base, externalId: `${doc.externalId}:${line.lineNo}:in-${index}`, kind: "production", warehouseId: source!._id, inventoryItemId: item._id, quantityDelta: -roundQuantity(component.quantity), allowNegative: true })
          lineCost += movement.amount ?? 0
          addEntry(stockAccountOf(output), stockAccountOf(item), movement.amount ?? 0)
        }
        await applyStockMovement(ctx, { ...base, externalId: `${doc.externalId}:${line.lineNo}:out`, kind: "production", warehouseId: destination!._id, inventoryItemId: output._id, quantityDelta: line.quantity, unitCost: line.quantity > 0 ? lineCost / line.quantity : 0 })
        line.amount = Math.round(lineCost)
        total += lineCost
      }
    } else if (doc.type === "processing" || doc.type === "assembly") {
      // Inputs leave the source at its average; outputs share that cost by costShare or quantity.
      const inputs = lines.filter((line) => line.direction === "input")
      const outputs = lines.filter((line) => line.direction === "output")
      const inputCost = new Map<string, number>()
      for (const line of inputs) {
        const item = (await ctx.db.get(line.inventoryItemId!))!
        const movement = await applyStockMovement(ctx, { ...base, externalId: `${doc.externalId}:${line.lineNo}:in`, kind: "production", warehouseId: source!._id, inventoryItemId: item._id, quantityDelta: -line.quantity })
        line.amount = Math.round(movement.amount ?? 0)
        inputCost.set(stockAccountOf(item), (inputCost.get(stockAccountOf(item)) ?? 0) + (movement.amount ?? 0))
        total += movement.amount ?? 0
      }
      const weights = outputs.map((line) => line.costShare ?? line.quantity)
      const weightTotal = weights.reduce((sum, value) => sum + value, 0)
      for (const [index, line] of outputs.entries()) {
        const item = (await ctx.db.get(line.inventoryItemId!))!
        const share = weightTotal > 0 ? weights[index] / weightTotal : 0
        const cost = total * share
        await applyStockMovement(ctx, { ...base, externalId: `${doc.externalId}:${line.lineNo}:out`, kind: "production", warehouseId: destination!._id, inventoryItemId: item._id, quantityDelta: line.quantity, unitCost: cost / line.quantity })
        line.amount = Math.round(cost)
        for (const [account, amount] of inputCost) addEntry(stockAccountOf(item), account, total > 0 ? (cost * amount) / total : 0)
      }
    } else if (doc.type === "sales") {
      for (const line of lines) {
        const item = (await ctx.db.get(line.inventoryItemId!))!
        const movement = await applyStockMovement(ctx, { ...base, externalId: `${doc.externalId}:${line.lineNo}:out`, kind: "document", warehouseId: source!._id, inventoryItemId: item._id, quantityDelta: -line.quantity })
        line.amount = Math.round(movement.amount ?? 0)
        total += movement.amount ?? 0
        addEntry("cogs", stockAccountOf(item), movement.amount ?? 0)
      }
    } else if (doc.type === "internal-order") {
      // A transfer at the source's cost (not doubled); between restaurants through the inter-branch account.
      for (const line of lines) {
        const item = (await ctx.db.get(line.inventoryItemId!))!
        const out = await applyStockMovement(ctx, { ...base, externalId: `${doc.externalId}:${line.lineNo}:out`, kind: "document", warehouseId: source!._id, inventoryItemId: item._id, quantityDelta: -line.quantity })
        await applyStockMovement(ctx, { ...base, externalId: `${doc.externalId}:${line.lineNo}:in`, kind: "document", warehouseId: destination!._id, inventoryItemId: item._id, quantityDelta: line.quantity, unitCost: out.unitCost })
        line.amount = Math.round(out.amount ?? 0)
        total += out.amount ?? 0
        if (source!.restaurantExternalId !== destination!.restaurantExternalId) {
          addEntry("interBranch", stockAccountOf(item), out.amount ?? 0, source!.restaurantExternalId)
          addEntry(stockAccountOf(item), "interBranch", out.amount ?? 0, destination!.restaurantExternalId)
        }
      }
    }

    for (const [index, entry] of [...entries.values()].entries()) {
      const amount = Math.round(entry.amount)
      if (amount <= 0) continue
      await postJournalEntry(ctx, { externalId: `${doc.externalId}:je:${index}`, restaurantExternalId: entry.restaurant, sourceModuleId: config.section, sourceExternalId: doc.externalId, sourceNumber: doc.number, occurredAt: doc.date, debitAccount: entry.debit, creditAccount: entry.credit, amount, description: `${config.label} ${doc.number}`, warehouseExternalId: source?.externalId })
    }
    await ctx.db.patch(doc._id, { status: "posted", lines, totalAmount: Math.round(total), postedAt: Date.now(), version: doc.version + 1, updatedAt: Date.now() })
    await writeOfficeAudit(ctx, email, { action: `${config.section}.post`, summary: `${config.label} ${doc.number} проведён: ${Math.round(total)} ₸`, resourceType: config.section, resourceExternalId: doc.externalId, restaurantExternalId: doc.restaurantExternalId, capability: cap(doc.type, "post") })
    await appendOutboxEvent(ctx, { aggregateType: config.section, aggregateExternalId: doc.externalId, eventType: `${config.section}.posted`, restaurantExternalId: doc.restaurantExternalId, payload: { number: doc.number, totalAmount: Math.round(total) } })
    return { kind: "posted" as const, totalAmount: Math.round(total) }
  },
})

/** Mirrors the posted movements and journal lines; refused when output was used and the warehouse forbids negatives. */
export const reverseDocument = mutation({
  args: { externalId: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const doc = await requireDoc(ctx, args.externalId)
    const config = CONFIG[doc.type]
    const { user } = await requireOfficeCapability(ctx, cap(doc.type, "reverse"))
    await requireRestaurantScope(ctx, user, doc.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    if (doc.status !== "posted") throw new ConvexError("Сторнировать можно только проведённый документ")
    const reason = args.reason.trim()
    if (reason.length < 3) throw new ConvexError("Укажите причину")
    const now = Date.now()
    await assertPeriodOpen(ctx, { organizationExternalId: doc.organizationExternalId, restaurantExternalId: doc.restaurantExternalId, businessDate: businessDateFor(now), moduleId: config.section })
    const destination = doc.destinationWarehouseId ? await ctx.db.get(doc.destinationWarehouseId) : null
    if (destination && !destination.allowNegativeStock) {
      for await (const movement of ctx.db.query("stockMovements").withIndex("by_source", (q) => q.eq("sourceExternalId", doc.externalId))) {
        if (movement.warehouseId !== destination._id || movement.quantityDelta <= 0 || movement.reversalOf) continue
        if ((await onHandAt(ctx, destination._id, movement.inventoryItemId)) - movement.quantityDelta < -0.0005) {
          const item = await ctx.db.get(movement.inventoryItemId)
          throw new ConvexError(`«${item?.name}» уже израсходована — сторно уведёт остаток в минус`)
        }
      }
    }
    await reverseStockSource(ctx, { sourceExternalId: doc.externalId, occurredAt: now, reason, actorEmail: email })
    await ctx.db.patch(doc._id, { status: "reversed", reversedAt: now, reverseReason: reason, version: doc.version + 1, updatedAt: now })
    await writeOfficeAudit(ctx, email, { action: `${config.section}.reverse`, summary: `Сторно ${config.label.toLocaleLowerCase("ru")} ${doc.number}: ${reason}`, resourceType: config.section, resourceExternalId: doc.externalId, restaurantExternalId: doc.restaurantExternalId, capability: cap(doc.type, "reverse") })
  },
})

/** «Создать приходную накладную» from an approved purchase order; a repeat returns the receipt already made. */
export const createReceiptFromPurchaseOrder = mutation({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.receipts.edit")
    const order = await requireDoc(ctx, args.externalId)
    await requireRestaurantScope(ctx, user, order.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    if (order.type !== "purchase-order") throw new ConvexError("Это не заказ поставщику")
    if (order.receiptExternalId) return order.receiptExternalId
    if (order.status !== "approved") throw new ConvexError("Приход создаётся по согласованному заказу")
    const warehouse = (await ctx.db.get(order.destinationWarehouseId!))!
    await requireWarehouseScope(ctx, user, warehouse.externalId, role)
    const restaurant = (await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", order.restaurantExternalId)).unique())!
    const now = Date.now()
    const number = await nextNumber(ctx, { moduleId: "receipts", prefix: "ПН", organizationExternalId: order.organizationExternalId, businessDate: businessDateFor(now, restaurant.businessDayCutoffMinutes) })
    const receiptExternalId = `receipt-${crypto.randomUUID()}`
    const gross = order.lines.reduce((sum, line) => sum + Math.round((line.expectedUnitCost ?? 0) * line.quantity), 0)
    const receiptId = await ctx.db.insert("receipts", { externalId: receiptExternalId, number, date: now, supplierId: order.supplierId!, warehouseId: warehouse._id, restaurantExternalId: order.restaurantExternalId, organizationExternalId: order.organizationExternalId, invoiceNumber: "", purchaseOrderExternalId: order.externalId, status: "draft", totalGross: gross, totalVat: 0, totalNet: gross, searchText: `${number} ${order.number}`.toLocaleLowerCase("ru"), createdAt: now, updatedAt: now })
    for (const line of order.lines) {
      await ctx.db.insert("receiptLines", { receiptId, lineNo: line.lineNo, inventoryItemId: line.inventoryItemId!, quantity: line.quantity, unitCostGross: line.expectedUnitCost ?? 0, vatRate: 0, amountGross: Math.round((line.expectedUnitCost ?? 0) * line.quantity) })
    }
    await ctx.db.patch(order._id, { receiptExternalId, version: order.version + 1, updatedAt: now })
    await writeOfficeAudit(ctx, email, { action: "purchase-orders.receipt", summary: `По заказу ${order.number} создана накладная ${number}`, resourceType: "purchase-orders", resourceExternalId: order.externalId, restaurantExternalId: order.restaurantExternalId, capability: "office.receipts.edit" })
    return receiptExternalId
  },
})

/** Called by receipts: a posted receipt completes its purchase order, a reversed one reopens it. */
export async function syncPurchaseOrder(ctx: MutationCtx, purchaseOrderExternalId: string | undefined, receiptPosted: boolean) {
  if (!purchaseOrderExternalId) return
  const order = await ctx.db.query("productionDocuments").withIndex("by_external_id", (q) => q.eq("externalId", purchaseOrderExternalId)).unique()
  if (!order || order.type !== "purchase-order") return
  await ctx.db.patch(order._id, { status: receiptPosted ? "completed" : "approved", version: order.version + 1, updatedAt: Date.now() })
}

