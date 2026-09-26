import { ConvexError, v } from "convex/values"

import { query } from "../../_generated/server"
import { SYSTEM_ACCOUNTS } from "../../lib/accounts"
import { monthEnd } from "../../lib/budgets"
import { requireOfficeCapability, restaurantScopeFilter, scopedRestaurants } from "../../lib/officeAccess"
import { businessDateFor } from "../../lib/time"

// «Платёжный календарь» (W3-FIN-12): the month's planned money by day and the forecast of money left.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const JOURNAL_SCAN = 20_000
const RECORD_SCAN = 5000
/** Calendar records that are still a plan: a draft is not agreed yet, a posted one is paid (it is in the balance). */
const PLANNED = ["pending-approval", "approved"]

const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

type Day = { date: string; incoming: number; outgoing: number; items: number; balance: number | null; gap: boolean }

/**
 * By day of the month: planned receipts and payments — calendar records on their planned date plus open
 * obligations on their due date that no calendar record refers to — and the forecast of money (accounts
 * 1010 + 1030) from today's balance. The forecast looks forward: anything planned or due before today and
 * still open counts on today; days before today have no forecast. A day whose balance falls below zero
 * is a cash gap.
 */
export const cashflowForecast = query({
  args: { restaurantExternalId: v.optional(v.string()), month: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.payment-calendar.view")
    const inScope = restaurantScopeFilter(user, args.restaurantExternalId)
    if (!MONTH.test(args.month)) throw new ConvexError("Месяц — ГГГГ-ММ")
    const restaurants = args.restaurantExternalId ? [args.restaurantExternalId] : (await scopedRestaurants(ctx, user)).map((row) => row.externalId).filter(inScope)
    const allowed = new Set(restaurants)
    const today = businessDateFor(Date.now())
    const first = `${args.month}-01`
    const last = monthEnd(args.month)
    let truncated = false

    // Money today: debit minus credit of cash and bank over the whole journal up to today.
    let current = 0
    for (const account of [SYSTEM_ACCOUNTS.cash.externalId, SYSTEM_ACCOUNTS.bank.externalId]) {
      for (const side of ["debit", "credit"] as const) {
        const lines =
          side === "debit"
            ? ctx.db.query("journalEntries").withIndex("by_debit_date", (q) => q.eq("debitAccountExternalId", account).lte("businessDate", today))
            : ctx.db.query("journalEntries").withIndex("by_credit_date", (q) => q.eq("creditAccountExternalId", account).lte("businessDate", today))
        let scanned = 0
        for await (const entry of lines) {
          if ((scanned += 1) > JOURNAL_SCAN) {
            truncated = true
            break
          }
          if (allowed.has(entry.restaurantExternalId)) current += side === "debit" ? entry.amount : -entry.amount
        }
      }
    }

    // Planned flows up to the month's end, overdue ones moved to today.
    const flows = new Map<string, { incoming: number; outgoing: number; items: number }>()
    const overdue = { incoming: 0, outgoing: 0, items: 0 }
    const undated = { items: 0, amount: 0 }
    const add = (date: string, incoming: boolean, amount: number) => {
      const day = date < today ? today : date
      if (day > last) return
      if (date < today) {
        overdue[incoming ? "incoming" : "outgoing"] += amount
        overdue.items += 1
      }
      const row = flows.get(day) ?? { incoming: 0, outgoing: 0, items: 0 }
      row[incoming ? "incoming" : "outgoing"] += amount
      row.items += 1
      flows.set(day, row)
    }
    const linked = new Set<string>()
    let scanned = 0
    for (const restaurant of restaurants) {
      for await (const record of ctx.db.query("financeRecords").withIndex("by_module_restaurant_date", (q) => q.eq("moduleId", "payment-calendar").eq("restaurantExternalId", restaurant).lte("businessDate", last))) {
        if ((scanned += 1) > RECORD_SCAN) {
          truncated = true
          break
        }
        if (record.status === "cancelled") continue
        if (typeof record.data.obligationExternalId === "string" && record.data.obligationExternalId) linked.add(record.data.obligationExternalId)
        if (!PLANNED.includes(record.status)) continue
        const planned = typeof record.data.plannedAt === "string" && DATE.test(record.data.plannedAt) ? record.data.plannedAt : record.businessDate
        add(planned, record.data.direction === "incoming", record.amount)
      }
    }
    for (const restaurant of restaurants) {
      for await (const record of ctx.db.query("financeRecords").withIndex("by_module_restaurant_date", (q) => q.eq("moduleId", "accounts-payable").eq("restaurantExternalId", restaurant))) {
        if ((scanned += 1) > RECORD_SCAN) {
          truncated = true
          break
        }
        if (record.status !== "posted" || record.amount <= 0 || linked.has(record.externalId)) continue
        const due = typeof record.data.dueDate === "string" && DATE.test(record.data.dueDate) ? record.data.dueDate : null
        if (!due) {
          undated.items += 1
          undated.amount += record.amount
          continue
        }
        add(due, record.data.direction === "receivable", record.amount)
      }
    }

    // Balance forward from today; the month opens after what is planned before its first day.
    let balance = current
    for (const [date, flow] of [...flows.entries()].sort(([a], [b]) => a.localeCompare(b))) if (date < first) balance += flow.incoming - flow.outgoing
    const opening = first >= today ? balance : null
    const days: Day[] = []
    let incoming = 0
    let outgoing = 0
    let minimum: number | null = null
    for (let date = first; date <= last; date = shiftDate(date, 1)) {
      const flow = date >= today ? (flows.get(date) ?? { incoming: 0, outgoing: 0, items: 0 }) : { incoming: 0, outgoing: 0, items: 0 }
      if (date < today) {
        days.push({ date, ...flow, balance: null, gap: false })
        continue
      }
      balance += flow.incoming - flow.outgoing
      incoming += flow.incoming
      outgoing += flow.outgoing
      minimum = minimum === null ? balance : Math.min(minimum, balance)
      days.push({ date, ...flow, balance, gap: balance < 0 })
    }
    return {
      month: args.month,
      today,
      currentBalance: current,
      openingBalance: opening,
      days,
      incoming,
      outgoing,
      minimumBalance: minimum,
      gapDays: days.filter((day) => day.gap).length,
      overdue,
      undated,
      truncated,
    }
  },
})
