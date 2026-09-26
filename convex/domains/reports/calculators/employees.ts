import type { Doc, Id } from "../../../_generated/dataModel"
import { motivationResults } from "../../../lib/motivation"
import type { ReportConfig } from "../../../lib/reportConfig"
import { addDays, expiringAndExpired, MAX_WITHIN_DAYS, publicRecord, renewed, TYPE_LABEL as MEDICAL_TYPE } from "../../workforce/medical"
import type { Calculator } from "../registry"
import { facts, matcher, percentOf } from "./_facts"
import { canSeeEmployeePii } from "./_scope"
import { aggregate, ALMATY_OFFSET_MS, col } from "./_shared"
import { newBudget, spend, type Budget } from "./stockHelpers"

// Employee reports of W2 (docs/IMPLEMENTATION-PLAN.md W2-RPT-07). A report is listed here only with a
// test (tests/convex/reportsEmployees.test.ts). The catalog marks payroll reports with
// `requiredCapability: "office.payroll.view"`, which queries.execute checks on top of office.reports.view.

/**
 * employees-02: payroll summary — the lines of the payroll runs whose period ends in the report period,
 * summed per employee: gross, withholdings (ОПВ, ВОСМС, ИПН), advances, to pay and employer
 * contributions (СО, СН, ООСМС, ОПВР). Posted runs only; `extra.includeDrafts` adds the drafts,
 * reversed runs never count.
 */
const payrollSummary: Calculator = async (ctx, config, restaurants) => {
  const includeDrafts = config.extra?.includeDrafts === true
  const matches = matcher(config)
  const columns = [
    col("group", "Сотрудник", "text"), col("code", "Табельный №", "text"), col("hours", "Часов", "hours"),
    col("gross", "Начислено", "money"), col("opv", "ОПВ", "money"), col("vosms", "ВОСМС", "money"), col("ipn", "ИПН", "money"), col("withheld", "Удержано", "money"),
    col("advances", "Авансы", "money"), col("toPay", "К выплате", "money"),
    col("socialContribution", "СО", "money"), col("socialTax", "СН", "money"), col("oosms", "ООСМС", "money"), col("opvr", "ОПВР", "money"), col("employerTaxes", "Взносы работодателя", "money"),
  ]
  const rows = []
  let runs = 0
  let drafts = 0
  let truncated = false
  for (const restaurant of restaurants) {
    const inPeriod = await ctx.db.query("payrollRuns").withIndex("by_restaurant_to", (q) => q.eq("restaurantExternalId", restaurant).gte("to", config.dateFrom).lte("to", config.dateTo)).take(100)
    if (inPeriod.length === 100) truncated = true
    for (const run of inPeriod) {
      if (run.status === "reversed" || (run.status === "draft" && !includeDrafts)) continue
      runs += 1
      if (run.status === "draft") drafts += 1
      for (const line of run.lines) {
        if (!matches(line.employeeName, line.employeeCode)) continue
        rows.push({
          key: line.employeeCode,
          label: line.employeeName,
          text: { code: line.employeeCode },
          values: {
            hours: line.hours, gross: line.gross, opv: line.opv, vosms: line.vosms, ipn: line.ipn, withheld: line.employeeTaxes,
            advances: line.advances, toPay: Math.max(0, line.net - line.advances),
            socialContribution: line.socialContribution, socialTax: line.socialTax, oosms: line.oosms, opvr: line.opvr, employerTaxes: line.employerTaxes,
          },
        })
      }
    }
  }
  const result = aggregate(rows, columns, "gross")
  return {
    sourceLabel: includeDrafts ? `Расчётные ведомости (проведённые и черновики: ${drafts})` : "Проведённые расчётные ведомости",
    columns,
    ...result,
    kpis: [
      { key: "gross", label: "Начислено", value: result.totals.gross ?? 0, unit: "money" },
      { key: "toPay", label: "К выплате", value: result.totals.toPay ?? 0, unit: "money" },
      { key: "employerTaxes", label: "Взносы работодателя", value: result.totals.employerTaxes ?? 0, unit: "money" },
      { key: "runs", label: "Ведомостей", value: runs, unit: "count" },
    ],
    truncated,
  }
}

// ── W3-RPT-01: the other employee reports ──────────────────────────────────────
// Sources: attendanceRecords (by_restaurant_date), published scheduleEntries (by_restaurant_date),
// posted payrollRuns (by_restaurant_to), payrollAdjustments (by_restaurant_date), payrollPayouts
// (by_run) and the employee sales facts. Every employee key is the employee code — the one key the
// attendance, the schedule, the payroll lines and the sales facts share. The IIN is never output.
// employees-13/14/15 read the W3-HR-07/08 tables (motivationPrograms, medicalRecords) through the
// calculations of lib/motivation.ts and domains/workforce/medical.ts, never a copy of them.

type QueryCtx = Parameters<Calculator>[0]
type Attendance = Doc<"attendanceRecords">
type Schedule = Doc<"scheduleEntries">
type Row = { key: string; label: string; values: Record<string, number>; text?: Record<string, string> }

/** Attendance that counts as worked time, as in the timesheet (employees-03). */
const COUNTED = new Set<Attendance["status"]>(["approved", "completed"])
const ATTENDANCE_STATUS: Record<Attendance["status"], string> = { active: "На смене", completed: "Завершена", draft: "Черновик", "pending-approval": "На согласовании", approved: "Согласована", cancelled: "Отменена" }
const ATTENDANCE_TYPE: Record<Attendance["attendanceType"], string> = { worked: "Работа", sick: "Больничный", vacation: "Отпуск", absence: "Прогул" }
const ATTENDANCE_SOURCE: Record<Attendance["source"], string> = { pos: "Касса", "pos-shift": "Смена кассы", office: "Офис" }
const ADJUSTMENT_KIND: Record<Doc<"payrollAdjustments">["kind"], string> = { bonus: "Премия", penalty: "Штраф", advance: "Аванс" }
const PAY_TYPE: Record<string, string> = { hourly: "Почасовая", salary: "Оклад", piecework: "Сдельная" }

const text = (key: string, label: string) => col(key, label, "text")
const clock = (at: number | undefined) => (at === undefined ? "" : new Date(at + ALMATY_OFFSET_MS).toISOString().slice(11, 16))
const minutesBetween = (from: number, to: number) => Math.max(0, Math.round((to - from) / 60_000))
const hours2 = (value: number) => Math.round(value * 100) / 100
const extraCode = (config: ReportConfig) => (typeof config.extra?.employeeCode === "string" && config.extra.employeeCode.trim() ? config.extra.employeeCode.trim() : undefined)

async function attendanceIn(ctx: QueryCtx, restaurants: string[], config: ReportConfig, budget: Budget) {
  const rows: Attendance[] = []
  for (const restaurant of restaurants) {
    for await (const record of ctx.db.query("attendanceRecords").withIndex("by_restaurant_date", (q) => q.eq("restaurantExternalId", restaurant).gte("businessDate", config.dateFrom).lte("businessDate", config.dateTo))) {
      if (!spend(budget)) return rows
      rows.push(record)
    }
  }
  return rows
}

async function publishedSchedule(ctx: QueryCtx, restaurants: string[], config: ReportConfig, budget: Budget) {
  const rows: Schedule[] = []
  for (const restaurant of restaurants) {
    for await (const entry of ctx.db.query("scheduleEntries").withIndex("by_restaurant_date", (q) => q.eq("restaurantExternalId", restaurant).gte("businessDate", config.dateFrom).lte("businessDate", config.dateTo))) {
      if (!spend(budget)) return rows
      if (entry.status === "published") rows.push(entry)
    }
  }
  return rows
}

/** Posted payroll runs whose period ends in the report period (drafts and reversals never count). */
async function postedRuns(ctx: QueryCtx, restaurants: string[], config: ReportConfig) {
  const runs: Doc<"payrollRuns">[] = []
  let truncated = false
  for (const restaurant of restaurants) {
    const inPeriod = await ctx.db.query("payrollRuns").withIndex("by_restaurant_to", (q) => q.eq("restaurantExternalId", restaurant).gte("to", config.dateFrom).lte("to", config.dateTo)).take(100)
    if (inPeriod.length === 100) truncated = true
    runs.push(...inPeriod.filter((run) => run.status === "posted"))
  }
  return { runs, truncated }
}

async function adjustmentsIn(ctx: QueryCtx, restaurants: string[], config: ReportConfig, budget: Budget) {
  const rows: Doc<"payrollAdjustments">[] = []
  for (const restaurant of restaurants) {
    for await (const row of ctx.db.query("payrollAdjustments").withIndex("by_restaurant_date", (q) => q.eq("restaurantExternalId", restaurant).gte("businessDate", config.dateFrom).lte("businessDate", config.dateTo))) {
      if (!spend(budget)) return rows
      rows.push(row)
    }
  }
  return rows
}

/** Employees by id (adjustments carry only the code), memoized. */
function employeeById(ctx: QueryCtx) {
  const cache = new Map<string, Doc<"employees"> | null>()
  return async (id: Id<"employees">) => {
    if (!cache.has(id)) cache.set(id, await ctx.db.get(id))
    return cache.get(id) ?? null
  }
}

/**
 * Late arrivals and early leaves: each worked attendance against the published schedule entry of the
 * same employee and business date with the nearest start (the entry carries its shift type's times).
 */
export function matchSchedule(attendance: Attendance[], schedule: Schedule[]) {
  const byDay = new Map<string, Schedule[]>()
  for (const entry of schedule) {
    const key = `${entry.employeeId}|${entry.businessDate}`
    byDay.set(key, [...(byDay.get(key) ?? []), entry])
  }
  const matched = new Set<string>()
  const pairs: { record: Attendance; entry: Schedule | null; lateMinutes: number; earlyMinutes: number }[] = []
  for (const record of attendance) {
    if (record.status === "cancelled" || record.attendanceType !== "worked") continue
    const candidates = (byDay.get(`${record.employeeId}|${record.businessDate}`) ?? []).filter((entry) => !matched.has(entry._id))
    const entry = candidates.sort((a, b) => Math.abs(a.start - record.clockIn) - Math.abs(b.start - record.clockIn))[0] ?? null
    if (entry) matched.add(entry._id)
    pairs.push({ record, entry, lateMinutes: entry ? minutesBetween(entry.start, record.clockIn) : 0, earlyMinutes: entry && record.clockOut !== undefined ? minutesBetween(record.clockOut, entry.end) : 0 })
  }
  return { pairs, unmatched: schedule.filter((entry) => !matched.has(entry._id)) }
}

/** employees-01: one card per employee — shifts, hours, lateness, sales and payroll of the period. */
const personalReport: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const matches = matcher(config)
  const only = extraCode(config)
  const attendance = await attendanceIn(ctx, restaurants, config, budget)
  const schedule = await publishedSchedule(ctx, restaurants, config, budget)
  const { rows: sales, truncated: salesTruncated } = await facts(ctx, "employee", config, restaurants)
  const { runs, truncated: runsTruncated } = await postedRuns(ctx, restaurants, config)
  const adjustments = await adjustmentsIn(ctx, restaurants, config, budget)
  const employee = employeeById(ctx)
  const columns = [
    text("group", "Сотрудник"), text("code", "Табельный №"), text("position", "Должность"), col("shifts", "Смен", "count"), col("hours", "Часов", "hours"), col("late", "Опозданий", "count"),
    col("orders", "Заказов", "count"), col("revenue", "Выручка", "money"), col("averageCheck", "Средний чек", "money"),
    col("gross", "Начислено", "money"), col("bonuses", "Премии", "money"), col("penalties", "Штрафы", "money"), col("toPay", "К выплате", "money"),
  ]
  const rows: Row[] = []
  const keep = (code: string, name: string) => (!only || code === only) && matches(name, code)
  const { pairs } = matchSchedule(attendance.filter((record) => COUNTED.has(record.status)), schedule)
  for (const { record, lateMinutes } of pairs) {
    if (keep(record.employeeCode, record.employeeName)) rows.push({ key: record.employeeCode, label: record.employeeName, text: { code: record.employeeCode }, values: { shifts: 1, hours: record.hours ?? 0, late: lateMinutes > 0 ? 1 : 0 } })
  }
  for (const fact of sales) {
    if (keep(fact.dimensionKey, fact.dimensionLabel)) rows.push({ key: fact.dimensionKey, label: fact.dimensionLabel, text: { code: fact.dimensionKey }, values: { orders: fact.orderCount, revenue: fact.netAmount } })
  }
  for (const run of runs) {
    for (const line of run.lines) {
      if (keep(line.employeeCode, line.employeeName)) rows.push({ key: line.employeeCode, label: line.employeeName, text: { code: line.employeeCode }, values: { gross: line.gross, toPay: Math.max(0, line.net - line.advances) } })
    }
  }
  for (const adjustment of adjustments) {
    if (adjustment.kind === "advance") continue
    const name = (await employee(adjustment.employeeId))?.displayName ?? adjustment.employeeCode
    if (keep(adjustment.employeeCode, name)) rows.push({ key: adjustment.employeeCode, label: name, text: { code: adjustment.employeeCode }, values: adjustment.kind === "bonus" ? { bonuses: adjustment.amount } : { penalties: adjustment.amount } })
  }
  const result = aggregate(rows, columns, "hours")
  const positions = new Map<string, string>()
  for (const row of result.rows) {
    row.cells.averageCheck = Number(row.cells.orders) ? Math.round(Number(row.cells.revenue) / Number(row.cells.orders)) : 0
    const positionId = (await ctx.db.query("employees").withIndex("by_code", (q) => q.eq("code", row.key)).first())?.positionExternalId
    if (positionId && !positions.has(positionId)) positions.set(positionId, (await ctx.db.query("positions").withIndex("by_external_id", (q) => q.eq("externalId", positionId)).unique())?.name ?? "")
    row.cells.position = positionId ? (positions.get(positionId) ?? "") : ""
  }
  delete result.totals.averageCheck
  result.rows.sort((a, b) => String(a.cells.group).localeCompare(String(b.cells.group), "ru"))
  return {
    sourceLabel: "Явка, график, продажи кассы и проведённые ведомости за период",
    columns,
    ...result,
    kpis: [
      { key: "employees", label: "Сотрудников", value: result.rows.length, unit: "count" },
      { key: "hours", label: "Часов", value: hours2(result.totals.hours ?? 0), unit: "hours" },
      { key: "revenue", label: "Выручка", value: result.totals.revenue ?? 0, unit: "money" },
      { key: "gross", label: "Начислено", value: result.totals.gross ?? 0, unit: "money" },
    ],
    truncated: budget.truncated || salesTruncated || runsTruncated,
  }
}

/** employees-04: the published schedule against the attendance — planned and worked hours per employee. */
const schedulePlanFact: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const matches = matcher(config)
  const attendance = await attendanceIn(ctx, restaurants, config, budget)
  const schedule = await publishedSchedule(ctx, restaurants, config, budget)
  const columns = [
    text("group", "Сотрудник"), col("plannedShifts", "Смен по графику", "count"), col("plannedHours", "План, ч", "hours"), col("workedShifts", "Отработано смен", "count"), col("workedHours", "Факт, ч", "hours"),
    col("deviationHours", "Отклонение, ч", "hours"), col("missed", "Пропущено смен", "count"), col("unscheduled", "Вне графика", "count"), col("absences", "Отсутствий", "count"),
  ]
  const rows: Row[] = []
  const worked = attendance.filter((record) => COUNTED.has(record.status) && record.attendanceType === "worked")
  const { pairs, unmatched } = matchSchedule(worked, schedule)
  for (const entry of schedule) if (matches(entry.employeeName, entry.employeeCode)) rows.push({ key: entry.employeeCode, label: entry.employeeName, values: { plannedShifts: 1, plannedHours: entry.plannedHours } })
  for (const { record, entry } of pairs) if (matches(record.employeeName, record.employeeCode)) rows.push({ key: record.employeeCode, label: record.employeeName, values: { workedShifts: 1, workedHours: record.hours ?? 0, unscheduled: entry ? 0 : 1 } })
  // A scheduled day spent on sick leave or vacation is an absence, not a missed shift.
  const away = attendance.filter((record) => record.status !== "cancelled" && record.attendanceType !== "worked")
  const excused = new Set(away.map((record) => `${record.employeeId}|${record.businessDate}`))
  for (const record of away) if (matches(record.employeeName, record.employeeCode)) rows.push({ key: record.employeeCode, label: record.employeeName, values: { absences: 1 } })
  for (const entry of unmatched) if (!excused.has(`${entry.employeeId}|${entry.businessDate}`) && matches(entry.employeeName, entry.employeeCode)) rows.push({ key: entry.employeeCode, label: entry.employeeName, values: { missed: 1 } })
  const result = aggregate(rows, columns, "plannedHours")
  for (const row of result.rows) row.cells.deviationHours = hours2(Number(row.cells.workedHours) - Number(row.cells.plannedHours))
  result.totals.deviationHours = hours2((result.totals.workedHours ?? 0) - (result.totals.plannedHours ?? 0))
  return {
    sourceLabel: "Опубликованный график против согласованной и завершённой явки",
    columns,
    ...result,
    kpis: [
      { key: "planned", label: "План, ч", value: hours2(result.totals.plannedHours ?? 0), unit: "hours" },
      { key: "worked", label: "Факт, ч", value: hours2(result.totals.workedHours ?? 0), unit: "hours" },
      { key: "execution", label: "Исполнение графика", value: percentOf(result.totals.workedHours ?? 0, result.totals.plannedHours ?? 0), unit: "percent" },
      { key: "missed", label: "Пропущено смен", value: result.totals.missed ?? 0, unit: "count" },
    ],
    truncated: budget.truncated,
  }
}

/** employees-05: the attendance journal — one row per record of the period, every status. */
const attendanceJournal: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const matches = matcher(config)
  const attendance = await attendanceIn(ctx, restaurants, config, budget)
  const columns = [col("date", "Дата", "date"), text("number", "Номер"), text("group", "Сотрудник"), text("clockIn", "Приход"), text("clockOut", "Уход"), col("breakMinutes", "Перерыв", "minutes"), col("hours", "Часов", "hours"), text("type", "Вид"), text("status", "Статус"), text("source", "Источник")]
  const rows = attendance
    .filter((record) => matches(record.employeeName, record.employeeCode, record.number))
    .sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.clockIn - b.clockIn)
    .map((record) => ({
      key: record.externalId,
      cells: {
        date: record.businessDate, number: record.number, group: record.employeeName, clockIn: clock(record.clockIn), clockOut: clock(record.clockOut), breakMinutes: record.breakMinutes,
        hours: COUNTED.has(record.status) ? (record.hours ?? 0) : 0, type: ATTENDANCE_TYPE[record.attendanceType], status: ATTENDANCE_STATUS[record.status], source: ATTENDANCE_SOURCE[record.source],
      },
    }))
  const hours = hours2(rows.reduce((sum, row) => sum + Number(row.cells.hours), 0))
  return {
    sourceLabel: "Журнал явки (часы — только согласованные и завершённые отметки)",
    columns,
    rows,
    totals: { hours },
    kpis: [
      { key: "records", label: "Отметок", value: rows.length, unit: "count" },
      { key: "open", label: "На смене", value: attendance.filter((record) => record.status === "active").length, unit: "count" },
      { key: "pending", label: "На согласовании", value: attendance.filter((record) => record.status === "pending-approval").length, unit: "count" },
      { key: "hours", label: "Часов", value: hours, unit: "hours" },
    ],
    truncated: budget.truncated,
  }
}

/** employees-06: late arrivals and early leaves in minutes against the published schedule. */
const lateness: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const matches = matcher(config)
  const attendance = await attendanceIn(ctx, restaurants, config, budget)
  const schedule = await publishedSchedule(ctx, restaurants, config, budget)
  const shiftTypes = new Map<string, string>()
  const shiftName = async (entry: Schedule) => {
    const hours = `${clock(entry.start)}–${clock(entry.end)}`
    const id = entry.shiftTypeExternalId
    if (!id) return hours
    if (!shiftTypes.has(id)) shiftTypes.set(id, (await ctx.db.query("shiftTypes").withIndex("by_external_id", (q) => q.eq("externalId", id)).unique())?.name ?? "")
    return shiftTypes.get(id) ? `${shiftTypes.get(id)} ${hours}` : hours
  }
  const columns = [col("date", "Дата", "date"), text("group", "Сотрудник"), text("shift", "Смена"), text("clockIn", "Приход"), col("lateMinutes", "Опоздание", "minutes"), text("clockOut", "Уход"), col("earlyMinutes", "Ранний уход", "minutes")]
  const { pairs } = matchSchedule(attendance, schedule)
  const rows = []
  for (const { record, entry, lateMinutes, earlyMinutes } of pairs) {
    if (!entry || (lateMinutes === 0 && earlyMinutes === 0) || !matches(record.employeeName, record.employeeCode)) continue
    rows.push({ key: record.externalId, cells: { date: record.businessDate, group: record.employeeName, shift: await shiftName(entry), clockIn: clock(record.clockIn), lateMinutes, clockOut: clock(record.clockOut), earlyMinutes } })
  }
  rows.sort((a, b) => String(a.cells.date).localeCompare(String(b.cells.date)) || String(a.cells.group).localeCompare(String(b.cells.group), "ru"))
  const late = rows.filter((row) => Number(row.cells.lateMinutes) > 0)
  const early = rows.filter((row) => Number(row.cells.earlyMinutes) > 0)
  const totals = { lateMinutes: late.reduce((sum, row) => sum + Number(row.cells.lateMinutes), 0), earlyMinutes: early.reduce((sum, row) => sum + Number(row.cells.earlyMinutes), 0) }
  return {
    sourceLabel: "Отметки явки против опубликованного графика (время смены — по типу смены)",
    columns,
    rows,
    totals,
    kpis: [
      { key: "late", label: "Опозданий", value: late.length, unit: "count" },
      { key: "lateMinutes", label: "Минут опозданий", value: totals.lateMinutes, unit: "minutes" },
      { key: "early", label: "Ранних уходов", value: early.length, unit: "count" },
      { key: "earlyMinutes", label: "Минут ранних уходов", value: totals.earlyMinutes, unit: "minutes" },
    ],
    truncated: budget.truncated,
  }
}

/** employees-07: accruals of the posted payroll runs — base pay, bonuses minus penalties, gross. */
const accruals: Calculator = async (ctx, config, restaurants) => {
  const matches = matcher(config)
  const { runs, truncated } = await postedRuns(ctx, restaurants, config)
  const columns = [text("group", "Сотрудник"), text("code", "Табельный №"), text("payType", "Оплата"), col("hours", "Часов", "hours"), col("base", "Оклад / по часам", "money"), col("adjustments", "Премии − штрафы", "money"), col("gross", "Начислено", "money")]
  const rows: Row[] = []
  for (const run of runs) {
    for (const line of run.lines) {
      if (matches(line.employeeName, line.employeeCode)) rows.push({ key: line.employeeCode, label: line.employeeName, text: { code: line.employeeCode, payType: PAY_TYPE[line.payType] ?? line.payType }, values: { hours: line.hours, base: line.gross - line.adjustments, adjustments: line.adjustments, gross: line.gross } })
    }
  }
  const result = aggregate(rows, columns, "gross")
  return {
    sourceLabel: "Проведённые расчётные ведомости",
    columns,
    ...result,
    kpis: [
      { key: "gross", label: "Начислено", value: result.totals.gross ?? 0, unit: "money" },
      { key: "base", label: "Оклад / по часам", value: result.totals.base ?? 0, unit: "money" },
      { key: "adjustments", label: "Премии − штрафы", value: result.totals.adjustments ?? 0, unit: "money" },
      { key: "runs", label: "Ведомостей", value: runs.length, unit: "count" },
    ],
    truncated,
  }
}

/** employees-08: withholdings — ОПВ, ВОСМС, ИПН and the advances held back from the pay. */
const withholdings: Calculator = async (ctx, config, restaurants) => {
  const matches = matcher(config)
  const { runs, truncated } = await postedRuns(ctx, restaurants, config)
  const columns = [text("group", "Сотрудник"), text("code", "Табельный №"), col("gross", "Начислено", "money"), col("opv", "ОПВ", "money"), col("vosms", "ВОСМС", "money"), col("ipn", "ИПН", "money"), col("taxes", "Налоги и взносы", "money"), col("advances", "Авансы", "money"), col("withheld", "Всего удержано", "money"), col("toPay", "К выплате", "money")]
  const rows: Row[] = []
  for (const run of runs) {
    for (const line of run.lines) {
      if (matches(line.employeeName, line.employeeCode)) rows.push({ key: line.employeeCode, label: line.employeeName, text: { code: line.employeeCode }, values: { gross: line.gross, opv: line.opv, vosms: line.vosms, ipn: line.ipn, taxes: line.employeeTaxes, advances: line.advances, withheld: line.employeeTaxes + line.advances, toPay: Math.max(0, line.net - line.advances) } })
    }
  }
  const result = aggregate(rows, columns, "withheld")
  return {
    sourceLabel: "Проведённые расчётные ведомости",
    columns,
    ...result,
    kpis: [
      { key: "taxes", label: "Налоги и взносы", value: result.totals.taxes ?? 0, unit: "money" },
      { key: "advances", label: "Авансы", value: result.totals.advances ?? 0, unit: "money" },
      { key: "withheld", label: "Всего удержано", value: result.totals.withheld ?? 0, unit: "money" },
    ],
    truncated,
  }
}

/** employees-09: advances given in the period and the payouts of the posted runs, by method. */
const advancesAndPayouts: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const matches = matcher(config)
  const { runs, truncated } = await postedRuns(ctx, restaurants, config)
  const adjustments = await adjustmentsIn(ctx, restaurants, config, budget)
  const employee = employeeById(ctx)
  const columns = [text("group", "Сотрудник"), text("code", "Табельный №"), col("advances", "Авансы выданы", "money"), col("toPay", "К выплате по ведомостям", "money"), col("paidCash", "Выплачено наличными", "money"), col("paidBank", "Выплачено на карту", "money"), col("paid", "Выплачено всего", "money"), col("due", "Остаток к выплате", "money")]
  const rows: Row[] = []
  for (const adjustment of adjustments) {
    if (adjustment.kind !== "advance") continue
    const name = (await employee(adjustment.employeeId))?.displayName ?? adjustment.employeeCode
    if (matches(name, adjustment.employeeCode)) rows.push({ key: adjustment.employeeCode, label: name, text: { code: adjustment.employeeCode }, values: { advances: adjustment.amount } })
  }
  for (const run of runs) {
    const names = new Map(run.lines.map((line) => [line.employeeCode, line.employeeName]))
    for (const line of run.lines) {
      if (matches(line.employeeName, line.employeeCode)) rows.push({ key: line.employeeCode, label: line.employeeName, text: { code: line.employeeCode }, values: { toPay: Math.max(0, line.net - line.advances) } })
    }
    for (const payout of await ctx.db.query("payrollPayouts").withIndex("by_run", (q) => q.eq("runExternalId", run.externalId)).take(100)) {
      for (const line of payout.lines) {
        const name = names.get(line.employeeCode) ?? line.employeeCode
        if (matches(name, line.employeeCode)) rows.push({ key: line.employeeCode, label: name, text: { code: line.employeeCode }, values: payout.method === "cash" ? { paidCash: line.amount, paid: line.amount } : { paidBank: line.amount, paid: line.amount } })
      }
    }
  }
  const result = aggregate(rows, columns, "toPay")
  for (const row of result.rows) row.cells.due = Math.max(0, Number(row.cells.toPay) - Number(row.cells.paid))
  result.totals.due = result.rows.reduce((sum, row) => sum + Number(row.cells.due), 0)
  return {
    sourceLabel: "Авансы периода и выплаты по проведённым ведомостям",
    columns,
    ...result,
    kpis: [
      { key: "advances", label: "Авансы выданы", value: result.totals.advances ?? 0, unit: "money" },
      { key: "paid", label: "Выплачено", value: result.totals.paid ?? 0, unit: "money" },
      { key: "due", label: "Остаток к выплате", value: result.totals.due, unit: "money" },
    ],
    truncated: truncated || budget.truncated,
  }
}

/** employees-10: bonuses and penalties of the period, one row per adjustment. */
const bonusesAndPenalties: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const matches = matcher(config)
  const employee = employeeById(ctx)
  const columns = [col("date", "Дата", "date"), text("group", "Сотрудник"), text("kind", "Вид"), col("bonus", "Премия", "money"), col("penalty", "Штраф", "money"), text("comment", "Основание"), text("run", "В ведомости")]
  const rows = []
  for (const adjustment of await adjustmentsIn(ctx, restaurants, config, budget)) {
    if (adjustment.kind === "advance") continue
    const name = (await employee(adjustment.employeeId))?.displayName ?? adjustment.employeeCode
    if (!matches(name, adjustment.employeeCode, adjustment.comment)) continue
    rows.push({ key: adjustment.externalId, cells: { date: adjustment.businessDate, group: name, kind: ADJUSTMENT_KIND[adjustment.kind], bonus: adjustment.kind === "bonus" ? adjustment.amount : 0, penalty: adjustment.kind === "penalty" ? adjustment.amount : 0, comment: adjustment.comment, run: adjustment.runExternalId ? "Да" : "Нет" } })
  }
  rows.sort((a, b) => String(a.cells.date).localeCompare(String(b.cells.date)) || String(a.cells.group).localeCompare(String(b.cells.group), "ru"))
  const totals = { bonus: rows.reduce((sum, row) => sum + Number(row.cells.bonus), 0), penalty: rows.reduce((sum, row) => sum + Number(row.cells.penalty), 0) }
  return {
    sourceLabel: "Корректировки зарплаты (премии и штрафы)",
    columns,
    rows,
    totals,
    kpis: [
      { key: "bonus", label: "Премии", value: totals.bonus, unit: "money" },
      { key: "penalty", label: "Штрафы", value: totals.penalty, unit: "money" },
      { key: "net", label: "Итого к начислению", value: totals.bonus - totals.penalty, unit: "money" },
    ],
    truncated: budget.truncated,
  }
}

/** employees-11: revenue and checks per worked hour (attendance hours × the employee sales facts). */
const efficiency: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const matches = matcher(config)
  const attendance = await attendanceIn(ctx, restaurants, config, budget)
  const { rows: sales, truncated } = await facts(ctx, "employee", config, restaurants)
  const columns = [text("group", "Сотрудник"), col("hours", "Часов", "hours"), col("orders", "Заказов", "count"), col("revenue", "Выручка", "money"), col("revenuePerHour", "Выручка в час", "money"), col("ordersPerHour", "Чеков в час", "quantity"), col("averageCheck", "Средний чек", "money")]
  const rows: Row[] = []
  for (const record of attendance) if (COUNTED.has(record.status) && record.attendanceType === "worked" && matches(record.employeeName, record.employeeCode)) rows.push({ key: record.employeeCode, label: record.employeeName, values: { hours: record.hours ?? 0 } })
  for (const fact of sales) if (matches(fact.dimensionLabel, fact.dimensionKey)) rows.push({ key: fact.dimensionKey, label: fact.dimensionLabel, values: { orders: fact.orderCount, revenue: fact.netAmount } })
  const result = aggregate(rows, columns)
  const rate = (value: number, hours: number, digits = 0) => (hours > 0 ? Math.round((value / hours) * 10 ** digits) / 10 ** digits : 0)
  for (const row of result.rows) {
    const hours = Number(row.cells.hours)
    row.cells.revenuePerHour = rate(Number(row.cells.revenue), hours)
    row.cells.ordersPerHour = rate(Number(row.cells.orders), hours, 2)
    row.cells.averageCheck = Number(row.cells.orders) ? Math.round(Number(row.cells.revenue) / Number(row.cells.orders)) : 0
  }
  result.rows.sort((a, b) => Number(b.cells.revenuePerHour) - Number(a.cells.revenuePerHour))
  for (const key of ["revenuePerHour", "ordersPerHour", "averageCheck"]) delete result.totals[key]
  const hours = result.totals.hours ?? 0
  return {
    sourceLabel: "Часы явки и продажи кассы по сотрудникам (предагрегат за день)",
    columns,
    ...result,
    kpis: [
      { key: "revenuePerHour", label: "Выручка в час", value: rate(result.totals.revenue ?? 0, hours), unit: "money" },
      { key: "ordersPerHour", label: "Чеков в час", value: rate(result.totals.orders ?? 0, hours, 2), unit: "quantity" },
      { key: "hours", label: "Часов", value: hours2(hours), unit: "hours" },
    ],
    truncated: truncated || budget.truncated,
  }
}

/** employees-12: sales by employee from the facts of the restaurants in the user's scope only (B-23). */
const salesByEmployee: Calculator = async (ctx, config, restaurants) => {
  const matches = matcher(config)
  const { rows: sales, truncated } = await facts(ctx, "employee", config, restaurants)
  const columns = [text("group", "Сотрудник"), text("code", "Табельный №"), col("orders", "Заказов", "count"), col("guests", "Гостей", "count"), col("revenue", "Выручка", "money"), col("discounts", "Скидки", "money"), col("averageCheck", "Средний чек", "money"), col("share", "Доля выручки, %", "percent")]
  const rows: Row[] = []
  for (const fact of sales) if (matches(fact.dimensionLabel, fact.dimensionKey)) rows.push({ key: fact.dimensionKey, label: fact.dimensionLabel, text: { code: fact.dimensionKey }, values: { orders: fact.orderCount, guests: fact.guestCount, revenue: fact.netAmount, discounts: fact.discountAmount } })
  const result = aggregate(rows, columns, "revenue")
  const total = result.totals.revenue ?? 0
  for (const row of result.rows) {
    row.cells.averageCheck = Number(row.cells.orders) ? Math.round(Number(row.cells.revenue) / Number(row.cells.orders)) : 0
    row.cells.share = percentOf(Number(row.cells.revenue), total)
  }
  delete result.totals.averageCheck
  delete result.totals.share
  return {
    sourceLabel: "Продажи кассы по сотрудникам (предагрегат за день)",
    columns,
    ...result,
    kpis: [
      { key: "revenue", label: "Выручка", value: total, unit: "money" },
      { key: "orders", label: "Заказов", value: result.totals.orders ?? 0, unit: "count" },
      { key: "averageCheck", label: "Средний чек", value: result.totals.orders ? Math.round(total / result.totals.orders) : 0, unit: "money" },
      { key: "employees", label: "Сотрудников", value: result.rows.length, unit: "count" },
    ],
    truncated,
  }
}

// ── employees-13…15: motivation and medical records (W3-HR-07/08) ───────────────────────────────

type Program = Doc<"motivationPrograms">
type Medical = Doc<"medicalRecords">
const METRIC_LABEL: Record<Program["metric"], string> = { sales: "Продажи", "average-check": "Средний чек", "kitchen-time": "Время кухни", attendance: "Дисциплина" }
const PROGRAM_STATUS: Record<Program["status"], string> = { draft: "Черновик", published: "Опубликована", inactive: "Отключена", expired: "Завершена" }
const MEDICAL_STATUS: Record<Medical["status"], string> = { draft: "Черновик", "pending-approval": "На согласовании", approved: "Согласована", cancelled: "Отменена" }
const PROGRAMS_PER_RESTAURANT = 100
const ruDate = (date: string) => date.split("-").reverse().join(".")
const grouped = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ")
const daysFrom = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/** A fact or a threshold in its metric's unit: ₸, minutes or % of shifts on time. */
function metricText(metric: Program["metric"], value: number | null) {
  if (value === null) return "Нет данных"
  if (metric === "kitchen-time") return `${String(value).replace(".", ",")} мин`
  if (metric === "attendance") return `${String(value).replace(".", ",")} %`
  return `${grouped(Math.round(value))} ₸`
}

/**
 * employees-13: motivation results — every participant of the non-draft programs whose period overlaps
 * the report period: fact against the threshold, the reward and the bonus already accrued. The fact is
 * for the program's own period (lib/motivation.ts, the same numbers as the program's «Результаты» tab).
 */
const motivation: Calculator = async (ctx, config, restaurants) => {
  const matches = matcher(config)
  const columns = [text("group", "Сотрудник"), text("code", "Табельный №"), text("program", "Программа"), text("metric", "Показатель"), text("period", "Период программы"), text("fact", "Факт"), text("threshold", "Порог"), text("basis", "Основание"), text("fulfilled", "Выполнено"), col("reward", "Премия", "money"), col("accrued", "Начислено", "money"), text("status", "Статус программы")]
  const rows = []
  let programs = 0
  let truncated = false
  for (const restaurant of restaurants) {
    const started = await ctx.db.query("motivationPrograms").withIndex("by_restaurant_starts", (q) => q.eq("restaurantExternalId", restaurant).lte("startsAt", config.dateTo)).order("desc").take(PROGRAMS_PER_RESTAURANT)
    if (started.length === PROGRAMS_PER_RESTAURANT) truncated = true
    const overlapping = started.filter((program) => program.status !== "draft" && program.endsAt >= config.dateFrom)
    for (const program of overlapping.sort((a, b) => a.number.localeCompare(b.number))) {
      programs += 1
      const results = await motivationResults(ctx, program)
      if (results.kitchenTruncated) truncated = true
      for (const result of results.rows) {
        if (!matches(result.employeeName, result.employeeCode, program.name, program.number)) continue
        rows.push({
          key: `${program.externalId}:${result.employeeCode}`,
          cells: {
            group: result.employeeName, code: result.employeeCode, program: `${program.number} «${program.name}»`, metric: METRIC_LABEL[program.metric], period: `${ruDate(program.startsAt)} – ${ruDate(program.endsAt)}`,
            fact: metricText(program.metric, result.fact), threshold: metricText(program.metric, program.threshold), basis: result.basis, fulfilled: result.fulfilled ? "Да" : "Нет",
            reward: result.reward, accrued: result.accrued ?? 0, status: PROGRAM_STATUS[program.status],
          },
        })
      }
    }
  }
  const totals = { reward: rows.reduce((sum, row) => sum + row.cells.reward, 0), accrued: rows.reduce((sum, row) => sum + row.cells.accrued, 0) }
  return {
    sourceLabel: "Мотивационные программы, пересекающие период (без черновиков); факт — за период программы",
    columns,
    rows,
    totals,
    kpis: [
      { key: "programs", label: "Программ", value: programs, unit: "count" },
      { key: "participants", label: "Участников", value: rows.length, unit: "count" },
      { key: "fulfilled", label: "Выполнили", value: rows.filter((row) => row.cells.fulfilled === "Да").length, unit: "count" },
      { key: "reward", label: "Премий по условиям", value: totals.reward, unit: "money" },
      { key: "accrued", label: "Начислено в зарплату", value: totals.accrued, unit: "money" },
    ],
    truncated,
  }
}

/** Where an approved document stands on `date`: in force, ending within 30 days, ended or renewed. */
async function medicalState(ctx: QueryCtx, row: Medical, date: string) {
  if (row.status !== "approved") return "—"
  if (row.issuedAt > date) return "Ещё не действует"
  if (row.expiresAt < date) return (await renewed(ctx, row, date)) ? "Продлён" : "Истёк"
  return row.expiresAt <= addDays(date, 30) ? "Истекает" : "Действует"
}

const medicalColumns = [text("group", "Сотрудник"), text("code", "Табельный №"), text("number", "Запись"), text("type", "Документ"), text("documentNumber", "Номер документа")]
const medicalCells = (row: Medical, pii: boolean) => ({ group: row.employeeName, code: row.employeeCode, number: row.number, type: MEDICAL_TYPE[row.documentType], documentNumber: publicRecord(row, pii).documentNumber })
const piiNote = (pii: boolean) => (pii ? "" : "; номера документов скрыты — нужно право «Персональные данные сотрудников»")

/**
 * employees-14: the register of medical books, analyses and admissions valid at some point of the
 * period (issued by its end, ending after its start), cancelled ones left out. The state is on the last
 * day of the period. Document numbers are masked without office.employees.pii; comments never show.
 */
const medicalRecords: Calculator = async (ctx, config, restaurants) => {
  const pii = await canSeeEmployeePii(ctx)
  const matches = matcher(config)
  const budget = newBudget()
  const columns = [...medicalColumns, col("issuedAt", "Выдан", "date"), col("expiresAt", "Действует до", "date"), text("issuer", "Кем выдан"), text("fit", "Допуск к работе"), text("status", "Статус"), text("state", `Состояние на ${ruDate(config.dateTo)}`)]
  const rows = []
  const counts = { valid: 0, expiring: 0, expired: 0, unfit: 0 }
  for (const restaurant of restaurants) {
    for await (const row of ctx.db.query("medicalRecords").withIndex("by_restaurant_expires", (q) => q.eq("restaurantExternalId", restaurant).gte("expiresAt", config.dateFrom))) {
      if (!spend(budget)) break
      if (row.status === "cancelled" || row.issuedAt > config.dateTo) continue
      if (!matches(row.employeeName, row.employeeCode, row.number, MEDICAL_TYPE[row.documentType])) continue
      const state = await medicalState(ctx, row, config.dateTo)
      if (state === "Действует" || state === "Истекает") counts.valid += 1
      if (state === "Истекает") counts.expiring += 1
      if (state === "Истёк") counts.expired += 1
      if (row.status === "approved" && !row.fitForWork) counts.unfit += 1
      rows.push({ key: row.externalId, cells: { ...medicalCells(row, pii), issuedAt: row.issuedAt, expiresAt: row.expiresAt, issuer: row.issuer, fit: row.fitForWork ? "Годен" : "Не годен", status: MEDICAL_STATUS[row.status], state } })
    }
  }
  rows.sort((a, b) => a.cells.expiresAt.localeCompare(b.cells.expiresAt) || a.cells.group.localeCompare(b.cells.group, "ru"))
  return {
    sourceLabel: `Медкнижки, анализы и допуски, действовавшие в периоде${piiNote(pii)}`,
    columns,
    rows,
    totals: {},
    kpis: [
      { key: "documents", label: "Документов", value: rows.length, unit: "count" },
      { key: "valid", label: "Действуют", value: counts.valid, unit: "count" },
      { key: "expiring", label: "Истекают ≤ 30 дн.", value: counts.expiring, unit: "count" },
      { key: "expired", label: "Истекли без продления", value: counts.expired, unit: "count" },
      { key: "unfit", label: "Не годен к работе", value: counts.unfit, unit: "count" },
    ],
    truncated: budget.truncated,
  }
}

/**
 * employees-15: expiring HR documents — the approved medical books, analyses and admissions (the only
 * HR documents with a term) that end within `extra.withinDays` (30 by default) of the last day of the
 * period or have already ended without a renewal: the calculation of the office's «Истекающие» banner.
 */
const expiringDocuments: Calculator = async (ctx, config, restaurants) => {
  const pii = await canSeeEmployeePii(ctx)
  const matches = matcher(config)
  const raw = config.extra?.withinDays
  const withinDays = typeof raw === "number" && Number.isFinite(raw) ? Math.min(MAX_WITHIN_DAYS, Math.max(0, Math.floor(raw))) : 30
  const date = config.dateTo
  const columns = [...medicalColumns, col("expiresAt", "Действует до", "date"), col("daysLeft", "Осталось дней", "count"), text("state", "Состояние"), text("admission", "Допуск сотрудника")]
  const employee = employeeById(ctx)
  const rows = []
  let truncated = false
  let expiringCount = 0
  let expiredCount = 0
  let revoked = 0
  for (const restaurant of restaurants) {
    const found = await expiringAndExpired(ctx, { restaurantExternalId: restaurant, today: date, withinDays })
    if (found.truncated) truncated = true
    for (const [state, list] of [["Истёк", found.expired], ["Истекает", found.expiring]] as const) {
      for (const row of list) {
        if (!matches(row.employeeName, row.employeeCode, row.number, MEDICAL_TYPE[row.documentType])) continue
        const admitted = (await employee(row.employeeId))?.admitted !== false
        if (state === "Истёк") expiredCount += 1
        else expiringCount += 1
        if (!admitted) revoked += 1
        rows.push({ key: row.externalId, cells: { ...medicalCells(row, pii), expiresAt: row.expiresAt, daysLeft: daysFrom(date, row.expiresAt), state, admission: admitted ? "Есть" : "Снят" } })
      }
    }
  }
  rows.sort((a, b) => a.cells.expiresAt.localeCompare(b.cells.expiresAt) || a.cells.group.localeCompare(b.cells.group, "ru"))
  return {
    sourceLabel: `Согласованные медкнижки, анализы и допуски: истекают до ${ruDate(addDays(date, withinDays))} (${withinDays} дн. от ${ruDate(date)}) или истекли без продления${piiNote(pii)}`,
    columns,
    rows,
    totals: {},
    kpis: [
      { key: "expiring", label: `Истекают за ${withinDays} дн.`, value: expiringCount, unit: "count" },
      { key: "expired", label: "Истекли без продления", value: expiredCount, unit: "count" },
      { key: "revoked", label: "Допуск снят", value: revoked, unit: "count" },
    ],
    truncated,
  }
}

export const EMPLOYEE_CALCULATORS: Record<string, Calculator> = {
  "employees-01": personalReport,
  "employees-02": payrollSummary,
  "employees-04": schedulePlanFact,
  "employees-05": attendanceJournal,
  "employees-06": lateness,
  "employees-07": accruals,
  "employees-08": withholdings,
  "employees-09": advancesAndPayouts,
  "employees-10": bonusesAndPenalties,
  "employees-11": efficiency,
  "employees-12": salesByEmployee,
  "employees-13": motivation,
  "employees-14": medicalRecords,
  "employees-15": expiringDocuments,
}
