import type { Doc, Id } from "../../../_generated/dataModel"
import { requireOfficeCapability } from "../../../lib/officeAccess"
import type { ReportColumn, ReportResult } from "../../../lib/reportConfig"
import type { Calculator } from "../registry"
import { ALMATY_OFFSET_MS } from "./_shared"

// Scope helpers of the W3 reports (W3-RPT-04/05/06). Calculators also run from report mailings, without
// a signed-in user, so the scope comes from the report's restaurants, never from the identity.

type QueryCtx = Parameters<Calculator>[0]

/**
 * Network-level rows (integration jobs, outbox events, org-wide locks, guests without a home restaurant)
 * show only when the report covers every active restaurant — the same rule as restaurantScopeFilter.
 */
export async function coversNetwork(ctx: QueryCtx, restaurants: string[]) {
  const selected = new Set(restaurants)
  const active = await ctx.db.query("restaurants").withIndex("by_active_and_name", (q) => q.eq("active", true)).take(200)
  return active.every((restaurant) => selected.has(restaurant.externalId))
}

/** A row of a restaurant is in the report's restaurants; a row without one needs the whole network. */
export function scopeOf(restaurants: string[], network: boolean) {
  const selected = new Set(restaurants)
  return (restaurantExternalId: string | undefined) => (restaurantExternalId ? selected.has(restaurantExternalId) : network)
}

/** Guest personal data only with office.guests.pii (Г-2); a mailing without a user always gets the mask. */
export async function canSeeGuestPii(ctx: QueryCtx) {
  try {
    await requireOfficeCapability(ctx, "office.guests.pii")
    return true
  } catch {
    return false
  }
}

/** An honest empty result with a status in the source label (not applicable, mechanic off, not connected). */
export function statusResult(sourceLabel: string, columns: ReportColumn[]): Omit<ReportResult, "reportId" | "generatedAt"> {
  return { sourceLabel, columns, rows: [], totals: {}, kpis: [], truncated: false }
}

/** Memoized lookup of a row by its id string (fact keys, payload ids); a malformed id is null. */
export function lookup<T extends "guests" | "restaurants" | "loyaltyPrograms" | "warehouses" | "posTerminals">(ctx: QueryCtx, table: T) {
  const cache = new Map<string, Doc<T> | null>()
  return async (id: string | Id<T> | undefined) => {
    if (!id) return null
    if (!cache.has(id)) {
      const normalized = ctx.db.normalizeId(table, id)
      cache.set(id, normalized ? ((await ctx.db.get(normalized)) as Doc<T> | null) : null)
    }
    return cache.get(id) ?? null
  }
}

/** Restaurant names by external id (for labels). */
export async function restaurantNames(ctx: QueryCtx, restaurants: string[]) {
  const names = new Map<string, string>()
  for (const externalId of restaurants) {
    const row = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
    names.set(externalId, row?.name ?? externalId)
  }
  return names
}

/** Date and time in Almaty, «2026-09-20 14:05». */
export const localDateTime = (at: number) => new Date(at + ALMATY_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ")
