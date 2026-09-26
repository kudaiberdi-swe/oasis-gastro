import { ConvexError, v } from "convex/values"

import { mutation, type MutationCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { assertBusinessDate, kitchenForecast } from "../../lib/forecast"
import { nextNumber } from "../../lib/numbering"
import { getOfficeAuthEmail, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"
import { appendOutboxEvent } from "../../lib/outbox"
import { assertPeriodOpen } from "../../lib/periods"
import { postedProductionOf, semiFinishedRequirement } from "../../lib/semiFinished"
import { roundQuantity } from "../../lib/stockAccounting"
import { almatyDayStart, businessDateFor } from "../../lib/time"
import { saveProductionDocument } from "../production/documents"
import { ACTION, MODULES, openRecordOf, recordCap, recordOf, requireRestaurant, searchTextOf, type ProductionRecord, type RecordModule } from "./shared"

// «План на кухню» and «Ведомость полуфабрикатов» (W3-PRD-07/08). Lines always come from the server's
// forecast (lib/forecast.ts) — the client only corrects the planned quantities of a draft.

type Lines = ProductionRecord["lines"]

/** Plan lines: the forecast dishes, «Рекомендуется: N» as the planned portions. */
async function planLines(ctx: MutationCtx, restaurantExternalId: string, targetDate: string): Promise<Lines> {
  const forecast = await kitchenForecast(ctx, { restaurantExternalId, targetDate })
  return forecast.products.filter((row) => row.recommendedQuantity > 0).map((row, index) => ({ lineNo: index + 1, productExternalId: row.productExternalId, name: row.name, unit: "порц.", forecastQuantity: row.recommendedQuantity, plannedQuantity: row.recommendedQuantity }))
}

/** Sheet lines: the preparations the forecast needs, plan = need − stock. */
async function sheetLines(ctx: MutationCtx, restaurant: Doc<"restaurants">, targetDate: string): Promise<Lines> {
  const { lines } = await semiFinishedRequirement(ctx, restaurant, targetDate)
  return lines.map((line, index) => ({ lineNo: index + 1, productExternalId: line.productExternalId, name: line.name, unit: line.unit ?? undefined, forecastQuantity: line.forecastQuantity, onHand: line.onHand, plannedQuantity: line.plannedQuantity }))
}

const linesOf = (ctx: MutationCtx, moduleId: RecordModule, restaurant: Doc<"restaurants">, targetDate: string) => (moduleId === "kitchen-plan" ? planLines(ctx, restaurant.externalId, targetDate) : sheetLines(ctx, restaurant, targetDate))

const EMPTY: Record<RecordModule, string> = {
  "kitchen-plan": "Нет продаж в этот день недели за шесть недель — прогноз пуст",
  "semi-finished-sheet": "Блюдам из прогноза не нужны заготовки — проверьте техкарты",
}

/**
 * «Создать по прогнозу»: the plan (or the sheet) of the restaurant and date from the forecast in one step.
 * One live record per day — a repeat returns the one already made.
 */
export const createFromForecast = mutation({
  args: { moduleId: v.union(v.literal("kitchen-plan"), v.literal("semi-finished-sheet")), restaurantExternalId: v.string(), targetDate: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, recordCap(args.moduleId, "edit"))
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    assertBusinessDate(args.targetDate)
    const restaurant = await requireRestaurant(ctx, args.restaurantExternalId)
    const existing = await openRecordOf(ctx, args.moduleId, restaurant.externalId, args.targetDate)
    if (existing) return { externalId: existing.externalId, existing: true }
    await assertPeriodOpen(ctx, { organizationExternalId: restaurant.organizationExternalId, restaurantExternalId: restaurant.externalId, businessDate: args.targetDate, moduleId: args.moduleId })
    const lines = await linesOf(ctx, args.moduleId, restaurant, args.targetDate)
    if (!lines.length) throw new ConvexError(EMPTY[args.moduleId])
    const module = MODULES[args.moduleId]
    const number = await nextNumber(ctx, { moduleId: args.moduleId, prefix: module.prefix, organizationExternalId: restaurant.organizationExternalId, businessDate: args.targetDate })
    const externalId = `${args.moduleId}-${crypto.randomUUID()}`
    const now = Date.now()
    const record = { number, businessDate: args.targetDate, comment: "", lines }
    await ctx.db.insert("productionRecords", { ...record, externalId, moduleId: args.moduleId, status: "draft", organizationExternalId: restaurant.organizationExternalId, restaurantExternalId: restaurant.externalId, searchText: searchTextOf(record), version: 1, createdBy: email, createdAt: now, updatedAt: now })
    await writeOfficeAudit(ctx, email, { action: `${args.moduleId}.create`, summary: `${module.label} ${number} на ${args.targetDate}: ${lines.length} позиций по прогнозу`, resourceType: args.moduleId, resourceExternalId: externalId, restaurantExternalId: restaurant.externalId, capability: recordCap(args.moduleId, "edit") })
    return { externalId, existing: false }
  },
})

async function requireDraft(ctx: MutationCtx, externalId: string, expectedVersion: number) {
  const record = await recordOf(ctx, externalId)
  if (!record) throw new ConvexError("Запись не найдена")
  if (record.status !== "draft") throw new ConvexError("Изменить можно только черновик")
  if (record.version !== expectedVersion) throw new ConvexError("Запись изменена другим пользователем — обновите страницу")
  return record
}

/** Corrects a draft: the planned quantities and the comment; a line left out is removed. */
export const saveRecord = mutation({
  args: { externalId: v.string(), expectedVersion: v.number(), comment: v.string(), lines: v.array(v.object({ productExternalId: v.string(), plannedQuantity: v.number() })) },
  handler: async (ctx, args) => {
    const current = await recordOf(ctx, args.externalId)
    if (!current) throw new ConvexError("Запись не найдена")
    const { user } = await requireOfficeCapability(ctx, recordCap(current.moduleId, "edit"))
    await requireRestaurantScope(ctx, user, current.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    const record = await requireDraft(ctx, args.externalId, args.expectedVersion)
    await assertPeriodOpen(ctx, { organizationExternalId: record.organizationExternalId, restaurantExternalId: record.restaurantExternalId, businessDate: record.businessDate, moduleId: record.moduleId })
    const planned = new Map<string, number>()
    for (const line of args.lines) {
      if (!Number.isFinite(line.plannedQuantity) || line.plannedQuantity < 0) throw new ConvexError("План не может быть отрицательным")
      if (!record.lines.some((existing) => existing.productExternalId === line.productExternalId)) throw new ConvexError("Позиции нет в записи — пересчитайте по прогнозу")
      planned.set(line.productExternalId, roundQuantity(line.plannedQuantity))
    }
    if (!planned.size) throw new ConvexError("Оставьте хотя бы одну позицию")
    const lines = record.lines.filter((line) => planned.has(line.productExternalId)).map((line, index) => ({ ...line, lineNo: index + 1, plannedQuantity: planned.get(line.productExternalId)! }))
    const comment = args.comment.trim()
    await ctx.db.patch(record._id, { lines, comment, searchText: searchTextOf({ ...record, lines, comment }), version: record.version + 1, updatedAt: Date.now() })
    await writeOfficeAudit(ctx, email, { action: `${record.moduleId}.update`, summary: `${MODULES[record.moduleId].label} ${record.number}: изменён план`, resourceType: record.moduleId, resourceExternalId: record.externalId, restaurantExternalId: record.restaurantExternalId, capability: recordCap(record.moduleId, "edit") })
  },
})

/** «Пересчитать по прогнозу»: a draft's lines again from today's forecast (sales and stock may have moved). */
export const refreshRecord = mutation({
  args: { externalId: v.string(), expectedVersion: v.number() },
  handler: async (ctx, args) => {
    const current = await recordOf(ctx, args.externalId)
    if (!current) throw new ConvexError("Запись не найдена")
    const { user } = await requireOfficeCapability(ctx, recordCap(current.moduleId, "edit"))
    await requireRestaurantScope(ctx, user, current.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    const record = await requireDraft(ctx, args.externalId, args.expectedVersion)
    await assertPeriodOpen(ctx, { organizationExternalId: record.organizationExternalId, restaurantExternalId: record.restaurantExternalId, businessDate: record.businessDate, moduleId: record.moduleId })
    const restaurant = await requireRestaurant(ctx, record.restaurantExternalId)
    const lines = await linesOf(ctx, record.moduleId, restaurant, record.businessDate)
    if (!lines.length) throw new ConvexError(EMPTY[record.moduleId])
    await ctx.db.patch(record._id, { lines, searchText: searchTextOf({ ...record, lines }), version: record.version + 1, updatedAt: Date.now() })
    await writeOfficeAudit(ctx, email, { action: `${record.moduleId}.refresh`, summary: `${MODULES[record.moduleId].label} ${record.number}: пересчитан по прогнозу`, resourceType: record.moduleId, resourceExternalId: record.externalId, restaurantExternalId: record.restaurantExternalId, capability: recordCap(record.moduleId, "edit") })
  },
})

/** Plan: approve / cancel (office.kitchen-plan.edit). Sheet: post (freezes the fact), reverse, cancel. */
export const transitionRecord = mutation({
  args: { externalId: v.string(), action: ACTION, expectedVersion: v.number(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const record = await recordOf(ctx, args.externalId)
    if (!record) throw new ConvexError("Запись не найдена")
    const module = MODULES[record.moduleId]
    const transition = module.transitions[args.action]
    if (!transition) throw new ConvexError("Действие недоступно для этого раздела")
    const { user } = await requireOfficeCapability(ctx, recordCap(record.moduleId, transition.capability))
    await requireRestaurantScope(ctx, user, record.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    if (record.version !== args.expectedVersion) throw new ConvexError("Запись изменена другим пользователем — обновите страницу")
    if (!transition.from.includes(record.status)) throw new ConvexError("Действие недоступно для текущего статуса")
    const reason = args.reason?.trim() ?? ""
    if ((args.action === "reverse" || args.action === "cancel") && reason.length < 3) throw new ConvexError("Укажите причину")
    await assertPeriodOpen(ctx, { organizationExternalId: record.organizationExternalId, restaurantExternalId: record.restaurantExternalId, businessDate: record.businessDate, moduleId: record.moduleId })
    const now = Date.now()
    let lines = record.lines
    if (args.action === "post") {
      const done = await postedProductionOf(ctx, await requireRestaurant(ctx, record.restaurantExternalId), record.businessDate)
      lines = record.lines.map((line) => ({ ...line, actualQuantity: roundQuantity(done.get(line.productExternalId) ?? 0) }))
    }
    await ctx.db.patch(record._id, {
      status: transition.to,
      lines,
      version: record.version + 1,
      updatedAt: now,
      ...(transition.to === "posted" ? { postedAt: now } : {}),
      ...(transition.to === "reversed" ? { reversedAt: now } : {}),
      ...(reason ? { reason } : {}),
    })
    await writeOfficeAudit(ctx, email, { action: `${record.moduleId}.${args.action}`, summary: `${module.label} ${record.number}: ${transition.to}${reason ? ` — ${reason}` : ""}`, resourceType: record.moduleId, resourceExternalId: record.externalId, restaurantExternalId: record.restaurantExternalId, capability: recordCap(record.moduleId, transition.capability) })
    if (args.action === "post" || args.action === "reverse") {
      await appendOutboxEvent(ctx, { aggregateType: record.moduleId, aggregateExternalId: record.externalId, eventType: `${record.moduleId}.${args.action === "post" ? "posted" : "reversed"}`, restaurantExternalId: record.restaurantExternalId, payload: { number: record.number, businessDate: record.businessDate } })
    }
  },
})

/**
 * «Создать акт приготовления»: one production act draft (convex/domains/production) with what is left to
 * make — plan − fact of each line a production act can make. The act is posted from its own page.
 */
export const createProductionAct = mutation({
  args: { externalId: v.string(), sourceWarehouseExternalId: v.string(), destinationWarehouseExternalId: v.string(), productExternalIds: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    const record = await recordOf(ctx, args.externalId)
    if (!record || record.moduleId !== "semi-finished-sheet") throw new ConvexError("Ведомость не найдена")
    const { user } = await requireOfficeCapability(ctx, "office.semi-finished-sheet.edit")
    const production = await requireOfficeCapability(ctx, "office.production.edit")
    await requireRestaurantScope(ctx, user, record.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    if (record.status !== "draft" && record.status !== "posted") throw new ConvexError("Акт создаётся по черновику или проведённой ведомости")
    const restaurant = await requireRestaurant(ctx, record.restaurantExternalId)
    const done = await postedProductionOf(ctx, restaurant, record.businessDate)
    const wanted = args.productExternalIds ? new Set(args.productExternalIds) : null
    const lines: { productExternalId: string; quantity: number }[] = []
    const skipped: string[] = []
    for (const line of record.lines) {
      if (wanted && !wanted.has(line.productExternalId)) continue
      const left = roundQuantity(line.plannedQuantity - (done.get(line.productExternalId) ?? 0))
      if (left <= 0) continue
      const product = await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", line.productExternalId)).unique()
      const item = product ? await ctx.db.query("inventoryItems").withIndex("by_product", (q) => q.eq("productExternalId", product.externalId)).first() : null
      if (product?.itemType !== "preparation" || product.writeOffMethod !== "finished-product" || !item) {
        skipped.push(line.name)
        continue
      }
      lines.push({ productExternalId: line.productExternalId, quantity: left })
    }
    if (!lines.length) throw new ConvexError(skipped.length ? `Эти заготовки не выпускаются актом: ${skipped.join(", ")}` : "Всё по плану уже выпущено")
    // The act's moment: now on the sheet's own day, else the start of that business day.
    const now = Date.now()
    const dayStart = almatyDayStart(record.businessDate) + (restaurant.businessDayCutoffMinutes ?? 0) * 60_000
    const date = businessDateFor(now, restaurant.businessDayCutoffMinutes) === record.businessDate ? now : dayStart
    const act = await saveProductionDocument(ctx, { user: production.user, role: production.role, email }, {
      type: "production",
      restaurantExternalId: restaurant.externalId,
      date,
      sourceWarehouseExternalId: args.sourceWarehouseExternalId,
      destinationWarehouseExternalId: args.destinationWarehouseExternalId,
      comment: `По ведомости полуфабрикатов ${record.number}`,
      lines,
    })
    await ctx.db.patch(record._id, { productionActExternalIds: [...(record.productionActExternalIds ?? []), act.externalId], version: record.version + 1, updatedAt: now })
    await writeOfficeAudit(ctx, email, { action: "semi-finished-sheet.production-act", summary: `По ведомости ${record.number} создан акт приготовления: ${lines.length} позиций`, resourceType: "semi-finished-sheet", resourceExternalId: record.externalId, restaurantExternalId: record.restaurantExternalId, capability: "office.production.edit" })
    return { externalId: act.externalId, lines: lines.length, skipped }
  },
})
