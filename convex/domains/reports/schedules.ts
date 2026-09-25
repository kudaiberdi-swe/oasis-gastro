import { ConvexError, v } from "convex/values"

import { internal } from "../../_generated/api"
import { internalAction, internalMutation, internalQuery, mutation, query } from "../../_generated/server"
import type { Doc, Id } from "../../_generated/dataModel"
import { allowsCapability, getOfficeAuthEmail, hasNetworkScope, hasScope, requireOfficeCapability, scopedRestaurants, writeOfficeAudit } from "../../lib/officeAccess"
import { appendOutboxEvent } from "../../lib/outbox"
import { checkReportPeriod, reportConfig, type ReportResult } from "../../lib/reportConfig"
import { EXPORT_MIME, exportFileName, toCsv, toXlsx } from "../../lib/reportExport"
import { nextRunAt, parseTimeOfDay, periodFor } from "../../lib/reportSchedule"
import { findReport } from "./catalog"
import { REPORT_REGISTRY } from "./registry"

// Report mailings (W2-RPT-06). Every minute due schedules are dispatched once per slot (lastRunKey);
// the file is rendered as the owner with the owner's rights at run time, stored, and announced through
// the outbox. Sending by email/SMS waits for the messaging provider (W3): the status says so.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const cadence = v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly"))
const preset = v.union(v.literal("yesterday"), v.literal("last-7-days"), v.literal("last-month"), v.literal("month-to-date"))
const format = v.union(v.literal("xlsx"), v.literal("csv"), v.literal("pdf"))

async function requireSchedule(ctx: Parameters<typeof getOfficeAuthEmail>[0], externalId: string) {
  const row = await ctx.db.query("reportSchedules").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!row) throw new ConvexError("Рассылка не найдена")
  return row
}

/** Owner or a network user may change a schedule. */
async function ownSchedule(ctx: Parameters<typeof getOfficeAuthEmail>[0], user: Doc<"officeUsers">, externalId: string) {
  const schedule = await requireSchedule(ctx, externalId)
  if (schedule.ownerKey !== user.email && !hasNetworkScope(user)) throw new ConvexError("Рассылка не найдена")
  return schedule
}

export const listSchedules = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireOfficeCapability(ctx, "office.report-schedules.view")
    const rows = await ctx.db.query("reportSchedules").withIndex("by_owner", (q) => q.eq("ownerKey", user.email)).take(200)
    return Promise.all(rows.map(async (row) => ({ ...row, reportTitle: findReport(row.reportId)?.title ?? row.reportId, lastFileUrl: row.lastFileStorageId ? await ctx.storage.getUrl(row.lastFileStorageId) : null })))
  },
})

export const saveSchedule = mutation({
  args: {
    externalId: v.optional(v.string()),
    reportId: v.string(),
    viewExternalId: v.optional(v.string()),
    name: v.string(),
    recipients: v.array(v.string()),
    format,
    cadence,
    timeOfDay: v.string(),
    weekday: v.optional(v.number()),
    dayOfMonth: v.optional(v.number()),
    periodPreset: preset,
    config: reportConfig,
  },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.report-schedules.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const report = findReport(args.reportId)
    if (!report || !REPORT_REGISTRY[report.id]) throw new ConvexError("Рассылать можно только готовые отчёты")
    if (report.requiredCapability) await requireOfficeCapability(ctx, report.requiredCapability)
    const name = args.name.trim() || report.title
    const recipients = [...new Set(args.recipients.map((row) => row.trim().toLocaleLowerCase("en-US")).filter(Boolean))]
    if (!recipients.length || recipients.length > 20) throw new ConvexError("Укажите от 1 до 20 получателей")
    const invalid = recipients.find((row) => !EMAIL.test(row))
    if (invalid) throw new ConvexError(`Некорректный email: ${invalid}`)
    if (args.format === "pdf") throw new ConvexError("PDF появится вместе с шаблонами печати — выберите XLSX или CSV")
    if (parseTimeOfDay(args.timeOfDay) === null) throw new ConvexError("Время — ЧЧ:ММ")
    if (args.cadence === "weekly" && !(Number.isInteger(args.weekday) && args.weekday! >= 1 && args.weekday! <= 7)) throw new ConvexError("Выберите день недели")
    if (args.cadence === "monthly" && !(Number.isInteger(args.dayOfMonth) && args.dayOfMonth! >= 1 && args.dayOfMonth! <= 31)) throw new ConvexError("День месяца — от 1 до 31")
    for (const restaurant of args.config.restaurantExternalIds) if (!hasScope(user.restaurantScopes, restaurant)) throw new ConvexError("Нет доступа к ресторану")
    const existing = args.externalId ? await ownSchedule(ctx, user, args.externalId) : null
    const now = Date.now()
    const timing = { cadence: args.cadence, timeOfDay: args.timeOfDay, weekday: args.cadence === "weekly" ? args.weekday : undefined, dayOfMonth: args.cadence === "monthly" ? args.dayOfMonth : undefined }
    const value = { reportId: report.id, viewExternalId: args.viewExternalId, name, recipients, format: args.format, ...timing, periodPreset: args.periodPreset, config: args.config, nextRunAt: nextRunAt(timing, now), updatedAt: now }
    const externalId = existing?.externalId ?? `report-schedule-${crypto.randomUUID()}`
    if (existing) await ctx.db.patch(existing._id, value)
    else await ctx.db.insert("reportSchedules", { ...value, externalId, ownerKey: user.email, active: true, createdAt: now })
    await writeOfficeAudit(ctx, email, { action: "report-schedule.save", summary: `Рассылка «${name}»: ${report.title}, ${recipients.length} получателей`, resourceType: "report-schedules", resourceExternalId: externalId, capability: "office.report-schedules.edit" })
    return { externalId, nextRunAt: value.nextRunAt }
  },
})

export const setScheduleActive = mutation({
  args: { externalId: v.string(), active: v.boolean() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.report-schedules.edit")
    const schedule = await ownSchedule(ctx, user, args.externalId)
    const email = (await getOfficeAuthEmail(ctx))!
    const now = Date.now()
    await ctx.db.patch(schedule._id, { active: args.active, ...(args.active ? { nextRunAt: nextRunAt(schedule, now) } : {}), updatedAt: now })
    await writeOfficeAudit(ctx, email, { action: "report-schedule.active", summary: `Рассылка «${schedule.name}»: ${args.active ? "включена" : "отключена"}`, resourceType: "report-schedules", resourceExternalId: schedule.externalId, capability: "office.report-schedules.edit" })
  },
})

export const deleteSchedule = mutation({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.report-schedules.edit")
    const schedule = await ownSchedule(ctx, user, args.externalId)
    const email = (await getOfficeAuthEmail(ctx))!
    if (schedule.lastFileStorageId) await ctx.storage.delete(schedule.lastFileStorageId)
    await ctx.db.delete(schedule._id)
    await writeOfficeAudit(ctx, email, { action: "report-schedule.delete", summary: `Рассылка «${schedule.name}» удалена`, resourceType: "report-schedules", resourceExternalId: schedule.externalId, capability: "office.report-schedules.edit" })
  },
})

export const runScheduleNow = mutation({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.report-schedules.edit")
    const schedule = await ownSchedule(ctx, user, args.externalId)
    await ctx.scheduler.runAfter(0, internal.domains.reports.schedules.renderScheduledReport, { scheduleId: schedule._id, runAt: Date.now() })
    await ctx.db.patch(schedule._id, { lastStatus: "Формируется", lastState: "running", updatedAt: Date.now() })
  },
})

/** Cron, every minute: each due schedule once per slot; the next slot is the next calendar one. */
export const dispatchSchedules = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const due = await ctx.db.query("reportSchedules").withIndex("by_next_run", (q) => q.eq("active", true).lte("nextRunAt", now)).take(50)
    let dispatched = 0
    for (const schedule of due) {
      const runKey = `${schedule._id}:${schedule.nextRunAt}`
      const next = nextRunAt(schedule, Math.max(schedule.nextRunAt, now))
      if (schedule.lastRunKey === runKey) {
        await ctx.db.patch(schedule._id, { nextRunAt: next })
        continue
      }
      await ctx.db.patch(schedule._id, { lastRunKey: runKey, nextRunAt: next, lastStatus: "Формируется", lastState: "running", updatedAt: now })
      await ctx.scheduler.runAfter(0, internal.domains.reports.schedules.renderScheduledReport, { scheduleId: schedule._id, runAt: schedule.nextRunAt })
      dispatched += 1
    }
    return { dispatched }
  },
})

type Computed = { ok: true; schedule: Doc<"reportSchedules">; result: ReportResult; title: string; restaurants: string[]; dateFrom: string; dateTo: string } | { ok: false; status: string }

/** The report as the owner sees it at run time: an owner who lost the right gets «Нет доступа». */
export const computeScheduledReport = internalQuery({
  args: { scheduleId: v.id("reportSchedules"), runAt: v.number() },
  handler: async (ctx, args): Promise<Computed> => {
    const schedule = await ctx.db.get(args.scheduleId)
    if (!schedule) return { ok: false, status: "Рассылка удалена" }
    const user = await ctx.db.query("officeUsers").withIndex("by_email", (q) => q.eq("email", schedule.ownerKey)).unique()
    const role = user?.active ? await ctx.db.query("officeRoles").withIndex("by_external_id", (q) => q.eq("externalId", user.roleExternalId)).unique() : null
    const report = findReport(schedule.reportId)
    const entry = report ? REPORT_REGISTRY[report.id] : undefined
    if (!user || !role || !report || !entry) return { ok: false, status: "Нет доступа" }
    for (const capability of ["office.reports.view", "office.report-schedules.view", report.requiredCapability].filter(Boolean) as string[]) {
      if (!allowsCapability(role.capabilities, capability)) return { ok: false, status: "Нет доступа" }
    }
    if (schedule.config.restaurantExternalIds.some((restaurant) => !hasScope(user.restaurantScopes, restaurant))) return { ok: false, status: "Нет доступа" }
    const period = periodFor(schedule.periodPreset, args.runAt)
    const config = { ...schedule.config, ...period }
    checkReportPeriod(config)
    const scoped = await scopedRestaurants(ctx, user)
    const restaurants = config.restaurantExternalIds.length ? config.restaurantExternalIds : scoped.map((restaurant) => restaurant.externalId)
    const result = { reportId: report.id, generatedAt: Date.now(), ...(await entry.calculator(ctx, config, restaurants)) }
    const names = config.restaurantExternalIds.map((id) => scoped.find((restaurant) => restaurant.externalId === id)?.name ?? id)
    return { ok: true, schedule, result, title: schedule.name, restaurants: names, ...period }
  },
})

export const recordRun = internalMutation({
  args: { scheduleId: v.id("reportSchedules"), runAt: v.number(), status: v.string(), state: v.union(v.literal("ready"), v.literal("no-access"), v.literal("error")), storageId: v.optional(v.id("_storage")), fileName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.scheduleId)
    if (!schedule) {
      if (args.storageId) await ctx.storage.delete(args.storageId)
      return
    }
    if (args.storageId && schedule.lastFileStorageId) await ctx.storage.delete(schedule.lastFileStorageId)
    await ctx.db.patch(schedule._id, { lastRunAt: args.runAt, lastStatus: args.status, lastState: args.state, ...(args.storageId ? { lastFileStorageId: args.storageId, lastFileName: args.fileName } : {}), updatedAt: Date.now() })
    const owner = await ctx.db.query("officeUsers").withIndex("by_email", (q) => q.eq("email", schedule.ownerKey)).unique()
    const organization = owner?.organizationScopes?.find((id) => id !== "*") ?? (await ctx.db.query("organizations").first())?.externalId
    if (args.storageId && organization) {
      await appendOutboxEvent(ctx, { aggregateType: "report-schedule", aggregateExternalId: schedule.externalId, eventType: "report.scheduled.ready", organizationExternalId: organization, payload: { reportId: schedule.reportId, fileName: args.fileName, recipients: schedule.recipients.length, format: schedule.format } })
    }
  },
})

/** Renders the file (CSV/XLSX, the same module as the office download), stores it, records the run. */
export const renderScheduledReport = internalAction({
  args: { scheduleId: v.id("reportSchedules"), runAt: v.number() },
  handler: async (ctx, args) => {
    // Any failure — computing, rendering or storing — is recorded, so a run never stays «Формируется».
    try {
      const computed: Computed = await ctx.runQuery(internal.domains.reports.schedules.computeScheduledReport, args)
      if (!computed.ok) {
        await ctx.runMutation(internal.domains.reports.schedules.recordRun, { ...args, status: computed.status, state: computed.status === "Нет доступа" ? "no-access" : "error" })
        return
      }
      const meta = { title: computed.title, dateFrom: computed.dateFrom, dateTo: computed.dateTo, restaurants: computed.restaurants }
      const extension = computed.schedule.format === "csv" ? "csv" : "xlsx"
      const body: BlobPart = extension === "csv" ? toCsv(computed.result, meta) : (toXlsx(computed.result, meta).slice().buffer as ArrayBuffer)
      const storageId: Id<"_storage"> = await ctx.storage.store(new Blob([body], { type: EXPORT_MIME[extension] }))
      await ctx.runMutation(internal.domains.reports.schedules.recordRun, { ...args, status: "Готово · ожидает провайдера отправки", state: "ready", storageId, fileName: exportFileName(meta, extension) })
    } catch (error) {
      await ctx.runMutation(internal.domains.reports.schedules.recordRun, { ...args, status: `Ошибка: ${error instanceof Error ? error.message : "не удалось сформировать"}`, state: "error" })
    }
  },
})
