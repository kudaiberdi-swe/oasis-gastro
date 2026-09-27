import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { mutation, query, type QueryCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { motivationResults } from "../../lib/motivation"
import { nextNumber } from "../../lib/numbering"
import { getOfficeAuthEmail, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"
import { assertPeriodOpen } from "../../lib/periods"
import { almatyBusinessDate } from "../../lib/time"

// «Мотивационные программы» (W3-HR-07): publish lifecycle (draft → published ⇄ inactive, published →
// expired), results per participant (lib/motivation.ts) and the accrual into payroll: one bonus
// adjustment per employee and program, taken by the next payroll run — never a posting of its own.

const DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_PERIOD_DAYS = 92
const MAX_PARTICIPANT_FILTERS = 100

const metric = v.union(v.literal("sales"), v.literal("average-check"), v.literal("kitchen-time"), v.literal("attendance"))
const rewardType = v.union(v.literal("fixed"), v.literal("percent"))
const STATUSES = ["draft", "published", "inactive", "expired"] as const
const EDITABLE: Doc<"motivationPrograms">["status"][] = ["draft", "inactive"]

const METRIC_LABEL: Record<Doc<"motivationPrograms">["metric"], string> = { sales: "Продажи", "average-check": "Средний чек", "kitchen-time": "Время кухни", attendance: "Дисциплина" }

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

function visible(user: { restaurantScopes: string[] }, row: Doc<"motivationPrograms">) {
  return user.restaurantScopes.includes("*") || user.restaurantScopes.includes(row.restaurantExternalId)
}

export const list = query({
  args: { status: v.optional(v.union(...STATUSES.map((status) => v.literal(status)))), restaurantExternalId: v.optional(v.string()), search: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.motivation.view")
    if (args.restaurantExternalId) await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const needle = args.search?.trim().toLocaleLowerCase("ru")
    const page = needle
      ? await ctx.db.query("motivationPrograms").withSearchIndex("search_motivation", (q) => {
          let scoped = q.search("searchText", needle)
          if (args.status) scoped = scoped.eq("status", args.status)
          if (args.restaurantExternalId) scoped = scoped.eq("restaurantExternalId", args.restaurantExternalId)
          return scoped
        }).paginate(args.paginationOpts)
      : args.restaurantExternalId
        ? await ctx.db.query("motivationPrograms").withIndex("by_restaurant_starts", (q) => q.eq("restaurantExternalId", args.restaurantExternalId!)).order("desc").paginate(args.paginationOpts)
        : args.status
          ? await ctx.db.query("motivationPrograms").withIndex("by_status_starts", (q) => q.eq("status", args.status!)).order("desc").paginate(args.paginationOpts)
          : await ctx.db.query("motivationPrograms").withIndex("by_status_starts").order("desc").paginate(args.paginationOpts)
    return { ...page, page: page.page.filter((row) => visible(user, row) && (!args.status || row.status === args.status)) }
  },
})

async function programOf(ctx: QueryCtx, user: { restaurantScopes: string[] }, externalId: string) {
  const row = await ctx.db.query("motivationPrograms").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  return row && visible(user, row) ? row : null
}

export const get = query({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.motivation.view")
    return programOf(ctx, user, args.externalId)
  },
})

type ProgramInput = {
  name: string
  metric: Doc<"motivationPrograms">["metric"]
  threshold: number
  rewardType: Doc<"motivationPrograms">["rewardType"]
  rewardValue: number
  startsAt: string
  endsAt: string
  participants: { positionExternalIds?: string[]; employeeCodes?: string[] }
}

/** The same rules as validateProgram in frontend/app/office/features/workforce/model/w3.ts. */
function checkProgram(input: ProgramInput) {
  if (input.name.trim().length < 2) throw new ConvexError("Укажите название программы")
  if (!DATE.test(input.startsAt) || !DATE.test(input.endsAt)) throw new ConvexError("Даты — ГГГГ-ММ-ДД")
  if (input.endsAt < input.startsAt) throw new ConvexError("Окончание не может быть раньше начала")
  if (daysBetween(input.startsAt, input.endsAt) >= MAX_PERIOD_DAYS) throw new ConvexError(`Период программы — не больше ${MAX_PERIOD_DAYS} дней`)
  if (!(Number.isFinite(input.threshold) && input.threshold >= 0)) throw new ConvexError("Порог — неотрицательное число")
  if (input.metric === "attendance" && input.threshold > 100) throw new ConvexError("Порог дисциплины — от 0 до 100 %")
  if ((input.metric === "sales" || input.metric === "average-check") && !Number.isInteger(input.threshold)) throw new ConvexError("Порог — целое число тенге")
  if (input.rewardType === "percent") {
    if (input.metric !== "sales") throw new ConvexError("Процент вознаграждения считается только от продаж — выберите фиксированную сумму")
    if (!(input.rewardValue > 0 && input.rewardValue <= 100)) throw new ConvexError("Процент — больше 0 и не больше 100")
  } else if (!(Number.isInteger(input.rewardValue) && input.rewardValue > 0)) throw new ConvexError("Вознаграждение — целое число тенге больше нуля")
  if ((input.participants.positionExternalIds?.length ?? 0) > MAX_PARTICIPANT_FILTERS || (input.participants.employeeCodes?.length ?? 0) > MAX_PARTICIPANT_FILTERS) throw new ConvexError("Слишком много участников в фильтре")
}

export const save = mutation({
  args: {
    externalId: v.optional(v.string()),
    expectedVersion: v.optional(v.number()),
    restaurantExternalId: v.string(),
    name: v.string(),
    metric,
    threshold: v.number(),
    rewardType,
    rewardValue: v.number(),
    startsAt: v.string(),
    endsAt: v.string(),
    requiresApproval: v.boolean(),
    participants: v.object({ positionExternalIds: v.optional(v.array(v.string())), employeeCodes: v.optional(v.array(v.string())) }),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.motivation.edit")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    checkProgram(args)
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.restaurantExternalId)).unique()
    if (!restaurant) throw new ConvexError("Ресторан не найден")
    const participants = {
      positionExternalIds: [...new Set((args.participants.positionExternalIds ?? []).map((id) => id.trim()).filter(Boolean))],
      employeeCodes: [...new Set((args.participants.employeeCodes ?? []).map((code) => code.trim()).filter(Boolean))],
    }
    const fields = {
      name: args.name.trim(),
      metric: args.metric,
      threshold: args.threshold,
      rewardType: args.rewardType,
      rewardValue: args.rewardValue,
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      requiresApproval: args.requiresApproval,
      participants,
    }
    const now = Date.now()
    if (args.externalId) {
      const row = await ctx.db.query("motivationPrograms").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId!)).unique()
      if (!row || !visible(user, row)) throw new ConvexError("Программа не найдена")
      if (row.restaurantExternalId !== args.restaurantExternalId) throw new ConvexError("Ресторан программы менять нельзя")
      if (args.expectedVersion !== undefined && args.expectedVersion !== row.version) throw new ConvexError("Запись изменена другим пользователем — обновите страницу")
      if (!EDITABLE.includes(row.status)) throw new ConvexError("Опубликованную или завершённую программу изменить нельзя — сначала отключите её")
      if (row.accruedAt) throw new ConvexError("По программе уже начислены премии — условия менять нельзя")
      await ctx.db.patch(row._id, { ...fields, version: row.version + 1, updatedAt: now, searchText: `${row.number} ${fields.name} ${METRIC_LABEL[fields.metric]}`.toLocaleLowerCase("ru") })
      await writeOfficeAudit(ctx, email, { action: "motivation.update", summary: `Мотивационная программа ${row.number}: изменение`, resourceType: "motivation", resourceExternalId: row.externalId, restaurantExternalId: row.restaurantExternalId, capability: "office.motivation.edit" })
      return row.externalId
    }
    const number = await nextNumber(ctx, { moduleId: "motivation", prefix: "МП", organizationExternalId: restaurant.organizationExternalId, businessDate: args.startsAt })
    const externalId = `motivation-${crypto.randomUUID()}`
    await ctx.db.insert("motivationPrograms", {
      ...fields,
      externalId,
      number,
      organizationExternalId: restaurant.organizationExternalId,
      restaurantExternalId: restaurant.externalId,
      status: "draft",
      version: 1,
      searchText: `${number} ${fields.name} ${METRIC_LABEL[fields.metric]}`.toLocaleLowerCase("ru"),
      createdAt: now,
      updatedAt: now,
    })
    await writeOfficeAudit(ctx, email, { action: "motivation.create", summary: `Мотивационная программа ${number}: создание`, resourceType: "motivation", resourceExternalId: externalId, restaurantExternalId: restaurant.externalId, capability: "office.motivation.edit" })
    return externalId
  },
})

const TRANSITIONS = {
  publish: { from: ["draft", "inactive"], to: "published", label: "опубликована" },
  deactivate: { from: ["published"], to: "inactive", label: "отключена" },
  expire: { from: ["published"], to: "expired", label: "завершена" },
} as const

export const transition = mutation({
  args: { externalId: v.string(), action: v.union(v.literal("publish"), v.literal("deactivate"), v.literal("expire")), expectedVersion: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.motivation.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const rule = TRANSITIONS[args.action]
    const row = await ctx.db.query("motivationPrograms").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!row) throw new ConvexError("Программа не найдена")
    await requireRestaurantScope(ctx, user, row.restaurantExternalId)
    if (args.expectedVersion !== undefined && args.expectedVersion !== row.version) throw new ConvexError("Запись изменена другим пользователем — обновите страницу")
    if (!(rule.from as readonly string[]).includes(row.status)) throw new ConvexError("Действие недоступно для текущего статуса")
    if (args.action === "publish") checkProgram(row)
    await ctx.db.patch(row._id, { status: rule.to, version: row.version + 1, updatedAt: Date.now() })
    await writeOfficeAudit(ctx, email, { action: `motivation.${args.action}`, summary: `Мотивационная программа ${row.number} ${rule.label}`, resourceType: "motivation", resourceExternalId: row.externalId, restaurantExternalId: row.restaurantExternalId, capability: "office.motivation.edit" })
  },
})

/** Where the program stands for accrual: before the end of the period nothing is accrued. */
function accrualState(row: Doc<"motivationPrograms">, today: string) {
  if (row.status !== "published" && row.status !== "expired") return { accruable: false, reason: "Начислять можно по опубликованной или завершённой программе" }
  if (row.endsAt >= today) return { accruable: false, reason: `Начисление — после окончания периода (${row.endsAt.split("-").reverse().join(".")})` }
  return { accruable: true, reason: null }
}

/** The fact, threshold and reward per participant (the «Результаты» tab). */
export const results = query({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.motivation.view")
    const row = await programOf(ctx, user, args.externalId)
    if (!row) return null
    const { rows, kitchenTruncated } = await motivationResults(ctx, row)
    const positions = new Map((await ctx.db.query("positions").take(200)).map((position) => [position.externalId, position.name]))
    return {
      rows: rows.map((result) => ({ ...result, positionName: result.positionExternalId ? positions.get(result.positionExternalId) ?? null : null })),
      totals: {
        participants: rows.length,
        fulfilled: rows.filter((result) => result.fulfilled).length,
        reward: rows.reduce((sum, result) => sum + result.reward, 0),
        accrued: rows.reduce((sum, result) => sum + (result.accrued ?? 0), 0),
      },
      kitchenTruncated,
      ...accrualState(row, almatyBusinessDate(Date.now())),
    }
  },
})

/**
 * Accrues the rewards of a finished period as payroll bonus adjustments (one per employee and program;
 * a repeat skips who already has one). Needs the payroll edit right; with «Требует утверждения» —
 * the program's approve right too. A period whose payroll run is already posted moves the bonus to today.
 */
export const accrue = mutation({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.payroll.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const row = await ctx.db.query("motivationPrograms").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!row) throw new ConvexError("Программа не найдена")
    await requireRestaurantScope(ctx, user, row.restaurantExternalId)
    await requireOfficeCapability(ctx, row.requiresApproval ? "office.motivation.approve" : "office.motivation.edit")
    const today = almatyBusinessDate(Date.now())
    const state = accrualState(row, today)
    if (!state.accruable) throw new ConvexError(state.reason!)

    const runs = await ctx.db.query("payrollRuns").withIndex("by_restaurant_to", (q) => q.eq("restaurantExternalId", row.restaurantExternalId).gte("to", row.endsAt)).take(50)
    const closed = runs.some((run) => run.status === "posted" && run.from <= row.endsAt)
    const businessDate = closed ? today : row.endsAt
    await assertPeriodOpen(ctx, { organizationExternalId: row.organizationExternalId, restaurantExternalId: row.restaurantExternalId, businessDate, moduleId: "payroll" })

    const { rows } = await motivationResults(ctx, row)
    let created = 0
    let skipped = 0
    let amount = 0
    const now = Date.now()
    for (const result of rows) {
      if (!result.fulfilled || result.reward <= 0) continue
      if (result.accrued !== null) {
        skipped += 1
        continue
      }
      await ctx.db.insert("payrollAdjustments", {
        externalId: `payroll-adjustment-${crypto.randomUUID()}`,
        employeeId: result.employeeId,
        employeeCode: result.employeeCode,
        restaurantExternalId: row.restaurantExternalId,
        businessDate,
        kind: "bonus",
        amount: result.reward,
        comment: `Мотивация ${row.number} «${row.name}»${closed ? ` за ${row.startsAt}…${row.endsAt}` : ""}`,
        sourceExternalId: row.externalId,
        createdBy: email,
        createdAt: now,
      })
      created += 1
      amount += result.reward
    }
    if (created) await ctx.db.patch(row._id, { accruedAmount: (row.accruedAmount ?? 0) + amount, accruedAt: now, version: row.version + 1, updatedAt: now })
    await writeOfficeAudit(ctx, email, {
      action: "motivation.accrue",
      summary: `Мотивационная программа ${row.number}: начислено премий ${created} на ${amount} ₸`,
      resourceType: "motivation",
      resourceExternalId: row.externalId,
      restaurantExternalId: row.restaurantExternalId,
      capability: "office.payroll.edit",
      details: { created, skipped, amount, businessDate },
    })
    return { created, skipped, amount, businessDate }
  },
})
