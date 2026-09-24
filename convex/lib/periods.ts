import { ConvexError } from "convex/values"
import type { GenericQueryCtx } from "convex/server"

import type { DataModel, Doc } from "../_generated/dataModel"
import { almatyDayStart } from "./time"

type QueryCtx = GenericQueryCtx<DataModel>

export type PeriodScope = {
  organizationExternalId: string
  restaurantExternalId?: string
  /** "YYYY-MM-DD" business date of the operation. */
  businessDate: string
  /** A lock with a moduleId only covers that module; a lock without one covers everything. */
  moduleId?: string
}

/** "2026-08-31" → "31.08.2026". */
export function formatBusinessDate(date: string) {
  const [year, month, day] = date.split("-")
  return `${day}.${month}.${year}`
}

function lockedThroughDate(lockedThrough: number) {
  // lockedThrough is the start (Almaty midnight) of the last closed day.
  const date = new Date(lockedThrough + 5 * 60 * 60 * 1000)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`
}

/**
 * Active locks covering the date, for this organization only (B-26: another brand's lock never
 * applies): both restaurant-level and organization-wide locks. Final locks sort first.
 */
export async function findPeriodLocks(ctx: QueryCtx, scope: PeriodScope): Promise<Doc<"periodLocks">[]> {
  const dayStart = almatyDayStart(scope.businessDate)
  const byScope = async (restaurantExternalId: string | undefined) =>
    ctx.db
      .query("periodLocks")
      .withIndex("by_org_restaurant_active", (q) =>
        q.eq("organizationExternalId", scope.organizationExternalId).eq("restaurantExternalId", restaurantExternalId).eq("active", true).gte("lockedThrough", dayStart),
      )
      .take(50)
  const locks = [...(scope.restaurantExternalId ? await byScope(scope.restaurantExternalId) : []), ...(await byScope(undefined))]
  return locks
    .filter((lock) => !lock.moduleId || lock.moduleId === scope.moduleId)
    .sort((a, b) => (a.kind === b.kind ? b.lockedThrough - a.lockedThrough : a.kind === "final" ? -1 : 1))
}

export function periodLockMessage(lock: Doc<"periodLocks">) {
  return `Период ${lock.kind === "final" ? "окончательно" : "предварительно"} закрыт по ${formatBusinessDate(lockedThroughDate(lock.lockedThrough))}`
}

/** Every money or stock posting calls this before writing (checkout, refund, cancel, stock documents, journal). */
export async function assertPeriodOpen(ctx: QueryCtx, scope: PeriodScope) {
  const [lock] = await findPeriodLocks(ctx, scope)
  if (lock) throw new ConvexError(periodLockMessage(lock))
}

export { lockedThroughDate }
