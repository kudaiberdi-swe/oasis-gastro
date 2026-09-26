import { v } from "convex/values"

import { query } from "../../_generated/server"
import type { Doc, Id } from "../../_generated/dataModel"
import { requireOperator } from "../../lib/auth"

// A restaurant rarely has more than a hundred tables; the office editor caps a hall plan at the same 200.
const TABLE_LIMIT = 200
const OPEN_LIMIT = 200

/** One open check on the floor: enough for a tile (total, age, status) and for switching to it. */
export type FloorCheck = {
  orderId: Id<"orders">
  number: number
  tableLabel?: string
  hallLabel?: string
  status: "draft" | "held"
  total: number
  createdAt: number
  updatedAt: number
  kitchenSentAt: number | null
  /** Opened at this terminal — only those can be edited here (saveDraft refuses the others). */
  mine: boolean
  /** The other terminal's name when not mine. */
  terminalName?: string
}

const tableKey = (hall: string, label: string) => `${hall}\u0000${label}`

/**
 * The hall of the terminal's restaurant for the cashier (POS «Зал»): active tables grouped by hall with
 * the open checks sitting at each, plus the terminal's open checks whose table is not on the plan
 * (typed by hand, takeaway, a table removed from the plan) — so no open check is ever out of reach.
 * Checks of other terminals only mark a table as taken; the office's reservations.floorPlan stays office-only.
 */
export const floor = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const restaurantExternalId = access.restaurant.externalId
    const [allTables, drafts, held] = await Promise.all([
      ctx.db.query("diningTables").withIndex("by_restaurant_hall", (q) => q.eq("restaurantExternalId", restaurantExternalId)).take(TABLE_LIMIT),
      ctx.db.query("orders").withIndex("by_restaurant_status_created", (q) => q.eq("restaurantId", access.restaurant._id).eq("status", "draft")).take(OPEN_LIMIT),
      ctx.db.query("orders").withIndex("by_restaurant_status_created", (q) => q.eq("restaurantId", access.restaurant._id).eq("status", "held")).take(OPEN_LIMIT),
    ])
    const tables = allTables.filter((table) => table.active)

    const terminalNames = new Map<Id<"posTerminals">, string>()
    const foreignTerminals = [...new Set([...drafts, ...held].map((order) => order.terminalId).filter((id): id is Id<"posTerminals"> => Boolean(id) && id !== access.terminal._id))]
    for (const terminal of await Promise.all(foreignTerminals.map((id) => ctx.db.get(id)))) if (terminal) terminalNames.set(terminal._id, terminal.name)

    const summary = (order: Doc<"orders">): FloorCheck => {
      const mine = order.terminalId === access.terminal._id
      return {
        orderId: order._id,
        number: order.number,
        tableLabel: order.tableLabel?.trim() || undefined,
        hallLabel: order.hallLabel?.trim() || undefined,
        status: order.status as "draft" | "held",
        total: order.total,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt ?? order.createdAt,
        kitchenSentAt: order.kitchenSentAt ?? null,
        mine,
        ...(mine || !order.terminalId ? {} : { terminalName: terminalNames.get(order.terminalId) ?? "Другая касса" }),
      }
    }

    // A check names its table by label and (when opened from the plan) hall; an older check without a hall
    // sits at the first table of that label.
    const byKey = new Map<string, Doc<"diningTables">>()
    const byLabel = new Map<string, Doc<"diningTables">>()
    for (const table of tables) {
      byKey.set(tableKey(table.hall, table.label.trim()), table)
      if (!byLabel.has(table.label.trim())) byLabel.set(table.label.trim(), table)
    }
    const checksByTable = new Map<Id<"diningTables">, FloorCheck[]>()
    const orphans: FloorCheck[] = []
    for (const order of [...drafts, ...held].sort((a, b) => a.createdAt - b.createdAt)) {
      const check = summary(order)
      const table = check.tableLabel ? (check.hallLabel ? byKey.get(tableKey(check.hallLabel, check.tableLabel)) : byLabel.get(check.tableLabel)) : undefined
      if (table) checksByTable.set(table._id, [...(checksByTable.get(table._id) ?? []), check])
      else if (check.mine) orphans.push(check)
    }

    const halls: Array<{ name: string; tables: Array<{ tableId: Id<"diningTables">; externalId: string; label: string; capacity: number; shape: "rect" | "circle"; checks: FloorCheck[] }> }> = []
    for (const table of tables) {
      let hall = halls.find((row) => row.name === table.hall)
      if (!hall) {
        hall = { name: table.hall, tables: [] }
        halls.push(hall)
      }
      hall.tables.push({ tableId: table._id, externalId: table.externalId, label: table.label.trim(), capacity: table.capacity, shape: table.shape, checks: checksByTable.get(table._id) ?? [] })
    }

    return {
      halls,
      orphans,
      tableCount: tables.length,
      // The lists are bounded; say so instead of silently dropping tables or checks.
      truncated: allTables.length === TABLE_LIMIT || drafts.length === OPEN_LIMIT || held.length === OPEN_LIMIT,
    }
  },
})
