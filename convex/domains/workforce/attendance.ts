import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { mutation, query } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { hoursBetween, closeAttendance, openAttendance, openAttendanceOf } from "../../lib/attendance"
import { requireAnyOperator, touchSession } from "../../lib/auth"
import { writeAudit } from "../../lib/audit"
import { nextNumber } from "../../lib/numbering"
import { businessDateFor } from "../../lib/time"
import { getOfficeAuthEmail, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"

// Attendance log (W1-HR-05). POS: clock in / out from the profile (every role, kitchen too).
// Office: the log, corrections with a reason, submit and approve.

const attendanceType = v.union(v.literal("worked"), v.literal("sick"), v.literal("vacation"), v.literal("absence"))

export const myAttendance = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const access = await requireAnyOperator(ctx, args.sessionToken)
    const open = await ctx.db.query("attendanceRecords").withIndex("by_employee_status", (q) => q.eq("employeeId", access.employee._id).eq("status", "active")).order("desc").first()
    return open ? { externalId: open.externalId, number: open.number, clockIn: open.clockIn, source: open.source } : null
  },
})

export const clockIn = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const access = await requireAnyOperator(ctx, args.sessionToken)
    const before = await openAttendanceOf(ctx, access.employee._id)
    const record = await openAttendance(ctx, access, "pos")
    await touchSession(ctx, access.session._id)
    if (!before) await writeAudit(ctx, access, { action: "attendance.clock-in", summary: `Приход: ${access.employee.displayName}` })
    return { externalId: record.externalId, clockIn: record.clockIn, alreadyOpen: Boolean(before) }
  },
})

export const clockOut = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const access = await requireAnyOperator(ctx, args.sessionToken)
    const record = (await closeAttendance(ctx, access.employee._id, true))!
    await touchSession(ctx, access.session._id)
    await writeAudit(ctx, access, { action: "attendance.clock-out", summary: `Уход: ${access.employee.displayName}, ${record.hours ?? 0} ч` })
    return { externalId: record.externalId, clockOut: record.clockOut, hours: record.hours }
  },
})

const STATUSES = ["active", "completed", "draft", "pending-approval", "approved", "cancelled"] as const

export const list = query({
  args: {
    status: v.optional(v.union(...STATUSES.map((status) => v.literal(status)))),
    restaurantExternalId: v.optional(v.string()),
    search: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.attendance.view")
    if (args.restaurantExternalId) await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const network = user.restaurantScopes.includes("*")
    const needle = args.search?.trim().toLocaleLowerCase("ru")
    const page = needle
      ? await ctx.db.query("attendanceRecords").withSearchIndex("search_attendance", (q) => {
          let scoped = q.search("searchText", needle)
          if (args.status) scoped = scoped.eq("status", args.status)
          if (args.restaurantExternalId) scoped = scoped.eq("restaurantExternalId", args.restaurantExternalId)
          return scoped
        }).paginate(args.paginationOpts)
      : args.restaurantExternalId
        ? await ctx.db.query("attendanceRecords").withIndex("by_restaurant_date", (q) => q.eq("restaurantExternalId", args.restaurantExternalId!)).order("desc").paginate(args.paginationOpts)
        : args.status
          ? await ctx.db.query("attendanceRecords").withIndex("by_status_date", (q) => q.eq("status", args.status!)).order("desc").paginate(args.paginationOpts)
          : await ctx.db.query("attendanceRecords").withIndex("by_status_date").order("desc").paginate(args.paginationOpts)
    const visible = (row: Doc<"attendanceRecords">) => (network || user.restaurantScopes.includes(row.restaurantExternalId)) && (!args.status || row.status === args.status)
    return { ...page, page: page.page.filter(visible) }
  },
})

export const get = query({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.attendance.view")
    const row = await ctx.db.query("attendanceRecords").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!row || !(user.restaurantScopes.includes("*") || user.restaurantScopes.includes(row.restaurantExternalId))) return null
    return row
  },
})

/**
 * Creates a manual record or corrects one. Changing the times of a POS record needs a reason and keeps
 * the POS times in `original`; a corrected record goes back to draft for approval.
 */
export const save = mutation({
  args: {
    externalId: v.optional(v.string()),
    expectedVersion: v.optional(v.number()),
    employeeId: v.id("employees"),
    restaurantExternalId: v.string(),
    clockIn: v.number(),
    clockOut: v.optional(v.number()),
    breakMinutes: v.number(),
    attendanceType,
    correctionReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.attendance.edit")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    const employee = await ctx.db.get(args.employeeId)
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.restaurantExternalId)).unique()
    if (!employee || !restaurant || !employee.restaurantIds.includes(restaurant._id)) throw new ConvexError("Сотрудник не работает в этом ресторане")
    if (args.clockOut !== undefined && args.clockOut <= args.clockIn) throw new ConvexError("Уход должен быть позже прихода")
    if (!Number.isInteger(args.breakMinutes) || args.breakMinutes < 0 || args.breakMinutes > 720) throw new ConvexError("Перерыв — от 0 до 720 минут")
    const hours = args.clockOut !== undefined ? hoursBetween(args.clockIn, args.clockOut, args.breakMinutes) : undefined
    const reason = args.correctionReason?.trim()
    const now = Date.now()
    const businessDate = businessDateFor(args.clockIn, restaurant.businessDayCutoffMinutes)

    if (args.externalId) {
      const row = await ctx.db.query("attendanceRecords").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId!)).unique()
      if (!row || row.restaurantExternalId !== args.restaurantExternalId) throw new ConvexError("Запись не найдена")
      if (args.expectedVersion !== undefined && args.expectedVersion !== row.version) throw new ConvexError("Запись изменена другим пользователем — обновите страницу")
      if (["approved", "cancelled", "active"].includes(row.status)) throw new ConvexError("Запись в этом статусе нельзя изменить")
      const timesChanged = row.clockIn !== args.clockIn || row.clockOut !== args.clockOut
      if (row.source !== "office" && timesChanged && (reason?.length ?? 0) < 3) throw new ConvexError("Укажите причину корректировки")
      await ctx.db.patch(row._id, {
        clockIn: args.clockIn,
        clockOut: args.clockOut,
        breakMinutes: args.breakMinutes,
        hours,
        attendanceType: args.attendanceType,
        businessDate,
        status: "draft",
        ...(reason ? { correctionReason: reason } : {}),
        ...(row.source !== "office" && timesChanged && !row.original ? { original: { clockIn: row.clockIn, clockOut: row.clockOut } } : {}),
        version: row.version + 1,
        updatedAt: now,
      })
      await writeOfficeAudit(ctx, email, { action: "attendance.correct", summary: `Корректировка явки ${row.number}: ${employee.displayName}`, resourceType: "attendance", resourceExternalId: row.externalId, capability: "office.attendance.edit", restaurantExternalId: row.restaurantExternalId })
      return row.externalId
    }
    const number = await nextNumber(ctx, { moduleId: "attendance", prefix: "ЯВ", organizationExternalId: restaurant.organizationExternalId, businessDate })
    const externalId = `attendance-${crypto.randomUUID()}`
    await ctx.db.insert("attendanceRecords", {
      externalId,
      number,
      employeeId: employee._id,
      employeeCode: employee.code,
      employeeName: employee.displayName,
      organizationExternalId: restaurant.organizationExternalId,
      restaurantExternalId: restaurant.externalId,
      businessDate,
      status: "draft",
      clockIn: args.clockIn,
      clockOut: args.clockOut,
      breakMinutes: args.breakMinutes,
      hours,
      attendanceType: args.attendanceType,
      source: "office",
      ...(reason ? { correctionReason: reason } : {}),
      version: 1,
      searchText: `${number} ${employee.displayName} ${employee.code}`.toLocaleLowerCase("ru"),
      createdAt: now,
      updatedAt: now,
    })
    await writeOfficeAudit(ctx, email, { action: "attendance.create", summary: `Новая запись явки ${number}: ${employee.displayName}`, resourceType: "attendance", resourceExternalId: externalId, capability: "office.attendance.edit", restaurantExternalId: restaurant.externalId })
    return externalId
  },
})

const TRANSITIONS = {
  submit: { from: ["draft"], to: "pending-approval", capability: "office.attendance.edit", label: "Отправлено на согласование" },
  approve: { from: ["pending-approval"], to: "approved", capability: "office.attendance.post", label: "Согласовано" },
  cancel: { from: ["draft", "pending-approval"], to: "cancelled", capability: "office.attendance.cancel", label: "Отменено" },
} as const

export const transition = mutation({
  args: { externalId: v.string(), action: v.union(v.literal("submit"), v.literal("approve"), v.literal("cancel")) },
  handler: async (ctx, args) => {
    const rule = TRANSITIONS[args.action]
    const { user } = await requireOfficeCapability(ctx, rule.capability)
    const email = (await getOfficeAuthEmail(ctx))!
    const row = await ctx.db.query("attendanceRecords").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!row) throw new ConvexError("Запись не найдена")
    await requireRestaurantScope(ctx, user, row.restaurantExternalId)
    if (!(rule.from as readonly string[]).includes(row.status)) throw new ConvexError("Действие недоступно для текущего статуса")
    if (args.action !== "cancel" && row.clockOut === undefined) throw new ConvexError("Укажите время ухода")
    await ctx.db.patch(row._id, { status: rule.to, version: row.version + 1, updatedAt: Date.now() })
    await writeOfficeAudit(ctx, email, { action: `attendance.${args.action}`, summary: `${rule.label}: явка ${row.number}, ${row.employeeName}`, resourceType: "attendance", resourceExternalId: row.externalId, capability: rule.capability, restaurantExternalId: row.restaurantExternalId })
  },
})
