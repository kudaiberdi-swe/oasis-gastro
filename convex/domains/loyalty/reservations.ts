import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { mutation, query, type MutationCtx, type QueryCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { resolvePaymentType } from "../../lib/checkoutCore"
import { journalReady, postJournalEntry, reverseJournalEntries } from "../../lib/ledger"
import { normalizePhone } from "../../lib/loyalty"
import { nextNumber } from "../../lib/numbering"
import { getOfficeAuthEmail, hasScope, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"
import { appendOutboxEvent } from "../../lib/outbox"
import { assertPeriodOpen } from "../../lib/periods"
import { maskPhone } from "../../lib/pii"
import { almatyDayStart, businessDateFor } from "../../lib/time"

// Banquets and reservations with the floor plan (W2-LOY-07). Lifecycle: draft → pending-approval →
// approved → completed, or cancelled. A table can't be booked twice for overlapping time.

const DAY = 86_400_000
const MAX_DURATION = DAY
type Status = Doc<"reservations">["status"]
const LIVE: Status[] = ["draft", "pending-approval", "approved"]

async function requireReservation(ctx: QueryCtx, externalId: string) {
  const row = await ctx.db.query("reservations").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!row) throw new ConvexError("Бронь не найдена")
  return row
}

async function canSeePii(ctx: QueryCtx) {
  try {
    await requireOfficeCapability(ctx, "office.guests.pii")
    return true
  } catch {
    return false
  }
}

/** Live reservations of a table overlapping [start, end), excluding one reservation. */
async function overlapping(ctx: QueryCtx, tableExternalId: string, start: number, end: number, exceptExternalId?: string) {
  const rows = await ctx.db.query("tableReservations").withIndex("by_table_start", (q) => q.eq("tableExternalId", tableExternalId).gt("start", start - MAX_DURATION).lt("start", end)).take(100)
  return rows.filter((row) => row.end > start && row.reservationExternalId !== exceptExternalId)
}

async function syncTableRows(ctx: MutationCtx, reservation: Doc<"reservations">) {
  for (const row of await ctx.db.query("tableReservations").withIndex("by_reservation", (q) => q.eq("reservationExternalId", reservation.externalId)).take(50)) await ctx.db.delete(row._id)
  if (reservation.status === "cancelled") return
  for (const tableExternalId of reservation.tableExternalIds) await ctx.db.insert("tableReservations", { tableExternalId, reservationExternalId: reservation.externalId, start: reservation.start, end: reservation.end, status: reservation.status })
}

// --- Tables and the floor plan --------------------------------------------------------------

export const listTables = query({
  args: { restaurantExternalId: v.string(), hall: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.reservations.view")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    return ctx.db.query("diningTables").withIndex("by_restaurant_hall", (q) => (args.hall ? q.eq("restaurantExternalId", args.restaurantExternalId).eq("hall", args.hall) : q.eq("restaurantExternalId", args.restaurantExternalId))).take(200)
  },
})

export const saveTable = mutation({
  args: { externalId: v.optional(v.string()), restaurantExternalId: v.string(), hall: v.string(), label: v.string(), capacity: v.number(), shape: v.union(v.literal("rect"), v.literal("circle")), x: v.number(), y: v.number(), width: v.number(), height: v.number(), rotation: v.number(), active: v.boolean() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.reservations.edit")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    const hall = args.hall.trim()
    const label = args.label.trim()
    if (!hall || !label) throw new ConvexError("Укажите зал и название стола")
    if (!(Number.isInteger(args.capacity) && args.capacity >= 1 && args.capacity <= 200)) throw new ConvexError("Вместимость — от 1 до 200 гостей")
    if (!(args.width > 0 && args.height > 0) || [args.x, args.y].some((value) => !(value >= 0 && value <= 10_000))) throw new ConvexError("Проверьте размеры и положение стола")
    const existing = args.externalId ? await ctx.db.query("diningTables").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId!)).unique() : null
    if (args.externalId && !existing) throw new ConvexError("Стол не найден")
    if (existing && existing.restaurantExternalId !== args.restaurantExternalId) throw new ConvexError("Стол другого ресторана")
    const twin = await ctx.db.query("diningTables").withIndex("by_restaurant_hall", (q) => q.eq("restaurantExternalId", args.restaurantExternalId).eq("hall", hall).eq("label", label)).first()
    if (twin && twin._id !== existing?._id) throw new ConvexError(`Стол «${label}» в зале «${hall}» уже есть`)
    if (existing && !args.active) {
      const future = await ctx.db.query("tableReservations").withIndex("by_table_start", (q) => q.eq("tableExternalId", existing.externalId).gt("start", Date.now())).first()
      if (future) throw new ConvexError("На стол есть будущие брони — отключить можно после них")
    }
    const value = { restaurantExternalId: args.restaurantExternalId, hall, label, capacity: args.capacity, shape: args.shape, x: args.x, y: args.y, width: args.width, height: args.height, rotation: ((args.rotation % 360) + 360) % 360, active: args.active, updatedAt: Date.now() }
    const externalId = existing?.externalId ?? `table-${crypto.randomUUID()}`
    if (existing) await ctx.db.patch(existing._id, value)
    else await ctx.db.insert("diningTables", { ...value, externalId })
    await writeOfficeAudit(ctx, email, { action: "reservation.table", summary: `Стол «${label}» (${hall}), ${args.capacity} мест`, resourceType: "reservations", resourceExternalId: externalId, restaurantExternalId: args.restaurantExternalId, capability: "office.reservations.edit" })
    return externalId
  },
})

/** Tables of a hall with their reservations on a day — the floor plan colours tables by these. */
export const floorPlan = query({
  args: { restaurantExternalId: v.string(), date: v.string(), hall: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.reservations.view")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new ConvexError("Дата — ГГГГ-ММ-ДД")
    const dayStart = almatyDayStart(args.date)
    const dayEnd = dayStart + DAY
    const tables = await ctx.db.query("diningTables").withIndex("by_restaurant_hall", (q) => (args.hall ? q.eq("restaurantExternalId", args.restaurantExternalId).eq("hall", args.hall) : q.eq("restaurantExternalId", args.restaurantExternalId))).take(200)
    const halls = [...new Set(tables.map((table) => table.hall))]
    const pii = await canSeePii(ctx)
    const rows = await Promise.all(
      tables.map(async (table) => {
        const bookings = await overlapping(ctx, table.externalId, dayStart, dayEnd)
        const reservations = await Promise.all(bookings.map(async (booking) => {
          const reservation = await ctx.db.query("reservations").withIndex("by_external_id", (q) => q.eq("externalId", booking.reservationExternalId)).unique()
          return reservation ? { externalId: reservation.externalId, number: reservation.number, status: reservation.status, start: reservation.start, end: reservation.end, guestName: reservation.guestName, phone: pii ? reservation.phone : maskPhone(reservation.phone), guestCount: reservation.guestCount, recordType: reservation.recordType } : null
        }))
        return { ...table, reservations: reservations.filter((row) => row !== null).sort((a, b) => a!.start - b!.start) }
      }),
    )
    return { halls, tables: rows }
  },
})

// --- Reservations ---------------------------------------------------------------------------

export const listReservations = query({
  args: { restaurantExternalId: v.optional(v.string()), status: v.optional(v.union(v.literal("draft"), v.literal("pending-approval"), v.literal("approved"), v.literal("completed"), v.literal("cancelled"))), search: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.reservations.view")
    if (args.restaurantExternalId) await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const needle = args.search?.trim().toLocaleLowerCase("ru")
    const page = needle
      ? await ctx.db.query("reservations").withSearchIndex("search_reservations", (q) => {
          let scoped = q.search("searchText", needle)
          if (args.restaurantExternalId) scoped = scoped.eq("restaurantExternalId", args.restaurantExternalId)
          if (args.status) scoped = scoped.eq("status", args.status)
          return scoped
        }).paginate(args.paginationOpts)
      : args.restaurantExternalId
        ? await ctx.db.query("reservations").withIndex("by_restaurant_start", (q) => q.eq("restaurantExternalId", args.restaurantExternalId!)).order("desc").filter((q) => (args.status ? q.eq(q.field("status"), args.status) : true)).paginate(args.paginationOpts)
        : args.status
          ? await ctx.db.query("reservations").withIndex("by_status_start", (q) => q.eq("status", args.status!)).order("desc").paginate(args.paginationOpts)
          : await ctx.db.query("reservations").order("desc").paginate(args.paginationOpts)
    const pii = await canSeePii(ctx)
    const visible = page.page.filter((row) => hasScope(user.restaurantScopes, row.restaurantExternalId) && (!args.status || row.status === args.status))
    const labels = new Map<string, string>()
    for (const row of visible) {
      for (const id of row.tableExternalIds) {
        if (labels.has(id)) continue
        const table = await ctx.db.query("diningTables").withIndex("by_external_id", (q) => q.eq("externalId", id)).unique()
        labels.set(id, table?.label ?? "—")
      }
    }
    return { ...page, page: visible.map((row) => ({ ...row, phone: pii ? row.phone : maskPhone(row.phone), tableLabels: row.tableExternalIds.map((id) => labels.get(id) ?? "—") })) }
  },
})

export const getReservation = query({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.reservations.view")
    const row = await ctx.db.query("reservations").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!row || !hasScope(user.restaurantScopes, row.restaurantExternalId)) return null
    await requireRestaurantScope(ctx, user, row.restaurantExternalId)
    return { ...row, phone: (await canSeePii(ctx)) ? row.phone : maskPhone(row.phone) }
  },
})

/** KPI «Предстоящих резервов»: approved or pending, starting from now, bounded. */
export const reservationSummary = query({
  args: { restaurantExternalId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.reservations.view")
    if (args.restaurantExternalId) await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const now = Date.now()
    let upcoming = 0
    for (const status of ["pending-approval", "approved"] as const) {
      const rows = await ctx.db.query("reservations").withIndex("by_status_start", (q) => q.eq("status", status).gte("start", now)).take(200)
      upcoming += rows.filter((row) => (args.restaurantExternalId ? row.restaurantExternalId === args.restaurantExternalId : hasScope(user.restaurantScopes, row.restaurantExternalId))).length
    }
    return { upcoming }
  },
})

export const saveReservation = mutation({
  args: {
    externalId: v.optional(v.string()),
    restaurantExternalId: v.string(),
    recordType: v.union(v.literal("reservation"), v.literal("banquet")),
    hall: v.string(),
    tableExternalIds: v.array(v.string()),
    guestId: v.optional(v.id("guests")),
    guestName: v.string(),
    phone: v.string(),
    start: v.number(),
    end: v.number(),
    guestCount: v.number(),
    occasion: v.string(),
    prepayment: v.number(),
    prepaymentTypeExternalId: v.optional(v.string()),
    menu: v.string(),
    expectedVersion: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.reservations.edit")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.restaurantExternalId)).unique()
    if (!restaurant?.active) throw new ConvexError("Ресторан не найден или отключён")
    const existing = args.externalId ? await requireReservation(ctx, args.externalId) : null
    if (existing && existing.restaurantExternalId !== restaurant.externalId) throw new ConvexError("Ресторан брони изменить нельзя")
    if (existing && args.expectedVersion !== undefined && existing.version !== args.expectedVersion) throw new ConvexError("Бронь изменена другим пользователем. Обновите карточку")
    if (existing && existing.status !== "draft") throw new ConvexError("Изменить можно только черновик")
    if (!(args.end > args.start)) throw new ConvexError("Окончание должно быть позже начала")
    if (args.end - args.start > MAX_DURATION) throw new ConvexError("Бронь — не дольше суток")
    if (!existing && args.start < Date.now() - 3_600_000) throw new ConvexError("Время брони уже прошло")
    if (!(Number.isInteger(args.guestCount) && args.guestCount >= 1)) throw new ConvexError("Укажите число гостей")
    if (!(Number.isInteger(args.prepayment) && args.prepayment >= 0)) throw new ConvexError("Предоплата — целое число тенге")
    if (args.prepayment > 0 && !args.prepaymentTypeExternalId) throw new ConvexError("Укажите тип оплаты предоплаты")
    const guestName = args.guestName.trim()
    const phone = normalizePhone(args.phone)
    if (guestName.length < 2 || !phone) throw new ConvexError("Укажите имя и телефон гостя")
    if (args.guestId && !(await ctx.db.get(args.guestId))) throw new ConvexError("Гость не найден")
    if (!args.tableExternalIds.length) throw new ConvexError("Выберите стол")
    let capacity = 0
    for (const tableExternalId of new Set(args.tableExternalIds)) {
      const table = await ctx.db.query("diningTables").withIndex("by_external_id", (q) => q.eq("externalId", tableExternalId)).unique()
      if (!table?.active || table.restaurantExternalId !== restaurant.externalId) throw new ConvexError("Стол не найден в ресторане")
      capacity += table.capacity
      const clash = await overlapping(ctx, tableExternalId, args.start, args.end, existing?.externalId)
      if (clash.length) {
        const other = await ctx.db.query("reservations").withIndex("by_external_id", (q) => q.eq("externalId", clash[0].reservationExternalId)).unique()
        throw new ConvexError(`Стол «${table.label}» уже забронирован${other ? ` (${other.number})` : ""} на это время`)
      }
    }
    if (capacity < args.guestCount) throw new ConvexError(`Вместимость выбранных столов — ${capacity}, гостей ${args.guestCount}`)
    const now = Date.now()
    const number = existing?.number ?? (await nextNumber(ctx, { moduleId: "reservations", prefix: "RSV", organizationExternalId: restaurant.organizationExternalId, businessDate: businessDateFor(args.start, restaurant.businessDayCutoffMinutes) }))
    const value = {
      recordType: args.recordType,
      hall: args.hall.trim(),
      tableExternalIds: [...new Set(args.tableExternalIds)],
      guestId: args.guestId,
      guestName,
      phone,
      start: args.start,
      end: args.end,
      guestCount: args.guestCount,
      occasion: args.occasion.trim(),
      prepayment: args.prepayment,
      prepaymentTypeExternalId: args.prepayment > 0 ? args.prepaymentTypeExternalId : undefined,
      menu: args.menu.trim(),
      searchText: `${number} ${guestName} ${phone} ${args.occasion}`.toLocaleLowerCase("ru"),
      updatedAt: now,
    }
    let reservation: Doc<"reservations">
    if (existing) {
      await ctx.db.patch(existing._id, { ...value, version: existing.version + 1 })
      reservation = (await ctx.db.get(existing._id))!
    } else {
      const id = await ctx.db.insert("reservations", { ...value, externalId: `reservation-${crypto.randomUUID()}`, number, organizationExternalId: restaurant.organizationExternalId, restaurantExternalId: restaurant.externalId, status: "draft", version: 1, createdBy: email, createdAt: now })
      reservation = (await ctx.db.get(id))!
    }
    await syncTableRows(ctx, reservation)
    await writeOfficeAudit(ctx, email, { action: "reservation.save", summary: `${args.recordType === "banquet" ? "Банкет" : "Резерв"} ${number}: ${args.guestCount} гостей`, resourceType: "reservations", resourceExternalId: reservation.externalId, restaurantExternalId: restaurant.externalId, capability: "office.reservations.edit" })
    return { externalId: reservation.externalId, number, version: reservation.version }
  },
})

const ACTIONS = {
  submit: { from: ["draft"], to: "pending-approval", capability: "edit" },
  approve: { from: ["pending-approval"], to: "approved", capability: "approve" },
  complete: { from: ["approved"], to: "completed", capability: "post" },
  cancel: { from: LIVE, to: "cancelled", capability: "cancel" },
} as const

/**
 * Lifecycle steps. Approval of a prepaid booking posts the advance (Dr the payment type's account /
 * Cr 3520); cancelling returns it with a reversal. Completing links the check it was closed with —
 * the advance is offset there by a payment type booked to 3520.
 */
export const transitionReservation = mutation({
  args: { externalId: v.string(), action: v.union(v.literal("submit"), v.literal("approve"), v.literal("complete"), v.literal("cancel")), expectedVersion: v.number(), reason: v.optional(v.string()), orderId: v.optional(v.id("orders")) },
  handler: async (ctx, args) => {
    const step = ACTIONS[args.action]
    const capability = `office.reservations.${step.capability}`
    const { user } = await requireOfficeCapability(ctx, capability)
    const email = (await getOfficeAuthEmail(ctx))!
    const reservation = await requireReservation(ctx, args.externalId)
    await requireRestaurantScope(ctx, user, reservation.restaurantExternalId)
    if (reservation.version !== args.expectedVersion) throw new ConvexError("Бронь изменена другим пользователем. Обновите карточку")
    if (!(step.from as readonly Status[]).includes(reservation.status)) throw new ConvexError("Действие недоступно для текущего статуса")
    const now = Date.now()
    const restaurant = (await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", reservation.restaurantExternalId)).unique())!
    const businessDate = businessDateFor(now, restaurant.businessDayCutoffMinutes)
    const patch: Partial<Doc<"reservations">> = {}
    if (args.action === "approve" && reservation.prepayment > 0) {
      await assertPeriodOpen(ctx, { organizationExternalId: reservation.organizationExternalId, restaurantExternalId: reservation.restaurantExternalId, businessDate, moduleId: "reservations" })
      const type = await resolvePaymentType(ctx, reservation.restaurantExternalId, { paymentTypeExternalId: reservation.prepaymentTypeExternalId }, now)
      if (await journalReady(ctx)) {
        await postJournalEntry(ctx, { externalId: `${reservation.externalId}:prepayment`, restaurantExternalId: reservation.restaurantExternalId, sourceModuleId: "reservations", sourceExternalId: reservation.externalId, sourceNumber: reservation.number, occurredAt: now, businessDate, debitAccount: type.account, creditAccount: "customerAdvances", amount: reservation.prepayment, description: `Предоплата ${reservation.number} (${type.name})` })
      }
      patch.prepaymentPostedAt = now
    }
    if (args.action === "cancel") {
      const reason = args.reason?.trim() ?? ""
      if (reason.length < 3) throw new ConvexError("Укажите причину отмены")
      if (reservation.prepaymentPostedAt) {
        await assertPeriodOpen(ctx, { organizationExternalId: reservation.organizationExternalId, restaurantExternalId: reservation.restaurantExternalId, businessDate, moduleId: "reservations" })
        await reverseJournalEntries(ctx, { sourceExternalId: reservation.externalId, occurredAt: now, reversalKey: "cancel", description: `Возврат предоплаты ${reservation.number}: ${reason}` })
      }
      patch.cancelReason = reason
    }
    if (args.action === "complete" && args.orderId) {
      const order = await ctx.db.get(args.orderId)
      if (!order || order.restaurantId !== restaurant._id || order.status !== "paid") throw new ConvexError("Чек не найден среди оплаченных чеков ресторана")
      patch.orderId = order._id
    }
    await ctx.db.patch(reservation._id, { ...patch, status: step.to, version: reservation.version + 1, updatedAt: now })
    await syncTableRows(ctx, (await ctx.db.get(reservation._id))!)
    await writeOfficeAudit(ctx, email, { action: `reservation.${args.action}`, summary: `${reservation.number}: ${reservation.status} → ${step.to}${args.reason ? ` — ${args.reason.trim()}` : ""}`, resourceType: "reservations", resourceExternalId: reservation.externalId, restaurantExternalId: reservation.restaurantExternalId, capability })
    await appendOutboxEvent(ctx, { aggregateType: "reservation", aggregateExternalId: reservation.externalId, eventType: `reservation.${step.to}`, restaurantExternalId: reservation.restaurantExternalId, payload: { number: reservation.number, start: reservation.start } })
    return { status: step.to, version: reservation.version + 1 }
  },
})
