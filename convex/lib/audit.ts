import { ConvexError } from "convex/values"
import type { GenericMutationCtx } from "convex/server"

import type { DataModel, Doc, Id } from "../_generated/dataModel"
import type { PosAccess } from "./auth"

type MutationCtx = GenericMutationCtx<DataModel>

export type AuditEvent = Omit<Doc<"auditEvents">, "_id" | "_creationTime" | "searchText" | "occurredAt"> & { occurredAt?: number }

/** Lowercased "actor action resourceType resourceExternalId summary" for search_audit. */
export function auditSearchText(event: Pick<Doc<"auditEvents">, "actorKey" | "action" | "resourceType" | "resourceExternalId" | "summary" | "correlationId">) {
  return [event.actorKey, event.action, event.resourceType, event.resourceExternalId, event.summary, event.correlationId].filter(Boolean).join(" ").toLocaleLowerCase("ru")
}

/** The one writer of auditEvents: POS and office events land in the same journal (W1-PLT-07). */
export async function insertAudit(ctx: MutationCtx, event: AuditEvent) {
  const row = { ...event, occurredAt: event.occurredAt ?? Date.now() }
  return ctx.db.insert("auditEvents", { ...row, searchText: auditSearchText(row) })
}

export async function writeAudit(
  ctx: MutationCtx,
  access: PosAccess,
  details: {
    action: string
    summary: string
    shiftId?: Id<"shifts">
    orderId?: Id<"orders">
    managerId?: Id<"employees">
    capability?: string
    details?: unknown
    correlationId?: string
  },
) {
  await insertAudit(ctx, {
    actorKey: access.employee.code,
    action: details.action,
    summary: details.summary,
    resourceType: details.orderId ? "order" : details.shiftId ? "shift" : "pos-session",
    resourceExternalId: String(details.orderId ?? details.shiftId ?? access.session._id),
    organizationExternalId: access.restaurant.organizationExternalId,
    restaurantExternalId: access.restaurant.externalId,
    terminalId: access.terminal._id,
    actorId: access.employee._id,
    ...(details.shiftId ? { shiftId: details.shiftId } : {}),
    ...(details.orderId ? { orderId: details.orderId } : {}),
    ...(details.managerId ? { managerId: details.managerId } : {}),
    ...(details.capability ? { capability: details.capability } : {}),
    ...(details.details !== undefined ? { details: details.details } : {}),
    ...(details.correlationId ? { correlationId: details.correlationId } : {}),
  })
}

/**
 * The organization an office event belongs to: the restaurant's, else the user's organization scope,
 * else the organization of the user's restaurants — never an arbitrary "first active" one.
 */
export async function resolveAuditOrganization(ctx: MutationCtx, actorEmail: string, restaurantExternalId?: string) {
  if (restaurantExternalId) {
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", restaurantExternalId)).unique()
    if (!restaurant) throw new ConvexError("Ресторан не найден")
    return restaurant.organizationExternalId
  }
  const user = await ctx.db.query("officeUsers").withIndex("by_email", (q) => q.eq("email", actorEmail)).unique()
  const organizationScope = user?.organizationScopes?.find((scope) => scope !== "*")
  if (organizationScope) return organizationScope
  const restaurantScope = user?.restaurantScopes.find((scope) => scope !== "*")
  if (restaurantScope) {
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", restaurantScope)).unique()
    if (restaurant) return restaurant.organizationExternalId
  }
  // Network-wide users (["*"]) of a single-organization deployment.
  const organizations = await ctx.db.query("organizations").take(3)
  const active = organizations.filter((organization) => organization.active)
  if (active.length === 1) return active[0].externalId
  throw new ConvexError("Не удалось определить организацию для журнала событий — укажите ресторан")
}
