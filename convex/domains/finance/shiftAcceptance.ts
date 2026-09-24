import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { mutation, query, type QueryCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { postJournalEntry, reverseJournalEntries } from "../../lib/ledger"
import { getOfficeAuthEmail, requireOfficeCapability, requireRestaurantScope, restaurantScopeFilter, scopedRestaurants, writeOfficeAudit } from "../../lib/officeAccess"
import { appendOutboxEvent } from "../../lib/outbox"
import { assertPeriodOpen } from "../../lib/periods"

// Shift acceptance (W1-FIN-06): the one implementation. Accounting recounts a closed shift's cash; a
// variance posts surplus Dr cash / Cr other income, shortage Dr shortages / Cr cash.

async function activeAcceptance(ctx: QueryCtx, shiftId: Doc<"shifts">["_id"]) {
  const rows = await ctx.db.query("cashShiftAcceptances").withIndex("by_shift", (q) => q.eq("shiftId", shiftId)).take(20)
  return rows.find((row) => !row.reversedAt) ?? null
}

/** Closed shifts of the user's restaurants still waiting for acceptance, newest first. */
export const candidates = query({
  args: { restaurantExternalId: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.shift-acceptance.view")
    restaurantScopeFilter(user, args.restaurantExternalId)
    const restaurants = args.restaurantExternalId
      ? [await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.restaurantExternalId!)).unique()].filter((row): row is Doc<"restaurants"> => Boolean(row))
      : await scopedRestaurants(ctx, user)
    // One index range per restaurant; the page cursor applies to the first restaurant's range when there are several.
    const rows: Array<Doc<"shifts"> & { restaurantName: string }> = []
    let isDone = true
    let continueCursor = ""
    for (const [index, restaurant] of restaurants.entries()) {
      if (index === 0) {
        const page = await ctx.db.query("shifts").withIndex("by_restaurant_status_closed", (q) => q.eq("restaurantId", restaurant._id).eq("status", "closed")).order("desc").paginate(args.paginationOpts)
        isDone = page.isDone && restaurants.length === 1
        continueCursor = page.continueCursor
        rows.push(...page.page.map((shift) => ({ ...shift, restaurantName: restaurant.name })))
      } else {
        const recent = await ctx.db.query("shifts").withIndex("by_restaurant_status_closed", (q) => q.eq("restaurantId", restaurant._id).eq("status", "closed")).order("desc").take(50)
        rows.push(...recent.map((shift) => ({ ...shift, restaurantName: restaurant.name })))
      }
    }
    const pending = []
    for (const shift of rows) {
      if (await activeAcceptance(ctx, shift._id)) continue
      const [terminal, closedBy] = await Promise.all([ctx.db.get(shift.terminalId), shift.closedBy ? ctx.db.get(shift.closedBy) : null])
      pending.push({
        shiftId: shift._id,
        restaurantName: shift.restaurantName,
        terminalName: terminal?.name ?? "Касса",
        shiftNumber: shift.number,
        businessDate: shift.businessDate,
        zReportNumber: shift.zReportNumber ?? null,
        closedAt: shift.closedAt ?? null,
        closedByName: closedBy?.displayName ?? null,
        expectedCash: shift.expectedCash ?? 0,
        countedCash: shift.countedCash ?? 0,
        variance: shift.variance ?? 0,
      })
    }
    pending.sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
    return { page: pending, isDone, continueCursor }
  },
})

export const acceptShift = mutation({
  args: { shiftId: v.id("shifts"), recountedCash: v.number(), note: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.shift-acceptance.post")
    const email = (await getOfficeAuthEmail(ctx))!
    const shift = await ctx.db.get(args.shiftId)
    const restaurant = shift ? await ctx.db.get(shift.restaurantId) : null
    if (!shift || !restaurant) throw new ConvexError("Смена не найдена")
    await requireRestaurantScope(ctx, user, restaurant.externalId)
    if (shift.status !== "closed") throw new ConvexError("Принять можно только закрытую смену")
    const existing = await activeAcceptance(ctx, shift._id)
    if (existing) return existing._id
    if (!Number.isInteger(args.recountedCash) || args.recountedCash < 0) throw new ConvexError("Пересчитанная наличность — целое число тенге")
    await assertPeriodOpen(ctx, { organizationExternalId: restaurant.organizationExternalId, restaurantExternalId: restaurant.externalId, businessDate: shift.businessDate, moduleId: "shift-acceptance" })
    const expectedCash = shift.expectedCash ?? 0
    const variance = args.recountedCash - expectedCash
    if (variance !== 0 && args.note.trim().length < 3) throw new ConvexError("При расхождении укажите комментарий")
    const now = Date.now()
    let journalEntryExternalId: string | undefined
    if (variance !== 0) {
      const entry = await postJournalEntry(ctx, {
        externalId: `shift-variance-${shift._id}`,
        restaurantExternalId: restaurant.externalId,
        sourceModuleId: "shift-acceptance",
        sourceExternalId: String(shift._id),
        sourceNumber: shift.zReportNumber ?? `Смена №${shift.number}`,
        occurredAt: now,
        businessDate: shift.businessDate,
        debitAccount: variance > 0 ? "cash" : "cashShortage",
        creditAccount: variance > 0 ? "otherIncome" : "cash",
        amount: Math.abs(variance),
        description: `${variance > 0 ? "Излишек" : "Недостача"} по смене №${shift.number}`,
      })
      journalEntryExternalId = entry.externalId
    }
    const id = await ctx.db.insert("cashShiftAcceptances", {
      shiftId: shift._id,
      restaurantExternalId: restaurant.externalId,
      acceptedByEmail: email,
      acceptedAt: now,
      note: args.note.trim(),
      expectedCash,
      countedAtCloseCash: shift.countedCash ?? 0,
      recountedCash: args.recountedCash,
      variance,
      ...(journalEntryExternalId ? { journalEntryExternalId } : {}),
    })
    await writeOfficeAudit(ctx, email, { action: "finance.shift.accept", summary: `Принята смена №${shift.number}: пересчитано ${args.recountedCash} ₸, расхождение ${variance} ₸`, resourceType: "shift", resourceExternalId: String(shift._id), restaurantExternalId: restaurant.externalId, capability: "office.shift-acceptance.post" })
    await appendOutboxEvent(ctx, { aggregateType: "shift", aggregateExternalId: String(shift._id), eventType: "shift.accepted", restaurantExternalId: restaurant.externalId, payload: { shiftNumber: shift.number, businessDate: shift.businessDate, variance } })
    return id
  },
})

export const reverseShiftAcceptance = mutation({
  args: { shiftId: v.id("shifts"), reason: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.shift-acceptance.reverse")
    const email = (await getOfficeAuthEmail(ctx))!
    const acceptance = await activeAcceptance(ctx, args.shiftId)
    if (!acceptance) throw new ConvexError("Смена не принята")
    await requireRestaurantScope(ctx, user, acceptance.restaurantExternalId)
    if (args.reason.trim().length < 3) throw new ConvexError("Укажите причину")
    const now = Date.now()
    if (acceptance.journalEntryExternalId) await reverseJournalEntries(ctx, { sourceExternalId: String(args.shiftId), occurredAt: now, reversalKey: `acceptance-${acceptance._id}`, description: `Сторно приёмки смены: ${args.reason.trim()}` })
    await ctx.db.patch(acceptance._id, { reversedAt: now, reversedByEmail: email, reverseReason: args.reason.trim() })
    await writeOfficeAudit(ctx, email, { action: "finance.shift.reverse", summary: `Сторно приёмки смены: ${args.reason.trim()}`, resourceType: "shift", resourceExternalId: String(args.shiftId), restaurantExternalId: acceptance.restaurantExternalId, capability: "office.shift-acceptance.reverse" })
  },
})

/** Accepted shifts of a restaurant, newest first (the register under the panel). */
export const acceptances = query({
  args: { restaurantExternalId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.shift-acceptance.view")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    return ctx.db.query("cashShiftAcceptances").withIndex("by_restaurant_accepted", (q) => q.eq("restaurantExternalId", args.restaurantExternalId)).order("desc").paginate(args.paginationOpts)
  },
})
