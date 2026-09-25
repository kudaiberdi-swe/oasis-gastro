import { ConvexError, v } from "convex/values"

import { mutation, query, type MutationCtx, type QueryCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { getOfficeAuthEmail, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"
import { businessDateFor } from "../../lib/time"

// «Расписание» (W2-HR-04): planned shifts per employee. Overlaps are checked over the employee's index
// window [start − 24 h, end), never by scanning the table (B-27). Drafts become visible when published.

const DAY = 86_400_000
const hoursOf = (start: number, end: number, breakMinutes: number) => Math.max(0, Math.round(((end - start) / 3_600_000 - breakMinutes / 60) * 100) / 100)
const dayStart = (date: string) => Date.parse(`${date}T00:00:00+05:00`)
const dateLabel = (at: number) => new Date(at + 5 * 3_600_000).toISOString().slice(0, 16).replace("T", " ")

async function restaurantOf(ctx: QueryCtx, externalId: string) {
  const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!restaurant) throw new ConvexError("Ресторан не найден")
  return restaurant
}

async function employeesOf(ctx: QueryCtx, restaurant: Doc<"restaurants">) {
  const rows: Doc<"employees">[] = []
  for await (const employee of ctx.db.query("employees").withIndex("by_role_name")) if (employee.active && employee.restaurantIds.includes(restaurant._id)) rows.push(employee)
  return rows.sort((a, b) => a.displayName.localeCompare(b.displayName, "ru"))
}

async function assertNoOverlap(ctx: MutationCtx, employeeId: Doc<"employees">["_id"], start: number, end: number, except?: string) {
  const near = await ctx.db.query("scheduleEntries").withIndex("by_employee_start", (q) => q.eq("employeeId", employeeId).gte("start", start - DAY).lt("start", end)).take(50)
  const clash = near.find((row) => row.status !== "inactive" && row.externalId !== except && row.start < end && row.end > start)
  if (clash) throw new ConvexError(`Смена пересекается с существующим расписанием: ${dateLabel(clash.start)}`)
}

/** A week of the restaurant: employees × 7 days with shift blocks, hours per employee and day, over-norm flags. */
export const scheduleWeek = query({
  args: { restaurantExternalId: v.string(), weekStart: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.schedule.view")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const restaurant = await restaurantOf(ctx, args.restaurantExternalId)
    const days = Array.from({ length: 7 }, (_, index) => new Date(dayStart(args.weekStart) + 5 * 3_600_000 + index * DAY).toISOString().slice(0, 10))
    const entries = await ctx.db.query("scheduleEntries").withIndex("by_restaurant_date", (q) => q.eq("restaurantExternalId", restaurant.externalId).gte("businessDate", days[0]).lte("businessDate", days[6])).take(200)
    const positions = new Map((await ctx.db.query("positions").take(200)).map((row) => [row.externalId, row]))
    const shiftTypes = new Map((await ctx.db.query("shiftTypes").take(200)).map((row) => [row.externalId, row]))
    const employees = await employeesOf(ctx, restaurant)
    return {
      days,
      rows: employees.map((employee) => {
        const own = entries.filter((row) => row.employeeId === employee._id && row.status !== "inactive")
        const planned = own.reduce((sum, row) => sum + row.plannedHours, 0)
        const norm = employee.positionExternalId ? positions.get(employee.positionExternalId)?.weeklyHours ?? null : null
        return {
          employeeId: employee._id,
          employeeName: employee.displayName,
          employeeCode: employee.code,
          positionName: employee.positionExternalId ? positions.get(employee.positionExternalId)?.name ?? null : null,
          plannedHours: planned,
          weeklyNorm: norm,
          overNorm: norm !== null && planned > norm,
          days: days.map((date) => ({
            date,
            hours: own.filter((row) => row.businessDate === date).reduce((sum, row) => sum + row.plannedHours, 0),
            shifts: own.filter((row) => row.businessDate === date).map((row) => ({ ...row, colorToken: row.shiftTypeExternalId ? shiftTypes.get(row.shiftTypeExternalId)?.colorToken ?? null : null, shiftTypeName: row.shiftTypeExternalId ? shiftTypes.get(row.shiftTypeExternalId)?.name ?? null : null })),
          })),
        }
      }),
    }
  },
})

export const saveEntry = mutation({
  args: { externalId: v.optional(v.string()), expectedVersion: v.optional(v.number()), restaurantExternalId: v.string(), employeeId: v.id("employees"), shiftTypeExternalId: v.optional(v.string()), positionExternalId: v.optional(v.string()), start: v.number(), end: v.number(), breakMinutes: v.number(), comment: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.schedule.edit")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    const restaurant = await restaurantOf(ctx, args.restaurantExternalId)
    const employee = await ctx.db.get(args.employeeId)
    if (!employee?.active || !employee.restaurantIds.includes(restaurant._id)) throw new ConvexError("Сотрудник не работает в этом ресторане")
    if (!(args.end > args.start)) throw new ConvexError("Окончание смены должно быть позже начала")
    if (args.end - args.start > DAY) throw new ConvexError("Смена не может быть длиннее суток")
    if (!(Number.isInteger(args.breakMinutes) && args.breakMinutes >= 0 && args.breakMinutes * 60_000 < args.end - args.start)) throw new ConvexError("Перерыв должен быть короче смены")
    await assertNoOverlap(ctx, employee._id, args.start, args.end, args.externalId)
    const now = Date.now()
    const value = { employeeId: employee._id, employeeCode: employee.code, employeeName: employee.displayName, restaurantExternalId: restaurant.externalId, businessDate: businessDateFor(args.start, restaurant.businessDayCutoffMinutes), shiftTypeExternalId: args.shiftTypeExternalId, positionExternalId: args.positionExternalId ?? employee.positionExternalId, start: args.start, end: args.end, breakMinutes: args.breakMinutes, plannedHours: hoursOf(args.start, args.end, args.breakMinutes), comment: args.comment?.trim() || undefined, updatedAt: now }
    let externalId = args.externalId
    if (externalId) {
      const existing = await ctx.db.query("scheduleEntries").withIndex("by_external_id", (q) => q.eq("externalId", externalId!)).unique()
      if (!existing || existing.restaurantExternalId !== restaurant.externalId) throw new ConvexError("Смена не найдена")
      if (existing.status !== "draft") throw new ConvexError("Опубликованную смену меняют через отключение и новую смену")
      if (args.expectedVersion !== undefined && existing.version !== args.expectedVersion) throw new ConvexError("Смену изменил другой пользователь — обновите страницу")
      await ctx.db.patch(existing._id, { ...value, version: existing.version + 1 })
    } else {
      externalId = `schedule-${crypto.randomUUID()}`
      await ctx.db.insert("scheduleEntries", { ...value, externalId, status: "draft", version: 1, createdAt: now })
    }
    await writeOfficeAudit(ctx, email, { action: "schedule.save", summary: `Смена ${employee.displayName}: ${dateLabel(args.start)}, ${value.plannedHours} ч`, resourceType: "schedule", resourceExternalId: externalId, restaurantExternalId: restaurant.externalId, capability: "office.schedule.edit" })
    return externalId
  },
})

/** Draft → deleted; published → inactive (history stays). */
export const removeEntry = mutation({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.schedule.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const entry = await ctx.db.query("scheduleEntries").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!entry) throw new ConvexError("Смена не найдена")
    await requireRestaurantScope(ctx, user, entry.restaurantExternalId)
    if (entry.status === "draft") await ctx.db.delete(entry._id)
    else await ctx.db.patch(entry._id, { status: "inactive", version: entry.version + 1, updatedAt: Date.now() })
    await writeOfficeAudit(ctx, email, { action: "schedule.remove", summary: `Снята смена ${entry.employeeName}: ${dateLabel(entry.start)}`, resourceType: "schedule", resourceExternalId: entry.externalId, restaurantExternalId: entry.restaurantExternalId, capability: "office.schedule.edit" })
  },
})

/** Copies a week as drafts; shifts that would overlap are skipped and counted. */
export const copyWeek = mutation({
  args: { restaurantExternalId: v.string(), fromWeekStart: v.string(), toWeekStart: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.schedule.edit")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    const shift = dayStart(args.toWeekStart) - dayStart(args.fromWeekStart)
    if (shift === 0) throw new ConvexError("Выберите другую неделю")
    const from = args.fromWeekStart
    const to = new Date(dayStart(from) + 5 * 3_600_000 + 6 * DAY).toISOString().slice(0, 10)
    const source = await ctx.db.query("scheduleEntries").withIndex("by_restaurant_date", (q) => q.eq("restaurantExternalId", args.restaurantExternalId).gte("businessDate", from).lte("businessDate", to)).take(200)
    let copied = 0
    let skipped = 0
    const now = Date.now()
    for (const entry of source) {
      if (entry.status === "inactive") continue
      try {
        await assertNoOverlap(ctx, entry.employeeId, entry.start + shift, entry.end + shift)
      } catch {
        skipped += 1
        continue
      }
      const { _id, _creationTime, externalId: _old, ...rest } = entry
      await ctx.db.insert("scheduleEntries", { ...rest, externalId: `schedule-${crypto.randomUUID()}`, start: entry.start + shift, end: entry.end + shift, businessDate: new Date(Date.parse(`${entry.businessDate}T00:00:00Z`) + shift).toISOString().slice(0, 10), status: "draft", version: 1, createdAt: now, updatedAt: now })
      copied += 1
    }
    await writeOfficeAudit(ctx, email, { action: "schedule.copy", summary: `Неделя ${args.fromWeekStart} скопирована на ${args.toWeekStart}: ${copied} смен`, resourceType: "schedule", resourceExternalId: args.toWeekStart, restaurantExternalId: args.restaurantExternalId, capability: "office.schedule.edit" })
    return { copied, skipped }
  },
})

export const publishWeek = mutation({
  args: { restaurantExternalId: v.string(), weekStart: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.schedule.approve")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    const to = new Date(dayStart(args.weekStart) + 5 * 3_600_000 + 6 * DAY).toISOString().slice(0, 10)
    const rows = await ctx.db.query("scheduleEntries").withIndex("by_restaurant_date", (q) => q.eq("restaurantExternalId", args.restaurantExternalId).gte("businessDate", args.weekStart).lte("businessDate", to)).take(200)
    let published = 0
    for (const row of rows) {
      if (row.status !== "draft") continue
      await ctx.db.patch(row._id, { status: "published", version: row.version + 1, updatedAt: Date.now() })
      published += 1
    }
    await writeOfficeAudit(ctx, email, { action: "schedule.publish", summary: `Опубликована неделя ${args.weekStart}: ${published} смен`, resourceType: "schedule", resourceExternalId: args.weekStart, restaurantExternalId: args.restaurantExternalId, capability: "office.schedule.approve" })
    return { published }
  },
})
