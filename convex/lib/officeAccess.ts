import { getAuthUserId } from "@convex-dev/auth/server"
import { ConvexError } from "convex/values"

import type { GenericMutationCtx, GenericQueryCtx } from "convex/server"
import type { DataModel, Id } from "../_generated/dataModel"
import { insertAudit, resolveAuditOrganization } from "./audit"

type QueryCtx = GenericQueryCtx<DataModel>
type MutationCtx = GenericMutationCtx<DataModel>
type AnyCtx = QueryCtx | MutationCtx

/** Office sign-in is Convex Auth (email+password) — entirely separate from POS PIN sessions. */
export async function getOfficeAuthEmail(ctx: AnyCtx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity()
  if (identity?.email) return identity.email.trim().toLocaleLowerCase("en-US")
  const authUserId = await getAuthUserId(ctx)
  if (!authUserId) return null
  const authUser = await ctx.db.get(authUserId)
  return authUser?.email?.trim().toLocaleLowerCase("en-US") ?? null
}

export function allowsCapability(capabilities: string[], capability: string): boolean {
  return capabilities.some((candidate) => candidate === "*" || candidate === capability || (candidate.endsWith(".*") && capability.startsWith(candidate.slice(0, -1))))
}

export function hasScope(scopes: string[], value: string): boolean {
  return scopes.includes("*") || scopes.includes(value)
}

export async function requireOfficeCapability(ctx: AnyCtx, capability: string) {
  const email = await getOfficeAuthEmail(ctx)
  if (!email) throw new ConvexError("Требуется вход в Office")
  const user = await ctx.db.query("officeUsers").withIndex("by_email", (q) => q.eq("email", email)).unique()
  if (!user) throw new ConvexError("Офисный пользователь не настроен")
  if (!user.active) throw new ConvexError("Учётная запись отключена")
  const role = await ctx.db.query("officeRoles").withIndex("by_external_id", (q) => q.eq("externalId", user.roleExternalId)).unique()
  if (!role || !allowsCapability(role.capabilities, capability)) throw new ConvexError("Недостаточно прав")
  return { user, role }
}

export async function requireRestaurantScope(ctx: AnyCtx, user: { restaurantScopes: string[] }, restaurantExternalId: string) {
  if (!hasScope(user.restaurantScopes, restaurantExternalId)) throw new ConvexError("Нет доступа к ресторану")
}

export function hasNetworkScope(user: { restaurantScopes: string[] }): boolean {
  return user.restaurantScopes.includes("*")
}

/**
 * Predicate for office queries that return per-restaurant rows. A requested restaurant must be in
 * the user's scope; without a request the user sees every restaurant in scope. Rows without a
 * restaurant are network-level and only visible with network scope.
 */
export function restaurantScopeFilter(user: { restaurantScopes: string[] }, requestedExternalId?: string): (externalId: string | undefined) => boolean {
  if (requestedExternalId !== undefined && !hasScope(user.restaurantScopes, requestedExternalId)) throw new ConvexError("Нет доступа к ресторану")
  return (externalId) => {
    if (externalId === undefined) return hasNetworkScope(user)
    if (requestedExternalId !== undefined && externalId !== requestedExternalId) return false
    return hasScope(user.restaurantScopes, externalId)
  }
}

/**
 * Network-level resources (e.g. the guest base) until they get their own scoping. A full
 * administrator role ("*") counts as network scope: bootstrap used to store the admin's
 * restaurants as an explicit list rather than "*" (normalised by M-6, W1-ACL-02).
 */
export function requireNetworkScope(user: { restaurantScopes: string[] }, role?: { capabilities: string[] }) {
  if (hasNetworkScope(user) || role?.capabilities.includes("*")) return
  throw new ConvexError("Раздел доступен только с доступом ко всем ресторанам сети")
}

/** An employee is in scope when at least one of their restaurants is. */
export async function requireEmployeeInScope(ctx: AnyCtx, user: { restaurantScopes: string[] }, employee: { restaurantIds: Id<"restaurants">[] }) {
  if (hasNetworkScope(user)) return
  const restaurants = await Promise.all(employee.restaurantIds.map((id) => ctx.db.get(id)))
  if (!restaurants.some((restaurant) => restaurant && hasScope(user.restaurantScopes, restaurant.externalId))) {
    throw new ConvexError("Сотрудник вне доступных ресторанов")
  }
}

export async function writeOfficeAudit(
  ctx: MutationCtx,
  actorEmail: string,
  details: {
    action: string
    summary: string
    resourceType: string
    resourceExternalId: string
    restaurantExternalId?: string
    capability?: string
    details?: unknown
    correlationId?: string
  },
) {
  const organizationExternalId = await resolveAuditOrganization(ctx, actorEmail, details.restaurantExternalId)
  await insertAudit(ctx, {
    actorKey: actorEmail,
    action: details.action,
    summary: details.summary,
    resourceType: details.resourceType,
    resourceExternalId: details.resourceExternalId,
    organizationExternalId,
    ...(details.restaurantExternalId ? { restaurantExternalId: details.restaurantExternalId } : {}),
    ...(details.capability ? { capability: details.capability } : {}),
    ...(details.details !== undefined ? { details: details.details } : {}),
    ...(details.correlationId ? { correlationId: details.correlationId } : {}),
  })
}
