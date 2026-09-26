import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import { query, type QueryCtx } from "../../_generated/server"
import { kitchenForecast } from "../../lib/forecast"
import { requireOfficeCapability, requireRestaurantScope } from "../../lib/officeAccess"
import { postedProductionOf, semiFinishedRequirement as requirementOf } from "../../lib/semiFinished"
import { roundQuantity } from "../../lib/stockAccounting"
import { MODULE, openRecordOf, recordCap, recordOf, requireRestaurant, restaurantWarehouses, STATUS, type ProductionRecord } from "./shared"

// Kitchen forecast, «План на кухню» and «Ведомость полуфабрикатов» (W3-PRD-07/08). The restaurant is
// required: the forecast is one restaurant's (in bahandi it was optional — hence the empty plan, L-14).

/** «Прогноз кухни» — the panel of both pages; the same numbers the sheet's need is built from. */
export const forecast = query({
  args: { restaurantExternalId: v.string(), targetDate: v.string(), section: v.optional(MODULE) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, recordCap(args.section ?? "kitchen-plan", "view"))
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    await requireRestaurant(ctx, args.restaurantExternalId)
    return kitchenForecast(ctx, { restaurantExternalId: args.restaurantExternalId, targetDate: args.targetDate })
  },
})

/** The need in preparations for a restaurant and date, with the warehouses its production act can use. */
export const semiFinishedRequirement = query({
  args: { restaurantExternalId: v.string(), targetDate: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.semi-finished-sheet.view")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const restaurant = await requireRestaurant(ctx, args.restaurantExternalId)
    const requirement = await requirementOf(ctx, restaurant, args.targetDate)
    const open = await openRecordOf(ctx, "semi-finished-sheet", restaurant.externalId, args.targetDate)
    return { ...requirement, warehouses: await restaurantWarehouses(ctx, restaurant.externalId), sheet: open ? { externalId: open.externalId, number: open.number, status: open.status } : null }
  },
})

/** Lines with the fact: frozen once a sheet is posted, otherwise the posted production acts of the date. */
async function linesWithFact(ctx: QueryCtx, record: ProductionRecord) {
  if (record.moduleId !== "semi-finished-sheet" || record.status === "posted" || record.status === "reversed") return record.lines
  const restaurant = await requireRestaurant(ctx, record.restaurantExternalId)
  const done = await postedProductionOf(ctx, restaurant, record.businessDate)
  return record.lines.map((line) => ({ ...line, actualQuantity: roundQuantity(done.get(line.productExternalId) ?? 0) }))
}

/** Plan and fact of a sheet as one number when every line has one unit; else null (the register shows positions). */
function totalsOf(lines: ProductionRecord["lines"]) {
  const units = new Set(lines.map((line) => line.unit ?? ""))
  const unit = units.size === 1 ? [...units][0] || null : null
  return {
    unit,
    plannedTotal: units.size === 1 ? roundQuantity(lines.reduce((sum, line) => sum + line.plannedQuantity, 0)) : null,
    actualTotal: units.size === 1 ? roundQuantity(lines.reduce((sum, line) => sum + (line.actualQuantity ?? 0), 0)) : null,
    doneCount: lines.filter((line) => line.plannedQuantity > 0 && (line.actualQuantity ?? 0) + 1e-6 >= line.plannedQuantity).length,
    plannedCount: lines.filter((line) => line.plannedQuantity > 0).length,
  }
}

export const listRecords = query({
  args: { moduleId: MODULE, status: v.optional(STATUS), restaurantExternalId: v.optional(v.string()), search: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, recordCap(args.moduleId, "view"))
    if (args.restaurantExternalId) await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const needle = args.search?.trim().toLocaleLowerCase("ru")
    const status = args.status
    const page = needle
      ? await ctx.db.query("productionRecords").withSearchIndex("search_production_records", (q) => {
          let scoped = q.search("searchText", needle).eq("moduleId", args.moduleId)
          if (status) scoped = scoped.eq("status", status)
          if (args.restaurantExternalId) scoped = scoped.eq("restaurantExternalId", args.restaurantExternalId)
          return scoped
        }).paginate(args.paginationOpts)
      : args.restaurantExternalId
        ? await ctx.db.query("productionRecords").withIndex("by_module_restaurant_date", (q) => q.eq("moduleId", args.moduleId).eq("restaurantExternalId", args.restaurantExternalId!)).order("desc").filter((q) => (status ? q.eq(q.field("status"), status) : true)).paginate(args.paginationOpts)
        : status
          ? await ctx.db.query("productionRecords").withIndex("by_module_status_date", (q) => q.eq("moduleId", args.moduleId).eq("status", status)).order("desc").paginate(args.paginationOpts)
          : await ctx.db.query("productionRecords").withIndex("by_module_date", (q) => q.eq("moduleId", args.moduleId)).order("desc").paginate(args.paginationOpts)
    const network = user.restaurantScopes.includes("*")
    const names = new Map<string, string>()
    const rows = []
    for (const record of page.page) {
      if (!network && !user.restaurantScopes.includes(record.restaurantExternalId)) continue
      if (!names.has(record.restaurantExternalId)) names.set(record.restaurantExternalId, (await requireRestaurant(ctx, record.restaurantExternalId)).name)
      const lines = await linesWithFact(ctx, record)
      rows.push({ ...record, lines, restaurantName: names.get(record.restaurantExternalId)!, ...totalsOf(lines) })
    }
    return { ...page, page: rows }
  },
})

export const getRecord = query({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const record = await recordOf(ctx, args.externalId)
    if (!record) return null
    const { user } = await requireOfficeCapability(ctx, recordCap(record.moduleId, "view"))
    await requireRestaurantScope(ctx, user, record.restaurantExternalId)
    const restaurant = await requireRestaurant(ctx, record.restaurantExternalId)
    const lines = await linesWithFact(ctx, record)
    const acts = []
    for (const externalId of record.productionActExternalIds ?? []) {
      const act = await ctx.db.query("productionDocuments").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
      if (act) acts.push({ externalId: act.externalId, number: act.number, status: act.status, date: act.date, positions: act.lines.length })
    }
    // Only the sheet's own lines can be made; the rest of the need came from the forecast.
    const producible = new Set<string>()
    if (record.moduleId === "semi-finished-sheet") {
      for (const line of lines) {
        const product = await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", line.productExternalId)).unique()
        if (product?.writeOffMethod !== "finished-product") continue
        const item = await ctx.db.query("inventoryItems").withIndex("by_product", (q) => q.eq("productExternalId", product.externalId)).first()
        if (item) producible.add(line.productExternalId)
      }
    }
    return {
      ...record,
      lines: lines.map((line) => ({ ...line, canProduce: producible.has(line.productExternalId) })),
      restaurantName: restaurant.name,
      acts,
      warehouses: record.moduleId === "semi-finished-sheet" ? await restaurantWarehouses(ctx, restaurant.externalId) : [],
      ...totalsOf(lines),
    }
  },
})
