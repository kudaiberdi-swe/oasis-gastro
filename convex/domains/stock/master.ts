import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { mutation, query, type MutationCtx, type QueryCtx } from "../../_generated/server"
import type { Doc, Id } from "../../_generated/dataModel"
import { effectiveScopes, getOfficeAuthEmail, hasScope, requireOfficeCapability, requireRestaurantScope, restaurantScopeFilter, writeOfficeAudit } from "../../lib/officeAccess"

// Stock reference data (W1-STK-03…07): units, warehouses, suppliers, inventory items, balances.

const dimension = v.union(v.literal("mass"), v.literal("volume"), v.literal("count"), v.literal("portion"))
const LEGACY_UNITS = new Set(["кг", "л", "шт", "порц."])

const search = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" ").toLocaleLowerCase("ru")

async function unitByExternalId(ctx: QueryCtx, externalId: string) {
  return ctx.db.query("units").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
}

async function warehouseByExternalId(ctx: QueryCtx, externalId: string) {
  return ctx.db.query("warehouses").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
}

// ── Units (W1-STK-03) ────────────────────────────────────────────────────────────────────────

export const listUnits = query({
  args: { search: v.optional(v.string()), activeOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.units.view")
    const units = args.activeOnly
      ? await ctx.db.query("units").withIndex("by_active_name", (q) => q.eq("active", true)).take(200)
      : await ctx.db.query("units").withIndex("by_active_name").take(200)
    const needle = args.search?.trim().toLocaleLowerCase("ru")
    return units.filter((unit) => !needle || unit.searchText.includes(needle))
  },
})

export const saveUnit = mutation({
  args: { externalId: v.optional(v.string()), name: v.string(), shortName: v.string(), dimension, precision: v.number(), baseUnitExternalId: v.optional(v.string()), coefficient: v.number(), active: v.boolean() },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.units.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const name = args.name.trim()
    const shortName = args.shortName.trim()
    if (!name || !shortName) throw new ConvexError("Укажите название и сокращение")
    if (!(args.coefficient > 0)) throw new ConvexError("Коэффициент должен быть больше нуля")
    if (!Number.isInteger(args.precision) || args.precision < 0 || args.precision > 6) throw new ConvexError("Точность — от 0 до 6 знаков")
    const existing = args.externalId ? await unitByExternalId(ctx, args.externalId) : null
    if (args.externalId && !existing) throw new ConvexError("Единица не найдена")
    if (args.baseUnitExternalId) {
      if (args.baseUnitExternalId === existing?.externalId) throw new ConvexError("Единица не может быть базовой сама для себя")
      let base = await unitByExternalId(ctx, args.baseUnitExternalId)
      if (!base) throw new ConvexError("Базовая единица не найдена")
      if (base.dimension !== args.dimension) throw new ConvexError("Базовая единица должна быть той же размерности")
      for (let depth = 0; base?.baseUnitExternalId && depth < 10; depth += 1) {
        if (base.baseUnitExternalId === existing?.externalId) throw new ConvexError("Цикл базовых единиц")
        base = await unitByExternalId(ctx, base.baseUnitExternalId)
      }
    }
    if (existing && (existing.dimension !== args.dimension || existing.coefficient !== args.coefficient)) {
      const used = await ctx.db.query("inventoryItems").withIndex("by_unit", (q) => q.eq("unitExternalId", existing.externalId)).first()
      if (used) throw new ConvexError("Единица уже используется: размерность и коэффициент менять нельзя")
    }
    const value = { name, shortName, dimension: args.dimension, precision: args.precision, baseUnitExternalId: args.baseUnitExternalId || undefined, coefficient: args.coefficient, active: args.active, searchText: search(name, shortName) }
    let externalId = existing?.externalId
    if (existing) await ctx.db.patch(existing._id, value)
    else {
      externalId = `unit-${crypto.randomUUID()}`
      await ctx.db.insert("units", { externalId, ...value })
    }
    await writeOfficeAudit(ctx, email, { action: existing ? "unit.update" : "unit.create", summary: `Единица «${name}» (${shortName})`, resourceType: "unit", resourceExternalId: externalId!, capability: "office.units.edit" })
    return externalId!
  },
})

// ── Warehouses (W1-STK-04) ───────────────────────────────────────────────────────────────────

async function visibleWarehouse(ctx: QueryCtx, user: Doc<"officeUsers">, role: Doc<"officeRoles">, warehouse: Doc<"warehouses">) {
  const scopes = await effectiveScopes(ctx, user, role)
  return hasScope(user.restaurantScopes, warehouse.restaurantExternalId) && (hasScope(scopes.warehouseScopes, warehouse.externalId) || scopes.warehouseScopes.length === 0)
}

export const listWarehouses = query({
  args: { restaurantExternalId: v.optional(v.string()), activeOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.warehouses.view")
    const inScope = restaurantScopeFilter(user, args.restaurantExternalId)
    const rows = args.restaurantExternalId
      ? await ctx.db.query("warehouses").withIndex("by_restaurant_active", (q) => (args.activeOnly ? q.eq("restaurantExternalId", args.restaurantExternalId!).eq("active", true) : q.eq("restaurantExternalId", args.restaurantExternalId!))).take(100)
      : await ctx.db.query("warehouses").withIndex("by_restaurant_active").take(200)
    const visible = []
    for (const warehouse of rows) {
      if (args.activeOnly && !warehouse.active) continue
      if (inScope(warehouse.restaurantExternalId) && (await visibleWarehouse(ctx, user, role, warehouse))) visible.push(warehouse)
    }
    return visible
  },
})

/** Light list for pickers. */
export const listWarehouseOptions = query({
  args: {},
  handler: async (ctx) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.stock.view")
    const inScope = restaurantScopeFilter(user)
    const rows = await ctx.db.query("warehouses").withIndex("by_restaurant_active").take(200)
    const options = []
    for (const warehouse of rows) {
      if (warehouse.active && inScope(warehouse.restaurantExternalId) && (await visibleWarehouse(ctx, user, role, warehouse))) {
        options.push({ externalId: warehouse.externalId, name: warehouse.name, restaurantExternalId: warehouse.restaurantExternalId, kind: warehouse.kind, isSalesDefault: warehouse.isSalesDefault })
      }
    }
    return options
  },
})

const warehouseKind = v.union(v.literal("storage"), v.literal("kitchen"), v.literal("bar"), v.literal("distribution"))

export const saveWarehouse = mutation({
  args: {
    externalId: v.optional(v.string()),
    name: v.string(),
    shortName: v.string(),
    restaurantExternalId: v.string(),
    kind: warehouseKind,
    responsibleName: v.optional(v.string()),
    allowNegativeStock: v.boolean(),
    internalTransfers: v.boolean(),
    isSalesDefault: v.boolean(),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.warehouses.edit")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    const name = args.name.trim()
    if (!name) throw new ConvexError("Укажите название склада")
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.restaurantExternalId)).unique()
    if (!restaurant) throw new ConvexError("Ресторан не найден")
    const existing = args.externalId ? await warehouseByExternalId(ctx, args.externalId) : null
    if (args.externalId && !existing) throw new ConvexError("Склад не найден")
    if (existing && existing.restaurantExternalId !== args.restaurantExternalId) throw new ConvexError("Ресторан склада менять нельзя")
    if (existing?.active && !args.active) {
      const stocked = (await ctx.db.query("stockBalances").withIndex("by_warehouse_item", (q) => q.eq("warehouseId", existing._id)).take(200)).some((balance) => Math.abs(balance.quantity) > 0.0005)
      if (stocked) throw new ConvexError("На складе есть остатки — отключить нельзя")
      const draft = await ctx.db.query("stockDocuments").withIndex("by_source_warehouse_status", (q) => q.eq("sourceWarehouseId", existing._id).eq("status", "draft")).first()
      if (draft) throw new ConvexError("По складу есть черновики документов — отключить нельзя")
    }
    const value = {
      name,
      shortName: args.shortName.trim() || name,
      restaurantExternalId: args.restaurantExternalId,
      organizationExternalId: restaurant.organizationExternalId,
      kind: args.kind,
      responsibleName: args.responsibleName?.trim() || undefined,
      allowNegativeStock: args.allowNegativeStock,
      internalTransfers: args.internalTransfers,
      isSalesDefault: args.isSalesDefault && args.active,
      active: args.active,
      searchText: search(name, args.shortName, args.responsibleName),
    }
    let id: Id<"warehouses">
    let externalId: string
    if (existing) {
      await ctx.db.patch(existing._id, value)
      id = existing._id
      externalId = existing.externalId
    } else {
      externalId = `warehouse-${crypto.randomUUID()}`
      id = await ctx.db.insert("warehouses", { externalId, ...value })
    }
    // Exactly one sales warehouse per restaurant.
    if (value.isSalesDefault) {
      for (const other of await ctx.db.query("warehouses").withIndex("by_restaurant_active", (q) => q.eq("restaurantExternalId", args.restaurantExternalId)).take(100)) {
        if (other._id !== id && other.isSalesDefault) await ctx.db.patch(other._id, { isSalesDefault: false })
      }
    }
    await writeOfficeAudit(ctx, email, { action: existing ? "warehouse.update" : "warehouse.create", summary: `Склад «${name}»`, resourceType: "warehouse", resourceExternalId: externalId, restaurantExternalId: args.restaurantExternalId, capability: "office.warehouses.edit" })
    return externalId
  },
})

// ── Suppliers (W1-STK-05) ────────────────────────────────────────────────────────────────────

function supplierVisible(supplier: Doc<"suppliers">, restaurantScopes: string[]) {
  return restaurantScopes.includes("*") || supplier.restaurantExternalIds.length === 0 || supplier.restaurantExternalIds.some((restaurant) => restaurantScopes.includes(restaurant))
}

export const listSuppliers = query({
  args: { search: v.optional(v.string()), activeOnly: v.optional(v.boolean()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.suppliers.view")
    const needle = args.search?.trim().toLocaleLowerCase("ru")
    const page = needle
      ? await ctx.db.query("suppliers").withSearchIndex("search_suppliers", (q) => (args.activeOnly ? q.search("searchText", needle).eq("active", true) : q.search("searchText", needle))).paginate(args.paginationOpts)
      : args.activeOnly
        ? await ctx.db.query("suppliers").withIndex("by_active_name", (q) => q.eq("active", true)).paginate(args.paginationOpts)
        : await ctx.db.query("suppliers").withIndex("by_active_name").paginate(args.paginationOpts)
    return { ...page, page: page.page.filter((supplier) => supplierVisible(supplier, user.restaurantScopes)) }
  },
})

export const getSupplier = query({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.suppliers.view")
    const supplier = await ctx.db.query("suppliers").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    return supplier && supplierVisible(supplier, user.restaurantScopes) ? supplier : null
  },
})

const deviationPolicy = v.union(v.literal("ignore"), v.literal("warn"), v.literal("block"), v.literal("block-higher"))

export const saveSupplier = mutation({
  args: {
    externalId: v.optional(v.string()),
    name: v.string(),
    bin: v.string(),
    supplierType: v.union(v.literal("external"), v.literal("internal")),
    vatPayer: v.boolean(),
    contactName: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    legalAddress: v.optional(v.string()),
    bankAccount: v.optional(v.string()),
    paymentDelayDays: v.optional(v.number()),
    minimumOrder: v.optional(v.number()),
    priceDeviationPolicy: deviationPolicy,
    allowedDeviationPercent: v.number(),
    restaurantExternalIds: v.array(v.string()),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.suppliers.edit")
    for (const restaurant of args.restaurantExternalIds) await requireRestaurantScope(ctx, user, restaurant)
    const email = (await getOfficeAuthEmail(ctx))!
    const name = args.name.trim()
    if (!name) throw new ConvexError("Укажите название поставщика")
    if (!/^\d{12}$/.test(args.bin)) throw new ConvexError("БИН — 12 цифр")
    if (args.email && !/^\S+@\S+\.\S+$/.test(args.email.trim())) throw new ConvexError("Некорректный email")
    if (args.phone && !/^\+?[\d\s()-]{10,18}$/.test(args.phone.trim())) throw new ConvexError("Некорректный телефон")
    if (args.allowedDeviationPercent < 0 || args.allowedDeviationPercent > 100) throw new ConvexError("Допустимое отклонение — от 0 до 100 %")
    const existing = args.externalId ? await ctx.db.query("suppliers").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId!)).unique() : null
    if (args.externalId && !existing) throw new ConvexError("Поставщик не найден")
    const sameBin = await ctx.db.query("suppliers").withIndex("by_bin", (q) => q.eq("bin", args.bin)).first()
    if (sameBin && sameBin._id !== existing?._id) throw new ConvexError("Поставщик с таким БИН уже есть")
    if (existing?.active && !args.active) {
      const draftReceipt = await ctx.db.query("receipts").withIndex("by_supplier_status", (q) => q.eq("supplierId", existing._id).eq("status", "draft")).first()
      if (draftReceipt) throw new ConvexError("У поставщика есть черновики приходов — отключить нельзя")
    }
    const value = {
      name,
      bin: args.bin,
      supplierType: args.supplierType,
      vatPayer: args.vatPayer,
      contactName: args.contactName?.trim() || undefined,
      phone: args.phone?.trim() || undefined,
      email: args.email?.trim().toLocaleLowerCase("en-US") || undefined,
      legalAddress: args.legalAddress?.trim() || undefined,
      bankAccount: args.bankAccount?.trim() || undefined,
      paymentDelayDays: args.paymentDelayDays,
      minimumOrder: args.minimumOrder,
      priceDeviationPolicy: args.priceDeviationPolicy,
      allowedDeviationPercent: args.allowedDeviationPercent,
      restaurantExternalIds: [...new Set(args.restaurantExternalIds)],
      active: args.active,
      searchText: search(name, args.bin, args.contactName),
    }
    let externalId = existing?.externalId
    if (existing) await ctx.db.patch(existing._id, value)
    else {
      externalId = `supplier-${crypto.randomUUID()}`
      await ctx.db.insert("suppliers", { externalId, ...value })
    }
    await writeOfficeAudit(ctx, email, { action: existing ? "supplier.update" : "supplier.create", summary: `Поставщик «${name}», БИН ${args.bin}`, resourceType: "supplier", resourceExternalId: externalId!, capability: "office.suppliers.edit" })
    return externalId!
  },
})

// ── Inventory items (W1-STK-06) ──────────────────────────────────────────────────────────────

const itemKind = v.union(v.literal("ingredient"), v.literal("preparation"), v.literal("good"), v.literal("service"), v.literal("modifier"))

export const listInventoryItems = query({
  args: { search: v.optional(v.string()), kind: v.optional(itemKind), activeOnly: v.optional(v.boolean()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.stock.view")
    const needle = args.search?.trim().toLocaleLowerCase("ru")
    const base = needle
      ? ctx.db.query("inventoryItems").withSearchIndex("search_inventory_items", (q) => (args.activeOnly ? q.search("searchText", needle).eq("active", true) : q.search("searchText", needle)))
      : args.activeOnly
        ? ctx.db.query("inventoryItems").withIndex("by_active_and_name", (q) => q.eq("active", true))
        : ctx.db.query("inventoryItems").withIndex("by_active_and_name")
    return base.filter((q) => (args.kind ? q.eq(q.field("kind"), args.kind) : true)).paginate(args.paginationOpts)
  },
})

export const saveInventoryItem = mutation({
  args: {
    externalId: v.optional(v.string()),
    name: v.string(),
    kind: itemKind,
    unitExternalId: v.string(),
    minimumStock: v.optional(v.number()),
    maximumStock: v.optional(v.number()),
    shelfLifeHours: v.optional(v.number()),
    defaultVatRate: v.optional(v.number()),
    productExternalId: v.optional(v.string()),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.nomenclature.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const name = args.name.trim()
    if (!name) throw new ConvexError("Укажите название позиции")
    const unit = await unitByExternalId(ctx, args.unitExternalId)
    if (!unit || !unit.active) throw new ConvexError("Единица не найдена или отключена")
    if (args.minimumStock !== undefined && args.maximumStock !== undefined && args.minimumStock > args.maximumStock) throw new ConvexError("Минимум не может быть больше максимума")
    const existing = args.externalId ? await ctx.db.query("inventoryItems").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId!)).unique() : null
    if (args.externalId && !existing) throw new ConvexError("Позиция не найдена")
    if (existing && existing.unitExternalId && existing.unitExternalId !== args.unitExternalId) {
      const previous = await unitByExternalId(ctx, existing.unitExternalId)
      const moved = await ctx.db.query("stockMovements").withIndex("by_item_occurred", (q) => q.eq("inventoryItemId", existing._id)).first()
      if (moved && previous && previous.dimension !== unit.dimension) throw new ConvexError("По позиции есть движения: единицу другой размерности выбрать нельзя")
    }
    if (existing?.active && !args.active) {
      const stocked = (await ctx.db.query("stockBalances").withIndex("by_item", (q) => q.eq("inventoryItemId", existing._id)).take(100)).some((balance) => Math.abs(balance.quantity) > 0.0005)
      if (stocked) throw new ConvexError("По позиции есть остаток — отключить нельзя")
    }
    const legacyUnit = LEGACY_UNITS.has(unit.shortName) ? (unit.shortName as Doc<"inventoryItems">["unit"]) : (existing?.unit ?? "шт")
    const value = {
      name,
      nameSort: name.toLocaleLowerCase("ru"),
      searchText: search(name),
      unit: legacyUnit,
      unitExternalId: unit.externalId,
      kind: args.kind,
      minimumStock: args.minimumStock,
      maximumStock: args.maximumStock,
      shelfLifeHours: args.shelfLifeHours,
      defaultVatRate: args.defaultVatRate,
      productExternalId: args.productExternalId || undefined,
      active: args.active,
    }
    let externalId = existing?.externalId
    if (existing) await ctx.db.patch(existing._id, value)
    else {
      externalId = `item-${crypto.randomUUID()}`
      await ctx.db.insert("inventoryItems", { externalId, ...value })
    }
    await writeOfficeAudit(ctx, email, { action: existing ? "inventory-item.update" : "inventory-item.create", summary: `Складская позиция «${name}»`, resourceType: "inventory-item", resourceExternalId: externalId!, capability: "office.nomenclature.edit" })
    return externalId!
  },
})

// ── Balances at a date (W1-STK-07) ───────────────────────────────────────────────────────────

async function balanceAt(ctx: QueryCtx, balance: Doc<"stockBalances">, at: number | undefined) {
  if (at === undefined || !balance.warehouseId) return { quantity: balance.quantity, averageUnitCost: balance.averageUnitCost }
  const last = await ctx.db
    .query("stockMovements")
    .withIndex("by_warehouse_item_occurred", (q) => q.eq("warehouseId", balance.warehouseId!).eq("inventoryItemId", balance.inventoryItemId).lte("occurredAt", at))
    .order("desc")
    .first()
  return { quantity: last?.balanceAfter ?? 0, averageUnitCost: last?.averageUnitCostAfter ?? 0 }
}

export const listBalances = query({
  args: {
    warehouseExternalId: v.optional(v.string()),
    at: v.optional(v.number()),
    filter: v.optional(v.union(v.literal("all"), v.literal("belowMinimum"), v.literal("aboveMaximum"), v.literal("negative"))),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.stock.view")
    if (args.at !== undefined && (!Number.isFinite(args.at) || args.at > Date.now() + 60_000)) throw new ConvexError("Некорректная дата")
    let warehouse: Doc<"warehouses"> | null = null
    if (args.warehouseExternalId) {
      warehouse = await warehouseByExternalId(ctx, args.warehouseExternalId)
      if (!warehouse || !(await visibleWarehouse(ctx, user, role, warehouse))) throw new ConvexError("Нет доступа к складу")
    }
    const inScope = restaurantScopeFilter(user)
    const page = warehouse
      ? await ctx.db.query("stockBalances").withIndex("by_warehouse_item", (q) => q.eq("warehouseId", warehouse!._id)).paginate(args.paginationOpts)
      : await ctx.db.query("stockBalances").withIndex("by_warehouse_item").paginate(args.paginationOpts)
    const warehouses = new Map<Id<"warehouses">, Doc<"warehouses"> | null>()
    const rows = []
    for (const balance of page.page) {
      if (!balance.warehouseId || !inScope(balance.restaurantExternalId)) continue
      if (!warehouses.has(balance.warehouseId)) warehouses.set(balance.warehouseId, await ctx.db.get(balance.warehouseId))
      const owner = warehouses.get(balance.warehouseId)
      if (!owner || !(await visibleWarehouse(ctx, user, role, owner))) continue
      const item = await ctx.db.get(balance.inventoryItemId)
      if (!item) continue
      const state = await balanceAt(ctx, balance, args.at)
      const flags = {
        belowMinimum: item.minimumStock !== undefined && state.quantity < item.minimumStock,
        aboveMaximum: item.maximumStock !== undefined && state.quantity > item.maximumStock,
        negative: state.quantity < 0,
      }
      if (args.filter && args.filter !== "all" && !flags[args.filter]) continue
      rows.push({
        warehouse: { externalId: owner.externalId, name: owner.name },
        item: { externalId: item.externalId, name: item.name, unit: item.unit },
        quantity: state.quantity,
        averageUnitCost: state.averageUnitCost,
        amount: Math.round(state.quantity * state.averageUnitCost),
        ...flags,
      })
    }
    return { ...page, page: rows }
  },
})
