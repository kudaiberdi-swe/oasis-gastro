import { ConvexError, v } from "convex/values"

import { mutation, query } from "../../_generated/server"
import { getOfficeAuthEmail, requireOfficeCapability, writeOfficeAudit } from "../../lib/officeAccess"

// «Должности» (W2-HR-02) and «Типы смен» (W2-HR-03): network-wide references.

const payType = v.union(v.literal("hourly"), v.literal("salary"), v.literal("piecework"))
const posRole = v.union(v.literal("cashier"), v.literal("manager"), v.literal("administrator"), v.literal("kitchen"))
const time = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`

export const listPositions = query({
  args: { status: v.optional(v.union(v.literal("active"), v.literal("inactive"))) },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.positions.view")
    const positions = await ctx.db.query("positions").take(200)
    const counts = new Map<string, number>()
    for await (const employee of ctx.db.query("employees").withIndex("by_role_name")) {
      if (employee.active && employee.positionExternalId) counts.set(employee.positionExternalId, (counts.get(employee.positionExternalId) ?? 0) + 1)
    }
    return positions
      .filter((row) => !args.status || row.active === (args.status === "active"))
      .map((row) => ({ ...row, employeeCount: counts.get(row.externalId) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
  },
})

export const savePosition = mutation({
  args: { externalId: v.optional(v.string()), expectedVersion: v.optional(v.number()), code: v.string(), name: v.string(), departmentExternalId: v.optional(v.string()), payType, defaultRate: v.number(), weeklyHours: v.number(), posRole: v.optional(posRole), description: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.positions.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const code = args.code.trim()
    const name = args.name.trim()
    if (!code || !name) throw new ConvexError("Укажите код и название")
    if (!(Number.isInteger(args.defaultRate) && args.defaultRate >= 0)) throw new ConvexError("Ставка — целое число тенге")
    if (!(args.weeklyHours > 0 && args.weeklyHours <= 84)) throw new ConvexError("Норма часов в неделю — от 1 до 84")
    const all = await ctx.db.query("positions").take(200)
    if (all.some((row) => row.code === code && row.externalId !== args.externalId)) throw new ConvexError("Код должности уже занят")
    const now = Date.now()
    const value = { code, name, departmentExternalId: args.departmentExternalId, payType: args.payType, defaultRate: args.defaultRate, weeklyHours: args.weeklyHours, posRole: args.posRole, description: args.description?.trim() || undefined, updatedAt: now }
    let externalId = args.externalId
    if (externalId) {
      const existing = all.find((row) => row.externalId === externalId)
      if (!existing) throw new ConvexError("Должность не найдена")
      if (args.expectedVersion !== undefined && existing.version !== args.expectedVersion) throw new ConvexError("Должность изменил другой пользователь — обновите страницу")
      await ctx.db.patch(existing._id, { ...value, version: existing.version + 1 })
    } else {
      externalId = `position-${crypto.randomUUID()}`
      await ctx.db.insert("positions", { ...value, externalId, active: true, version: 1, createdAt: now })
    }
    await writeOfficeAudit(ctx, email, { action: "position.save", summary: `Должность «${name}»`, resourceType: "position", resourceExternalId: externalId, capability: "office.positions.edit" })
    return externalId
  },
})

export const setPositionActive = mutation({
  args: { externalId: v.string(), active: v.boolean() },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.positions.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const position = await ctx.db.query("positions").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!position) throw new ConvexError("Должность не найдена")
    if (!args.active) {
      for await (const employee of ctx.db.query("employees").withIndex("by_role_name")) {
        if (employee.active && employee.positionExternalId === position.externalId) throw new ConvexError("На должности есть активные сотрудники")
      }
    }
    await ctx.db.patch(position._id, { active: args.active, version: position.version + 1, updatedAt: Date.now() })
    await writeOfficeAudit(ctx, email, { action: "position.status", summary: `Должность «${position.name}»: ${args.active ? "включена" : "отключена"}`, resourceType: "position", resourceExternalId: position.externalId, capability: "office.positions.edit" })
  },
})

export const listShiftTypes = query({
  args: { status: v.optional(v.union(v.literal("active"), v.literal("inactive"))) },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.shift-types.view")
    const rows = await ctx.db.query("shiftTypes").take(200)
    return rows
      .filter((row) => !args.status || row.active === (args.status === "active"))
      .map((row) => {
        const minutes = (row.endMinute - row.startMinute + 1440) % 1440 || 1440
        return { ...row, timeLabel: `${time(row.startMinute)}–${time(row.endMinute)}`, hours: Math.round(((minutes - row.breakMinutes) / 60) * 100) / 100 }
      })
      .sort((a, b) => a.startMinute - b.startMinute)
  },
})

export const saveShiftType = mutation({
  args: { externalId: v.optional(v.string()), expectedVersion: v.optional(v.number()), code: v.string(), name: v.string(), startMinute: v.number(), endMinute: v.number(), breakMinutes: v.number(), nightCoefficient: v.number(), holidayCoefficient: v.number(), colorToken: v.string() },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.shift-types.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const code = args.code.trim()
    const name = args.name.trim()
    if (!code || !name) throw new ConvexError("Укажите код и название")
    for (const minute of [args.startMinute, args.endMinute]) if (!(Number.isInteger(minute) && minute >= 0 && minute <= 1439)) throw new ConvexError("Время — от 00:00 до 23:59")
    if (args.startMinute === args.endMinute) throw new ConvexError("Начало и окончание смены совпадают")
    const length = (args.endMinute - args.startMinute + 1440) % 1440
    if (!(Number.isInteger(args.breakMinutes) && args.breakMinutes >= 0 && args.breakMinutes < length)) throw new ConvexError("Перерыв должен быть короче смены")
    if (!(args.nightCoefficient >= 1 && args.holidayCoefficient >= 1)) throw new ConvexError("Коэффициенты — не меньше 1")
    if (!/^[a-z][a-z0-9-]*$/.test(args.colorToken)) throw new ConvexError("Цвет — имя токена дизайна")
    const all = await ctx.db.query("shiftTypes").take(200)
    if (all.some((row) => row.code === code && row.externalId !== args.externalId)) throw new ConvexError("Код типа смены уже занят")
    const now = Date.now()
    const value = { code, name, startMinute: args.startMinute, endMinute: args.endMinute, breakMinutes: args.breakMinutes, nightCoefficient: args.nightCoefficient, holidayCoefficient: args.holidayCoefficient, colorToken: args.colorToken, updatedAt: now }
    let externalId = args.externalId
    if (externalId) {
      const existing = all.find((row) => row.externalId === externalId)
      if (!existing) throw new ConvexError("Тип смены не найден")
      if (args.expectedVersion !== undefined && existing.version !== args.expectedVersion) throw new ConvexError("Тип смены изменил другой пользователь — обновите страницу")
      await ctx.db.patch(existing._id, { ...value, version: existing.version + 1 })
    } else {
      externalId = `shift-type-${crypto.randomUUID()}`
      await ctx.db.insert("shiftTypes", { ...value, externalId, active: true, version: 1, createdAt: now })
    }
    await writeOfficeAudit(ctx, email, { action: "shift-type.save", summary: `Тип смены «${name}» ${time(args.startMinute)}–${time(args.endMinute)}`, resourceType: "shift-type", resourceExternalId: externalId, capability: "office.shift-types.edit" })
    return externalId
  },
})

export const setShiftTypeActive = mutation({
  args: { externalId: v.string(), active: v.boolean() },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.shift-types.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const row = await ctx.db.query("shiftTypes").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!row) throw new ConvexError("Тип смены не найден")
    await ctx.db.patch(row._id, { active: args.active, version: row.version + 1, updatedAt: Date.now() })
    await writeOfficeAudit(ctx, email, { action: "shift-type.status", summary: `Тип смены «${row.name}»: ${args.active ? "включён" : "отключён"}`, resourceType: "shift-type", resourceExternalId: row.externalId, capability: "office.shift-types.edit" })
  },
})
