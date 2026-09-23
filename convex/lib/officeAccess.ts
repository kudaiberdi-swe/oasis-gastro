import { getAuthUserId } from "@convex-dev/auth/server"
import { ConvexError } from "convex/values"

import type { GenericMutationCtx, GenericQueryCtx } from "convex/server"
import type { DataModel } from "../_generated/dataModel"

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

export async function writeOfficeAudit(
  ctx: MutationCtx,
  actorEmail: string,
  details: { action: string; summary: string; resourceType: string; resourceExternalId: string; restaurantExternalId?: string },
) {
  const organizationExternalId = await resolveOrganizationExternalId(ctx, details.restaurantExternalId)
  await ctx.db.insert("auditEvents", {
    actorKey: actorEmail,
    action: details.action,
    summary: details.summary,
    resourceType: details.resourceType,
    resourceExternalId: details.resourceExternalId,
    organizationExternalId,
    ...(details.restaurantExternalId ? { restaurantExternalId: details.restaurantExternalId } : {}),
    occurredAt: Date.now(),
  })
}

async function resolveOrganizationExternalId(ctx: MutationCtx, restaurantExternalId?: string) {
  if (restaurantExternalId) {
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", restaurantExternalId)).unique()
    if (restaurant) return restaurant.organizationExternalId
  }
  const organization = (await ctx.db.query("organizations").take(10)).find((candidate) => candidate.active)
  if (!organization) throw new ConvexError("Активная организация не найдена")
  return organization.externalId
}
