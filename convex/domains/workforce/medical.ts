import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { internal } from "../../_generated/api"
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { insertAudit } from "../../lib/audit"
import { nextNumber } from "../../lib/numbering"
import { getOfficeAuthEmail, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"
import { maskValue } from "../../lib/pii"
import { almatyBusinessDate } from "../../lib/time"
import { notifyRestaurant } from "../pos/internal"

// «Медкнижки и анализы» (W3-HR-08): the document, its term and fitness for work — no diagnoses.
// draft → pending-approval → approved (cancel from any of them). The number and the comment are personal
// data: without office.employees.pii the number is masked and the comment hidden. Every day the job
// warns the restaurant's terminals before the end date and, by the setting, takes the admission away
// once an approved document runs out without a newer approved one of the same type.

type Row = Doc<"medicalRecords">
type Status = Row["status"]
const DATE = /^\d{4}-\d{2}-\d{2}$/
const STATUSES = ["draft", "pending-approval", "approved", "cancelled"] as const
const documentType = v.union(v.literal("medical-book"), v.literal("analysis"), v.literal("certificate"))
const TYPE_LABEL: Record<Row["documentType"], string> = { "medical-book": "Медицинская книжка", analysis: "Анализ", certificate: "Допуск" }
const MAX_WITHIN_DAYS = 365
const BATCH = 100

export const DEFAULT_MEDICAL_SETTINGS = { revokeAdmissionOnExpiry: true, notifyWithinDays: 7 }

const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
const ruDate = (date: string) => date.split("-").reverse().join(".")

function inScope(user: { restaurantScopes: string[] }, row: Row) {
  return user.restaurantScopes.includes("*") || user.restaurantScopes.includes(row.restaurantExternalId)
}

async function canSeePii(ctx: QueryCtx) {
  try {
    await requireOfficeCapability(ctx, "office.employees.pii")
    return true
  } catch {
    return false
  }
}

/** The number masked and the comment hidden without office.employees.pii (decision Г-2). */
function publicRecord(row: Row, pii: boolean) {
  const { searchText: _searchText, ...rest } = row
  return pii ? { ...rest, piiHidden: false } : { ...rest, documentNumber: maskValue(row.documentNumber, 2) ?? "", comment: undefined, piiHidden: true }
}

/** A newer approved document of the same type that is still valid on `today` replaces this one. */
async function renewed(ctx: QueryCtx, row: Row, today: string) {
  const later = await ctx.db.query("medicalRecords").withIndex("by_employee_type_expires", (q) => q.eq("employeeId", row.employeeId).eq("documentType", row.documentType).gt("expiresAt", row.expiresAt)).take(20)
  return later.some((other) => other.status === "approved" && other.expiresAt >= today && other.issuedAt <= today)
}

export const list = query({
  args: {
    status: v.optional(v.union(...STATUSES.map((status) => v.literal(status)))),
    restaurantExternalId: v.optional(v.string()),
    search: v.optional(v.string()),
    /** Approved documents ending within this many days from today (the banner's filter). */
    expiringWithinDays: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.medical-records.view")
    if (args.restaurantExternalId) await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const pii = await canSeePii(ctx)
    const needle = args.search?.trim().toLocaleLowerCase("ru")
    const restaurant = args.restaurantExternalId
    let page
    if (args.expiringWithinDays !== undefined) {
      const today = almatyBusinessDate(Date.now())
      const until = addDays(today, Math.min(MAX_WITHIN_DAYS, Math.max(0, Math.floor(args.expiringWithinDays))))
      page = restaurant
        ? await ctx.db.query("medicalRecords").withIndex("by_restaurant_status_expires", (q) => q.eq("restaurantExternalId", restaurant).eq("status", "approved").gte("expiresAt", today).lte("expiresAt", until)).paginate(args.paginationOpts)
        : await ctx.db.query("medicalRecords").withIndex("by_status_expires", (q) => q.eq("status", "approved").gte("expiresAt", today).lte("expiresAt", until)).paginate(args.paginationOpts)
    } else if (needle) {
      page = await ctx.db.query("medicalRecords").withSearchIndex("search_medical_records", (q) => {
        let scoped = q.search("searchText", needle)
        if (args.status) scoped = scoped.eq("status", args.status)
        if (restaurant) scoped = scoped.eq("restaurantExternalId", restaurant)
        return scoped
      }).paginate(args.paginationOpts)
    } else if (restaurant && args.status) {
      page = await ctx.db.query("medicalRecords").withIndex("by_restaurant_status_expires", (q) => q.eq("restaurantExternalId", restaurant).eq("status", args.status!)).order("desc").paginate(args.paginationOpts)
    } else if (restaurant) {
      page = await ctx.db.query("medicalRecords").withIndex("by_restaurant_expires", (q) => q.eq("restaurantExternalId", restaurant)).order("desc").paginate(args.paginationOpts)
    } else if (args.status) {
      page = await ctx.db.query("medicalRecords").withIndex("by_status_expires", (q) => q.eq("status", args.status!)).order("desc").paginate(args.paginationOpts)
    } else {
      page = await ctx.db.query("medicalRecords").withIndex("by_expires").order("desc").paginate(args.paginationOpts)
    }
    const shown = page.page.filter((row) => inScope(user, row) && (!args.status || row.status === args.status))
    return { ...page, page: shown.map((row) => publicRecord(row, pii)) }
  },
})

export const get = query({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.medical-records.view")
    const row = await ctx.db.query("medicalRecords").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!row || !inScope(user, row)) return null
    return publicRecord(row, await canSeePii(ctx))
  },
})

/**
 * Approved documents ending within `withinDays` (default 30) and those already ended without a
 * renewal, by the end-date index. A document renewed by a newer approved one is not counted.
 */
export const expiringMedicalRecords = query({
  args: { restaurantExternalId: v.optional(v.string()), withinDays: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.medical-records.view")
    if (args.restaurantExternalId) await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const withinDays = Math.min(MAX_WITHIN_DAYS, Math.max(0, Math.floor(args.withinDays ?? 30)))
    const today = almatyBusinessDate(Date.now())
    const until = addDays(today, withinDays)
    const restaurant = args.restaurantExternalId
    const soon = restaurant
      ? await ctx.db.query("medicalRecords").withIndex("by_restaurant_status_expires", (q) => q.eq("restaurantExternalId", restaurant).eq("status", "approved").gte("expiresAt", today).lte("expiresAt", until)).take(200)
      : await ctx.db.query("medicalRecords").withIndex("by_status_expires", (q) => q.eq("status", "approved").gte("expiresAt", today).lte("expiresAt", until)).take(200)
    const ended = restaurant
      ? await ctx.db.query("medicalRecords").withIndex("by_restaurant_status_expires", (q) => q.eq("restaurantExternalId", restaurant).eq("status", "approved").gte("expiresAt", addDays(today, -MAX_WITHIN_DAYS)).lt("expiresAt", today)).take(200)
      : await ctx.db.query("medicalRecords").withIndex("by_status_expires", (q) => q.eq("status", "approved").gte("expiresAt", addDays(today, -MAX_WITHIN_DAYS)).lt("expiresAt", today)).take(200)
    const pick = async (rows: Row[]) => {
      const out: Row[] = []
      for (const row of rows) if (inScope(user, row) && !(await renewed(ctx, row, today))) out.push(row)
      return out
    }
    const expiring = await pick(soon)
    const expired = await pick(ended)
    const brief = (row: Row) => ({ externalId: row.externalId, number: row.number, employeeName: row.employeeName, documentType: row.documentType, expiresAt: row.expiresAt, restaurantExternalId: row.restaurantExternalId })
    return { withinDays, today, count: expiring.length, expiredCount: expired.length, truncated: soon.length === 200 || ended.length === 200, rows: expiring.slice(0, 50).map(brief), expired: expired.slice(0, 50).map(brief) }
  },
})

type MedicalInput = { documentType: Row["documentType"]; issuedAt: string; expiresAt: string; issuer: string; documentNumber?: string; fitForWork: boolean; comment?: string }

/** The same rules as validateMedical in src/office/features/workforce/model/w3.ts (B:convex/workforce.ts:127-131). */
function checkMedical(input: MedicalInput, creating: boolean) {
  if (!DATE.test(input.issuedAt)) throw new ConvexError("Укажите дату выдачи")
  if (!DATE.test(input.expiresAt)) throw new ConvexError("Укажите срок действия")
  if (input.expiresAt <= input.issuedAt) throw new ConvexError("Срок действия должен быть позже даты выдачи")
  if (input.issuedAt > almatyBusinessDate(Date.now())) throw new ConvexError("Дата выдачи не может быть в будущем")
  if (input.issuer.trim().length < 2) throw new ConvexError("Укажите, кем выдан документ")
  if (creating && !input.documentNumber?.trim()) throw new ConvexError("Укажите номер документа")
  if ((input.documentNumber?.length ?? 0) > 60) throw new ConvexError("Номер документа — не длиннее 60 символов")
  if ((input.comment?.length ?? 0) > 500) throw new ConvexError("Комментарий — не длиннее 500 символов")
}

/**
 * Creates or edits a draft. On edit an omitted number or comment keeps the stored one — a user without
 * office.employees.pii never sees them, so never overwrites them with the mask.
 */
export const save = mutation({
  args: {
    externalId: v.optional(v.string()),
    expectedVersion: v.optional(v.number()),
    employeeId: v.id("employees"),
    restaurantExternalId: v.string(),
    documentType,
    issuedAt: v.string(),
    expiresAt: v.string(),
    issuer: v.string(),
    documentNumber: v.optional(v.string()),
    fitForWork: v.boolean(),
    comment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.medical-records.edit")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    checkMedical(args, !args.externalId)
    const employee = await ctx.db.get(args.employeeId)
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.restaurantExternalId)).unique()
    if (!employee || !restaurant || !employee.restaurantIds.includes(restaurant._id)) throw new ConvexError("Сотрудник не работает в этом ресторане")
    const now = Date.now()
    const base = { documentType: args.documentType, issuedAt: args.issuedAt, expiresAt: args.expiresAt, issuer: args.issuer.trim(), fitForWork: args.fitForWork }
    if (args.externalId) {
      const row = await ctx.db.query("medicalRecords").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId!)).unique()
      if (!row || !inScope(user, row) || row.restaurantExternalId !== args.restaurantExternalId) throw new ConvexError("Запись не найдена")
      if (row.employeeId !== employee._id) throw new ConvexError("Сотрудника записи менять нельзя")
      if (args.expectedVersion !== undefined && args.expectedVersion !== row.version) throw new ConvexError("Запись изменена другим пользователем — обновите страницу")
      if (row.status !== "draft") throw new ConvexError("Изменить можно только черновик")
      const comment = args.comment === undefined ? row.comment : args.comment.trim() || undefined
      await ctx.db.patch(row._id, {
        ...base,
        documentNumber: args.documentNumber?.trim() || row.documentNumber,
        comment,
        expiryProcessed: false,
        version: row.version + 1,
        updatedAt: now,
        searchText: `${row.number} ${row.employeeName} ${row.employeeCode} ${TYPE_LABEL[args.documentType]}`.toLocaleLowerCase("ru"),
      })
      await writeOfficeAudit(ctx, email, { action: "medical-records.update", summary: `Медкнижка ${row.number}: изменение (${row.employeeName})`, resourceType: "medical-records", resourceExternalId: row.externalId, restaurantExternalId: row.restaurantExternalId, capability: "office.medical-records.edit" })
      return row.externalId
    }
    const number = await nextNumber(ctx, { moduleId: "medical-records", prefix: "МК", organizationExternalId: restaurant.organizationExternalId, businessDate: args.issuedAt })
    const externalId = `medical-record-${crypto.randomUUID()}`
    await ctx.db.insert("medicalRecords", {
      ...base,
      externalId,
      number,
      employeeId: employee._id,
      employeeCode: employee.code,
      employeeName: employee.displayName,
      organizationExternalId: restaurant.organizationExternalId,
      restaurantExternalId: restaurant.externalId,
      status: "draft",
      documentNumber: args.documentNumber!.trim(),
      ...(args.comment?.trim() ? { comment: args.comment.trim() } : {}),
      expiryProcessed: false,
      version: 1,
      searchText: `${number} ${employee.displayName} ${employee.code} ${TYPE_LABEL[args.documentType]}`.toLocaleLowerCase("ru"),
      createdAt: now,
      updatedAt: now,
    })
    await writeOfficeAudit(ctx, email, { action: "medical-records.create", summary: `Медкнижка ${number}: ${TYPE_LABEL[args.documentType]}, ${employee.displayName}`, resourceType: "medical-records", resourceExternalId: externalId, restaurantExternalId: restaurant.externalId, capability: "office.medical-records.edit" })
    return externalId
  },
})

const TRANSITIONS: Record<"submit" | "approve" | "cancel", { from: Status[]; to: Status; capability: string; label: string }> = {
  submit: { from: ["draft"], to: "pending-approval", capability: "office.medical-records.edit", label: "отправлена на согласование" },
  approve: { from: ["pending-approval"], to: "approved", capability: "office.medical-records.approve", label: "согласована" },
  cancel: { from: ["draft", "pending-approval", "approved"], to: "cancelled", capability: "office.medical-records.cancel", label: "отменена" },
}

export const transition = mutation({
  args: { externalId: v.string(), action: v.union(v.literal("submit"), v.literal("approve"), v.literal("cancel")), expectedVersion: v.optional(v.number()), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const rule = TRANSITIONS[args.action]
    const { user } = await requireOfficeCapability(ctx, rule.capability)
    const email = (await getOfficeAuthEmail(ctx))!
    const row = await ctx.db.query("medicalRecords").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!row) throw new ConvexError("Запись не найдена")
    await requireRestaurantScope(ctx, user, row.restaurantExternalId)
    if (args.expectedVersion !== undefined && args.expectedVersion !== row.version) throw new ConvexError("Запись изменена другим пользователем — обновите страницу")
    if (!rule.from.includes(row.status)) throw new ConvexError("Действие недоступно для текущего статуса")
    const reason = args.reason?.trim()
    if (args.action === "cancel" && row.status === "approved" && (reason?.length ?? 0) < 3) throw new ConvexError("Укажите причину отмены")
    await ctx.db.patch(row._id, { status: rule.to, version: row.version + 1, updatedAt: Date.now() })
    await writeOfficeAudit(ctx, email, {
      action: `medical-records.${args.action}`,
      summary: `Медкнижка ${row.number} ${rule.label}: ${row.employeeName}${reason ? ` — ${reason}` : ""}`,
      resourceType: "medical-records",
      resourceExternalId: row.externalId,
      restaurantExternalId: row.restaurantExternalId,
      capability: rule.capability,
    })
  },
})

// ── Settings and the daily job ───────────────────────────────────────────────

async function settingsOf(ctx: QueryCtx) {
  const row = await ctx.db.query("workforceSettings").withIndex("by_key", (q) => q.eq("key", "medical-records")).unique()
  return row ? { revokeAdmissionOnExpiry: row.revokeAdmissionOnExpiry, notifyWithinDays: row.notifyWithinDays } : DEFAULT_MEDICAL_SETTINGS
}

export const settings = query({
  args: {},
  handler: async (ctx) => {
    await requireOfficeCapability(ctx, "office.medical-records.view")
    return settingsOf(ctx)
  },
})

export const saveSettings = mutation({
  args: { revokeAdmissionOnExpiry: v.boolean(), notifyWithinDays: v.number() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.medical-records.edit")
    // A network-wide setting: only for users of the whole network.
    if (!user.restaurantScopes.includes("*")) throw new ConvexError("Настройку меняет пользователь с доступом ко всем ресторанам")
    if (!(Number.isInteger(args.notifyWithinDays) && args.notifyWithinDays >= 0 && args.notifyWithinDays <= 60)) throw new ConvexError("Предупреждать — от 0 до 60 дней")
    const email = (await getOfficeAuthEmail(ctx))!
    const row = await ctx.db.query("workforceSettings").withIndex("by_key", (q) => q.eq("key", "medical-records")).unique()
    const value = { revokeAdmissionOnExpiry: args.revokeAdmissionOnExpiry, notifyWithinDays: args.notifyWithinDays, updatedBy: email, updatedAt: Date.now() }
    if (row) await ctx.db.patch(row._id, value)
    else await ctx.db.insert("workforceSettings", { key: "medical-records", ...value })
    await writeOfficeAudit(ctx, email, { action: "medical-records.settings", summary: `Медкнижки: ${args.revokeAdmissionOnExpiry ? "снимать" : "не снимать"} допуск по истечении, предупреждать за ${args.notifyWithinDays} дн.`, resourceType: "medical-records", resourceExternalId: "settings", capability: "office.medical-records.edit" })
  },
})

async function handleExpired(ctx: MutationCtx, row: Row, today: string, revoke: boolean) {
  await ctx.db.patch(row._id, { expiryProcessed: true })
  if (await renewed(ctx, row, today)) return false
  const employee = await ctx.db.get(row.employeeId)
  const revoked = Boolean(revoke && row.fitForWork && employee && employee.admitted !== false)
  if (revoked) await ctx.db.patch(employee!._id, { admitted: false, updatedAt: Date.now() })
  const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", row.restaurantExternalId)).unique()
  if (restaurant) {
    await notifyRestaurant(ctx, restaurant._id, {
      title: `Истёк срок: ${TYPE_LABEL[row.documentType].toLocaleLowerCase("ru")}`,
      message: `${row.employeeName}: документ ${row.number} действовал до ${ruDate(row.expiresAt)}.${revoked ? " Допуск к работе снят до продления." : ""}`,
      severity: "critical",
      dedupeKey: `medical-expired:${row.externalId}`,
    })
  }
  await insertAudit(ctx, {
    actorKey: "system:medical-expiry",
    action: "medical-records.expired",
    summary: `Истёк срок документа ${row.number}: ${row.employeeName}${revoked ? ", допуск снят" : ""}`,
    resourceType: "medical-records",
    resourceExternalId: row.externalId,
    organizationExternalId: row.organizationExternalId,
    restaurantExternalId: row.restaurantExternalId,
    details: { expiresAt: row.expiresAt, revoked },
  })
  return revoked
}

/**
 * Daily (crons.ts): approved documents that ended before today and are not renewed → a critical notice
 * on the restaurant's terminals and, with the setting on, `employees.admitted = false`; documents ending
 * within `notifyWithinDays` → a warning (once per document and terminal). Continues in batches.
 */
export const processMedicalExpiry = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ processed: number; revoked: number; warned: number }> => {
    const settings = await settingsOf(ctx)
    const today = almatyBusinessDate(Date.now())
    const ended = await ctx.db.query("medicalRecords").withIndex("by_status_processed_expires", (q) => q.eq("status", "approved").eq("expiryProcessed", false).lt("expiresAt", today)).take(BATCH)
    let revoked = 0
    for (const row of ended) if (await handleExpired(ctx, row, today, settings.revokeAdmissionOnExpiry)) revoked += 1
    let warned = 0
    if (settings.notifyWithinDays > 0) {
      const soon = await ctx.db.query("medicalRecords").withIndex("by_status_processed_expires", (q) => q.eq("status", "approved").eq("expiryProcessed", false).gte("expiresAt", today).lte("expiresAt", addDays(today, settings.notifyWithinDays))).take(BATCH)
      for (const row of soon) {
        if (await renewed(ctx, row, today)) continue
        const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", row.restaurantExternalId)).unique()
        if (!restaurant) continue
        await notifyRestaurant(ctx, restaurant._id, {
          title: `Скоро истекает: ${TYPE_LABEL[row.documentType].toLocaleLowerCase("ru")}`,
          message: `${row.employeeName}: документ ${row.number} действует до ${ruDate(row.expiresAt)}. Продлите его заранее.`,
          severity: "warning",
          dedupeKey: `medical-expiring:${row.externalId}`,
        })
        warned += 1
      }
    }
    if (ended.length === BATCH) await ctx.scheduler.runAfter(0, internal.domains.workforce.medical.processMedicalExpiry, {})
    return { processed: ended.length, revoked, warned }
  },
})
