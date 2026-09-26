import type { GenericQueryCtx } from "convex/server"

import type { DataModel, Doc } from "../_generated/dataModel"
import { almatyDayStart, DAY_MS } from "./time"

type QueryCtx = GenericQueryCtx<DataModel>
type Program = Doc<"motivationPrograms">
export type MotivationMetric = Program["metric"]

// Motivation results (W3-HR-07): the fact of every participant for the program's period, whether the
// threshold is met and the reward. Sales and the average check come from the daily sales facts by the
// employee who opened the check (orders.createdBy, written at checkout); kitchen time is the restaurant's
// average ticket time (the kitchen screen does not record the cook, so it is a team result); discipline
// is the share of published scheduled shifts started on time.

/** Clock-in later than this after the scheduled start counts as late. */
export const LATE_GRACE_MINUTES = 5
/** A clock-in this early before the start still belongs to the shift. */
const EARLY_WINDOW_MS = 4 * 3_600_000
/** Kitchen tickets read per result — the rest is reported as truncated. */
const KITCHEN_SCAN_BUDGET = 5_000

/** Lower is better only for kitchen time; the rest must reach the threshold. */
export function meetsThreshold(metric: MotivationMetric, fact: number | null, threshold: number) {
  if (fact === null) return false
  return metric === "kitchen-time" ? fact <= threshold : fact >= threshold
}

/** Whole tenge: a fixed amount, or a percent of the employee's sales (sales programs only). */
export function rewardFor(program: Pick<Program, "metric" | "rewardType" | "rewardValue">, fact: number | null, fulfilled: boolean) {
  if (!fulfilled || fact === null) return 0
  if (program.rewardType === "fixed") return Math.round(program.rewardValue)
  return program.metric === "sales" ? Math.round((fact * program.rewardValue) / 100) : 0
}

/** Active employees of the restaurant who take part: by position or code; empty lists mean everyone. */
export async function programParticipants(ctx: QueryCtx, program: Program) {
  const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", program.restaurantExternalId)).unique()
  if (!restaurant) return []
  const positions = new Set(program.participants.positionExternalIds ?? [])
  const codes = new Set(program.participants.employeeCodes ?? [])
  const everyone = positions.size === 0 && codes.size === 0
  const rows: Doc<"employees">[] = []
  for await (const employee of ctx.db.query("employees").withIndex("by_role_name")) {
    if (!employee.active || !employee.restaurantIds.includes(restaurant._id)) continue
    if (everyone || codes.has(employee.code) || (employee.positionExternalId !== undefined && positions.has(employee.positionExternalId))) rows.push(employee)
  }
  return rows.sort((a, b) => a.displayName.localeCompare(b.displayName, "ru"))
}

async function salesOf(ctx: QueryCtx, program: Program, employee: Doc<"employees">) {
  const facts = await ctx.db
    .query("dailySalesFacts")
    .withIndex("by_restaurant_type_key_date", (q) => q.eq("restaurantExternalId", program.restaurantExternalId).eq("factType", "employee").eq("dimensionKey", employee.code).gte("businessDate", program.startsAt).lte("businessDate", program.endsAt))
    .take(200)
  return { net: facts.reduce((sum, row) => sum + row.netAmount, 0), orders: facts.reduce((sum, row) => sum + row.orderCount, 0) }
}

/** Average minutes from sending to the kitchen to ready over the period (tickets of the restaurant). */
async function kitchenMinutesOf(ctx: QueryCtx, program: Program) {
  const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", program.restaurantExternalId)).unique()
  if (!restaurant) return { minutes: null, tickets: 0, truncated: false }
  // A business day ends up to 12 h after midnight (restaurant cutoff).
  const from = almatyDayStart(program.startsAt)
  const to = almatyDayStart(program.endsAt) + DAY_MS + 12 * 3_600_000
  let tickets = 0
  let total = 0
  let scanned = 0
  let truncated = false
  for (const status of ["ready", "completed"] as const) {
    for await (const ticket of ctx.db.query("kitchenTickets").withIndex("by_restaurant_status_created", (q) => q.eq("restaurantId", restaurant._id).eq("status", status).gte("createdAt", from).lt("createdAt", to))) {
      if ((scanned += 1) > KITCHEN_SCAN_BUDGET) {
        truncated = true
        break
      }
      if (!ticket.readyAt) continue
      tickets += 1
      total += Math.max(0, ticket.readyAt - ticket.createdAt) / 60_000
    }
  }
  return { minutes: tickets ? Math.round((total / tickets) * 10) / 10 : null, tickets, truncated }
}

/** Published shifts of the period and how many of them the employee started on time. */
async function disciplineOf(ctx: QueryCtx, program: Program, employee: Doc<"employees">) {
  const from = almatyDayStart(program.startsAt)
  const to = almatyDayStart(program.endsAt) + DAY_MS
  const planned = await ctx.db.query("scheduleEntries").withIndex("by_employee_start", (q) => q.eq("employeeId", employee._id).gte("start", from).lt("start", to)).take(200)
  const shifts = planned.filter((row) => row.status === "published" && row.restaurantExternalId === program.restaurantExternalId)
  if (!shifts.length) return { percent: null, shifts: 0, late: 0 }
  const clockIns: number[] = []
  for (const status of ["completed", "approved", "active"] as const) {
    const rows = await ctx.db.query("attendanceRecords").withIndex("by_employee_status", (q) => q.eq("employeeId", employee._id).eq("status", status).gte("clockIn", from - EARLY_WINDOW_MS).lt("clockIn", to)).take(200)
    for (const row of rows) if (row.attendanceType === "worked") clockIns.push(row.clockIn)
  }
  let late = 0
  for (const shift of shifts) {
    const came = clockIns.filter((at) => at >= shift.start - EARLY_WINDOW_MS && at < shift.end).sort((a, b) => a - b)[0]
    if (came === undefined || came > shift.start + LATE_GRACE_MINUTES * 60_000) late += 1
  }
  return { percent: Math.round(((shifts.length - late) / shifts.length) * 1000) / 10, shifts: shifts.length, late }
}

export type MotivationResult = {
  employeeId: Doc<"employees">["_id"]
  employeeCode: string
  employeeName: string
  positionExternalId?: string
  fact: number | null
  /** What the fact was taken from: «Чеков: 12», «Смен по графику: 8, опозданий и неявок: 1». */
  basis: string
  fulfilled: boolean
  reward: number
  /** The bonus already accrued for this program, if any. */
  accrued: number | null
}

/** Results of every participant, the bonuses already accrued included. */
export async function motivationResults(ctx: QueryCtx, program: Program) {
  const participants = await programParticipants(ctx, program)
  const kitchen = program.metric === "kitchen-time" ? await kitchenMinutesOf(ctx, program) : null
  const rows: MotivationResult[] = []
  for (const employee of participants) {
    let fact: number | null = null
    let basis = ""
    if (program.metric === "sales" || program.metric === "average-check") {
      const sales = await salesOf(ctx, program, employee)
      fact = program.metric === "sales" ? sales.net : sales.orders ? Math.round(sales.net / sales.orders) : null
      basis = `Чеков: ${sales.orders}`
    } else if (program.metric === "kitchen-time") {
      fact = kitchen!.minutes
      basis = `Тикетов кухни ресторана: ${kitchen!.tickets}`
    } else {
      const discipline = await disciplineOf(ctx, program, employee)
      fact = discipline.percent
      basis = discipline.shifts ? `Смен по графику: ${discipline.shifts}, опозданий и неявок: ${discipline.late}` : "Нет опубликованных смен в графике"
    }
    const fulfilled = meetsThreshold(program.metric, fact, program.threshold)
    const accrued = await ctx.db.query("payrollAdjustments").withIndex("by_source_employee", (q) => q.eq("sourceExternalId", program.externalId).eq("employeeId", employee._id)).first()
    rows.push({ employeeId: employee._id, employeeCode: employee.code, employeeName: employee.displayName, positionExternalId: employee.positionExternalId, fact, basis, fulfilled, reward: rewardFor(program, fact, fulfilled), accrued: accrued?.amount ?? null })
  }
  return { rows, kitchenTruncated: kitchen?.truncated ?? false }
}
