import { ConvexError, v } from "convex/values"

import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { journalReady, postJournalEntry, reverseJournalEntries } from "../../lib/ledger"
import { cancelObligations, createObligation } from "../../lib/obligations"
import { getOfficeAuthEmail, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"
import { assertPeriodOpen } from "../../lib/periods"
import { calculateKzPayroll, normalizeRules, RULE_KEYS, RULES_2026 } from "../../lib/payroll"

// «Зарплата» (W2-HR-06): KZ statutory rules by date, runs from approved / completed attendance plus
// adjustments, postings with employee withholdings and employer taxes as separate obligations (B-15),
// reversal of all of it, and payouts.

const DATE = /^\d{4}-\d{2}-\d{2}$/
const ruleFields = Object.fromEntries(RULE_KEYS.map((key) => [key, v.number()])) as Record<(typeof RULE_KEYS)[number], ReturnType<typeof v.number>>

async function ruleAt(ctx: QueryCtx, date: string) {
  const rules = await ctx.db.query("payrollRules").withIndex("by_status_effective", (q) => q.eq("status", "active").lte("effectiveFrom", date)).order("desc").first()
  if (!rules) throw new ConvexError(`Нет действующих правил расчёта на ${date} — активируйте версию правил РК`)
  return rules
}

export const listRules = query({
  args: {},
  handler: async (ctx) => {
    await requireOfficeCapability(ctx, "office.payroll.view")
    return ctx.db.query("payrollRules").withIndex("by_status_effective").order("desc").take(50)
  },
})

export const saveRules = mutation({
  args: { externalId: v.optional(v.string()), version: v.string(), effectiveFrom: v.string(), ...ruleFields },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.payroll.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    if (!DATE.test(args.effectiveFrom)) throw new ConvexError("Дата начала — ГГГГ-ММ-ДД")
    const { externalId: givenId, version, effectiveFrom, ...numbers } = args
    const rules = normalizeRules(numbers)
    const now = Date.now()
    let externalId = givenId
    if (externalId) {
      const existing = await ctx.db.query("payrollRules").withIndex("by_external_id", (q) => q.eq("externalId", externalId!)).unique()
      if (!existing) throw new ConvexError("Версия правил не найдена")
      if (existing.status !== "draft") throw new ConvexError("Изменить можно только черновик правил")
      await ctx.db.patch(existing._id, { version: version.trim(), effectiveFrom, ...rules, updatedAt: now })
    } else {
      externalId = `payroll-rules-${crypto.randomUUID()}`
      await ctx.db.insert("payrollRules", { externalId, version: version.trim(), effectiveFrom, status: "draft", ...rules, createdAt: now, updatedAt: now })
    }
    await writeOfficeAudit(ctx, email, { action: "payroll.rules.save", summary: `Правила РК ${version.trim()} с ${effectiveFrom}`, resourceType: "payroll-rules", resourceExternalId: externalId, capability: "office.payroll.edit" })
    return externalId
  },
})

export const activateRules = mutation({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.payroll.approve")
    const email = (await getOfficeAuthEmail(ctx))!
    const rules = await ctx.db.query("payrollRules").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!rules) throw new ConvexError("Версия правил не найдена")
    // One active version per start date; others keep applying to their own dates.
    for (const other of await ctx.db.query("payrollRules").withIndex("by_status_effective", (q) => q.eq("status", "active").eq("effectiveFrom", rules.effectiveFrom)).take(10)) {
      if (other._id !== rules._id) await ctx.db.patch(other._id, { status: "inactive", updatedAt: Date.now() })
    }
    await ctx.db.patch(rules._id, { status: "active", updatedAt: Date.now() })
    await writeOfficeAudit(ctx, email, { action: "payroll.rules.activate", summary: `Активированы правила РК ${rules.version} с ${rules.effectiveFrom}`, resourceType: "payroll-rules", resourceExternalId: rules.externalId, capability: "office.payroll.approve" })
  },
})

/** Seeds the 2026 rules as a draft (idempotent). */
export const seedRules2026 = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("payrollRules").withIndex("by_external_id", (q) => q.eq("externalId", "payroll-rules-kz-2026")).unique()
    if (existing) return { created: false }
    const now = Date.now()
    await ctx.db.insert("payrollRules", { externalId: "payroll-rules-kz-2026", version: "РК 2026", effectiveFrom: "2026-01-01", status: "draft", ...RULES_2026, createdAt: now, updatedAt: now })
    return { created: true }
  },
})

export const saveAdjustment = mutation({
  args: { restaurantExternalId: v.string(), employeeId: v.id("employees"), businessDate: v.string(), kind: v.union(v.literal("bonus"), v.literal("penalty"), v.literal("advance")), amount: v.number(), comment: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.payroll.edit")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    const employee = await ctx.db.get(args.employeeId)
    if (!employee) throw new ConvexError("Сотрудник не найден")
    if (!(Number.isInteger(args.amount) && args.amount > 0)) throw new ConvexError("Сумма — целое число тенге больше нуля")
    if (!DATE.test(args.businessDate)) throw new ConvexError("Дата — ГГГГ-ММ-ДД")
    if (args.comment.trim().length < 3) throw new ConvexError("Укажите основание")
    const externalId = `payroll-adjustment-${crypto.randomUUID()}`
    await ctx.db.insert("payrollAdjustments", { externalId, employeeId: employee._id, employeeCode: employee.code, restaurantExternalId: args.restaurantExternalId, businessDate: args.businessDate, kind: args.kind, amount: args.amount, comment: args.comment.trim(), createdBy: email, createdAt: Date.now() })
    await writeOfficeAudit(ctx, email, { action: "payroll.adjustment", summary: `${args.kind === "bonus" ? "Премия" : args.kind === "penalty" ? "Штраф" : "Аванс"} ${employee.displayName}: ${args.amount} ₸`, resourceType: "payroll-adjustment", resourceExternalId: externalId, restaurantExternalId: args.restaurantExternalId, capability: "office.payroll.edit" })
    return externalId
  },
})

async function taxableYtd(ctx: QueryCtx, restaurantExternalId: string, year: string, before: string) {
  const byEmployee = new Map<string, number>()
  const runs = await ctx.db.query("payrollRuns").withIndex("by_restaurant_to", (q) => q.eq("restaurantExternalId", restaurantExternalId).gte("to", `${year}-01-01`).lt("to", before)).take(50)
  for (const run of runs) if (run.status === "posted") for (const line of run.lines) byEmployee.set(line.employeeCode, (byEmployee.get(line.employeeCode) ?? 0) + line.taxable)
  return byEmployee
}

/** Calculates (or recalculates, while a draft) the run of a restaurant for a period. */
export const calculatePayroll = mutation({
  args: { restaurantExternalId: v.string(), from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.payroll.edit")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    if (!DATE.test(args.from) || !DATE.test(args.to) || args.from > args.to) throw new ConvexError("Укажите период")
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.restaurantExternalId)).unique()
    if (!restaurant) throw new ConvexError("Ресторан не найден")
    const rules = await ruleAt(ctx, args.to)
    const number = `PAY-${args.to.slice(0, 7)}-${restaurant.externalId}`
    const existing = await ctx.db.query("payrollRuns").withIndex("by_number", (q) => q.eq("number", number)).unique()
    if (existing && existing.status === "posted") throw new ConvexError("Ведомость за период уже проведена — сторнируйте её для перерасчёта")

    const hours = new Map<string, number>()
    for await (const record of ctx.db.query("attendanceRecords").withIndex("by_restaurant_date", (q) => q.eq("restaurantExternalId", restaurant.externalId).gte("businessDate", args.from).lte("businessDate", args.to))) {
      if ((record.status === "approved" || record.status === "completed") && record.attendanceType === "worked") hours.set(record.employeeCode, (hours.get(record.employeeCode) ?? 0) + (record.hours ?? 0))
    }
    const adjustments = await ctx.db.query("payrollAdjustments").withIndex("by_restaurant_date", (q) => q.eq("restaurantExternalId", restaurant.externalId).gte("businessDate", args.from).lte("businessDate", args.to)).take(200)
    const ytd = await taxableYtd(ctx, restaurant.externalId, args.to.slice(0, 4), args.from)
    const lines = []
    for await (const employee of ctx.db.query("employees").withIndex("by_role_name")) {
      if (!employee.active || !employee.restaurantIds.includes(restaurant._id)) continue
      const payType = employee.payType ?? "hourly"
      const rate = employee.baseRate ?? 0
      const worked = Math.round((hours.get(employee.code) ?? 0) * 100) / 100
      const own = adjustments.filter((row) => row.employeeId === employee._id && (!row.runExternalId || row.runExternalId === existing?.externalId))
      const bonuses = own.filter((row) => row.kind === "bonus").reduce((sum, row) => sum + row.amount, 0) - own.filter((row) => row.kind === "penalty").reduce((sum, row) => sum + row.amount, 0)
      const advances = own.filter((row) => row.kind === "advance").reduce((sum, row) => sum + row.amount, 0)
      const base = payType === "hourly" ? Math.round(worked * rate) : payType === "salary" ? rate : 0
      const gross = Math.max(0, base + bonuses)
      if (!gross && !worked) continue
      const taxes = calculateKzPayroll(gross, employee.applyBasicDeduction ?? true, rules, ytd.get(employee.code) ?? 0)
      lines.push({ employeeId: employee._id, employeeCode: employee.code, employeeName: employee.displayName, hours: worked, payType, rate, adjustments: bonuses, advances, gross, ...taxes })
    }
    const totals = {
      gross: lines.reduce((sum, line) => sum + line.gross, 0),
      employeeTaxes: lines.reduce((sum, line) => sum + line.employeeTaxes, 0),
      employerTaxes: lines.reduce((sum, line) => sum + line.employerTaxes, 0),
      net: lines.reduce((sum, line) => sum + line.net, 0),
      toPay: lines.reduce((sum, line) => sum + Math.max(0, line.net - line.advances), 0),
    }
    const now = Date.now()
    const value = { from: args.from, to: args.to, ruleExternalId: rules.externalId, ruleVersion: rules.version, lines, totals, updatedAt: now }
    let externalId: string
    if (existing) {
      externalId = existing.externalId
      await ctx.db.patch(existing._id, { ...value, status: "draft", version: existing.version + 1 })
    } else {
      externalId = `payroll-run-${crypto.randomUUID()}`
      await ctx.db.insert("payrollRuns", { ...value, externalId, number, restaurantExternalId: restaurant.externalId, organizationExternalId: restaurant.organizationExternalId, status: "draft", paidAmount: 0, version: 1, createdAt: now })
    }
    await writeOfficeAudit(ctx, email, { action: "payroll.calculate", summary: `Ведомость ${number}: ${lines.length} сотрудников, начислено ${totals.gross} ₸`, resourceType: "payroll-run", resourceExternalId: externalId, restaurantExternalId: restaurant.externalId, capability: "office.payroll.edit" })
    return { externalId, number, totals }
  },
})

export const listRuns = query({
  args: { restaurantExternalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.payroll.view")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const runs = await ctx.db.query("payrollRuns").withIndex("by_restaurant_to", (q) => q.eq("restaurantExternalId", args.restaurantExternalId)).order("desc").take(50)
    return runs.map(({ lines, ...run }) => ({ ...run, employeeCount: lines.length }))
  },
})

export const getRun = query({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.payroll.view")
    const run = await ctx.db.query("payrollRuns").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!run) return null
    await requireRestaurantScope(ctx, user, run.restaurantExternalId)
    const payouts = await ctx.db.query("payrollPayouts").withIndex("by_run", (q) => q.eq("runExternalId", run.externalId)).take(50)
    const entries = await ctx.db.query("journalEntries").withIndex("by_source", (q) => q.eq("sourceExternalId", run.externalId)).take(200)
    return { run, payouts, entries }
  },
})

const TAX_PARTS = ["ipn", "pension", "medical", "social-contribution", "social-tax"] as const

async function requireRun(ctx: MutationCtx, externalId: string) {
  const run = await ctx.db.query("payrollRuns").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!run) throw new ConvexError("Ведомость не найдена")
  return run
}

/** Posts the run: expenses, withholdings and employer taxes by kind, and the tax obligations due the 25th of next month. */
export const postPayroll = mutation({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.payroll.post")
    const email = (await getOfficeAuthEmail(ctx))!
    const run = await requireRun(ctx, args.externalId)
    await requireRestaurantScope(ctx, user, run.restaurantExternalId)
    if (run.status !== "draft") throw new ConvexError("Провести можно только черновик")
    if (!run.lines.length) throw new ConvexError("В ведомости нет строк")
    if (!(await journalReady(ctx))) throw new ConvexError("Сначала загрузите план счетов")
    await assertPeriodOpen(ctx, { organizationExternalId: run.organizationExternalId, restaurantExternalId: run.restaurantExternalId, businessDate: run.to, moduleId: "payroll" })
    const occurredAt = Date.parse(`${run.to}T12:00:00+05:00`)
    const post = (suffix: string, debit: string, credit: string, amount: number, description: string) =>
      amount > 0 ? postJournalEntry(ctx, { externalId: `${run.externalId}:${suffix}`, restaurantExternalId: run.restaurantExternalId, sourceModuleId: "payroll", sourceExternalId: run.externalId, sourceNumber: run.number, occurredAt, businessDate: run.to, debitAccount: debit, creditAccount: credit, amount, description }) : null
    const sums = { ipn: 0, pension: 0, medical: 0, "social-contribution": 0, "social-tax": 0 }
    for (const line of run.lines) {
      const key = line.employeeCode
      await post(`${key}:gross`, "staffExpense", "payroll", line.gross, `Начисление: ${line.employeeName}`)
      await post(`${key}:opv`, "payroll", "pensionContrib", line.opv, `ОПВ: ${line.employeeName}`)
      await post(`${key}:vosms`, "payroll", "medicalContrib", line.vosms, `ВОСМС: ${line.employeeName}`)
      await post(`${key}:ipn`, "payroll", "ipn", line.ipn, `ИПН: ${line.employeeName}`)
      await post(`${key}:opvr`, "employerTaxExpense", "pensionContrib", line.opvr, `ОПВР: ${line.employeeName}`)
      await post(`${key}:oosms`, "employerTaxExpense", "medicalContrib", line.oosms, `ООСМС: ${line.employeeName}`)
      await post(`${key}:so`, "employerTaxExpense", "socialContrib", line.socialContribution, `СО: ${line.employeeName}`)
      await post(`${key}:sn`, "employerTaxExpense", "socialTax", line.socialTax, `СН: ${line.employeeName}`)
      sums.ipn += line.ipn
      sums.pension += line.opv + line.opvr
      sums.medical += line.vosms + line.oosms
      sums["social-contribution"] += line.socialContribution
      sums["social-tax"] += line.socialTax
    }
    const next = new Date(Date.parse(`${run.to.slice(0, 7)}-01T00:00:00Z`))
    next.setUTCMonth(next.getUTCMonth() + 1)
    const dueDate = `${next.toISOString().slice(0, 7)}-25`
    const LABEL = { ipn: "ИПН", pension: "Пенсионные взносы (ОПВ, ОПВР)", medical: "ОСМС (ВОСМС, ООСМС)", "social-contribution": "Социальные отчисления", "social-tax": "Социальный налог" }
    for (const part of TAX_PARTS) {
      await createObligation(ctx, { restaurantExternalId: run.restaurantExternalId, direction: "payable", amount: sums[part], name: `${LABEL[part]} за ${run.to.slice(0, 7)}`, kind: "tax", sourceModuleId: "payroll", sourceExternalId: run.externalId, sourceNumber: run.number, part, dueDate, occurredAt })
    }
    await ctx.db.patch(run._id, { status: "posted", postedAt: Date.now(), version: run.version + 1, updatedAt: Date.now() })
    for (const adjustment of await ctx.db.query("payrollAdjustments").withIndex("by_restaurant_date", (q) => q.eq("restaurantExternalId", run.restaurantExternalId).gte("businessDate", run.from).lte("businessDate", run.to)).take(200)) {
      if (!adjustment.runExternalId) await ctx.db.patch(adjustment._id, { runExternalId: run.externalId })
    }
    await writeOfficeAudit(ctx, email, { action: "payroll.post", summary: `Проведена ведомость ${run.number}: начислено ${run.totals.gross} ₸`, resourceType: "payroll-run", resourceExternalId: run.externalId, restaurantExternalId: run.restaurantExternalId, capability: "office.payroll.post" })
  },
})

/** Reverses every posting of the run including employer taxes (B-15) and cancels its tax obligations. */
export const reversePayroll = mutation({
  args: { externalId: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.payroll.reverse")
    const email = (await getOfficeAuthEmail(ctx))!
    const run = await requireRun(ctx, args.externalId)
    await requireRestaurantScope(ctx, user, run.restaurantExternalId)
    if (run.status !== "posted") throw new ConvexError("Сторнировать можно только проведённую ведомость")
    if (run.paidAmount > 0) throw new ConvexError("По ведомости есть выплаты — сторно невозможно")
    if (args.reason.trim().length < 3) throw new ConvexError("Укажите причину")
    try {
      await cancelObligations(ctx, "payroll", run.externalId, [...TAX_PARTS])
    } catch {
      throw new ConvexError("Сначала сторнируйте платежи по налогам")
    }
    await reverseJournalEntries(ctx, { sourceExternalId: run.externalId, occurredAt: Date.now(), reversalKey: "reverse", description: `Сторно ведомости ${run.number}` })
    for (const adjustment of await ctx.db.query("payrollAdjustments").withIndex("by_restaurant_date", (q) => q.eq("restaurantExternalId", run.restaurantExternalId).gte("businessDate", run.from).lte("businessDate", run.to)).take(200)) {
      if (adjustment.runExternalId === run.externalId) await ctx.db.patch(adjustment._id, { runExternalId: undefined })
    }
    await ctx.db.patch(run._id, { status: "reversed", reversedAt: Date.now(), reverseReason: args.reason.trim(), version: run.version + 1, updatedAt: Date.now() })
    await writeOfficeAudit(ctx, email, { action: "payroll.reverse", summary: `Сторно ведомости ${run.number}: ${args.reason.trim()}`, resourceType: "payroll-run", resourceExternalId: run.externalId, restaurantExternalId: run.restaurantExternalId, capability: "office.payroll.reverse" })
  },
})

/** Pays out net salaries (all of what is left, or given lines): Dr payroll / Cr cash or bank. */
export const createPayout = mutation({
  args: { runExternalId: v.string(), method: v.union(v.literal("cash"), v.literal("bank")), lines: v.optional(v.array(v.object({ employeeCode: v.string(), amount: v.number() }))) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.payroll.post")
    const email = (await getOfficeAuthEmail(ctx))!
    const run = await requireRun(ctx, args.runExternalId)
    await requireRestaurantScope(ctx, user, run.restaurantExternalId)
    if (run.status !== "posted") throw new ConvexError("Выплачивать можно только по проведённой ведомости")
    const paid = new Map<string, number>()
    for (const payout of await ctx.db.query("payrollPayouts").withIndex("by_run", (q) => q.eq("runExternalId", run.externalId)).take(50)) for (const line of payout.lines) paid.set(line.employeeCode, (paid.get(line.employeeCode) ?? 0) + line.amount)
    const due = new Map(run.lines.map((line) => [line.employeeCode, Math.max(0, line.net - line.advances) - (paid.get(line.employeeCode) ?? 0)]))
    const lines = (args.lines ?? [...due.entries()].map(([employeeCode, amount]) => ({ employeeCode, amount }))).filter((line) => line.amount > 0)
    for (const line of lines) {
      if (!Number.isInteger(line.amount)) throw new ConvexError("Выплата — целое число тенге")
      if (line.amount > (due.get(line.employeeCode) ?? 0)) throw new ConvexError(`Сотруднику ${line.employeeCode} к выплате меньше`)
    }
    const amount = lines.reduce((sum, line) => sum + line.amount, 0)
    if (!amount) throw new ConvexError("Выплачивать нечего")
    const externalId = `payroll-payout-${crypto.randomUUID()}`
    await postJournalEntry(ctx, { externalId, restaurantExternalId: run.restaurantExternalId, sourceModuleId: "payroll", sourceExternalId: run.externalId, sourceNumber: run.number, occurredAt: Date.now(), debitAccount: "payroll", creditAccount: args.method === "cash" ? "cash" : "bank", amount, description: `Выплата зарплаты по ${run.number}` })
    await ctx.db.insert("payrollPayouts", { externalId, runExternalId: run.externalId, method: args.method, amount, lines, createdBy: email, createdAt: Date.now() })
    await ctx.db.patch(run._id, { paidAmount: run.paidAmount + amount, version: run.version + 1, updatedAt: Date.now() })
    await writeOfficeAudit(ctx, email, { action: "payroll.payout", summary: `Выплата по ${run.number}: ${amount} ₸ (${args.method === "cash" ? "касса" : "банк"})`, resourceType: "payroll-run", resourceExternalId: run.externalId, restaurantExternalId: run.restaurantExternalId, capability: "office.payroll.post" })
    return { amount, left: run.totals.toPay - run.paidAmount - amount }
  },
})
