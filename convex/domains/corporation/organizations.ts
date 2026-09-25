import { ConvexError, v } from "convex/values"

import { mutation, query } from "../../_generated/server"
import { isValidKzBin } from "../../lib/bin"
import { effectiveScopes, getOfficeAuthEmail, hasScope, requireOfficeCapability, requireOrganizationScope, writeOfficeAudit } from "../../lib/officeAccess"
import { appendOutboxEvent } from "../../lib/outbox"

// «Организации» (W2-ADM-06). Organizations imported from iiko keep their source fields; the office edits
// only the local ones (BIN, legal name, jurisdiction).

export const listOrganizations = query({
  args: { status: v.optional(v.union(v.literal("active"), v.literal("inactive"))) },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.organizations.view")
    const scopes = await effectiveScopes(ctx, user, role)
    const organizations = await ctx.db.query("organizations").take(200)
    const rows = []
    for (const organization of organizations) {
      if (!hasScope(scopes.organizationScopes, organization.externalId)) continue
      if (args.status && organization.active !== (args.status === "active")) continue
      const restaurants = await ctx.db.query("restaurants").withIndex("by_organization", (q) => q.eq("organizationExternalId", organization.externalId)).take(200)
      rows.push({ ...organization, restaurantCount: restaurants.length, activeRestaurantCount: restaurants.filter((row) => row.active).length })
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name, "ru"))
  },
})

export const saveOrganization = mutation({
  args: {
    externalId: v.optional(v.string()),
    expectedVersion: v.optional(v.number()),
    name: v.string(),
    legalName: v.optional(v.string()),
    bin: v.optional(v.string()),
    currency: v.union(v.literal("KZT"), v.literal("RUB"), v.literal("USD")),
    timezone: v.string(),
    jurisdiction: v.union(v.literal("KZ"), v.literal("RU")),
    vatPayer: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.organizations.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const name = args.name.trim()
    if (!name) throw new ConvexError("Укажите название организации")
    const bin = args.bin?.trim() || undefined
    if (bin && args.jurisdiction === "KZ" && !isValidKzBin(bin)) throw new ConvexError("БИН не прошёл проверку: 12 цифр и контрольная цифра")
    const local = { legalName: args.legalName?.trim() || undefined, bin, jurisdiction: args.jurisdiction, vatPayer: args.vatPayer }
    let externalId = args.externalId
    if (externalId) {
      await requireOrganizationScope(ctx, user, externalId, role)
      const existing = await ctx.db.query("organizations").withIndex("by_external_id", (q) => q.eq("externalId", externalId!)).unique()
      if (!existing) throw new ConvexError("Организация не найдена")
      if (args.expectedVersion !== undefined && (existing.version ?? 0) !== args.expectedVersion) throw new ConvexError("Организацию изменил другой пользователь — обновите страницу")
      const readOnly = existing.sourceReadOnly || existing.sourceSystem === "iiko-server"
      await ctx.db.patch(existing._id, { ...local, ...(readOnly ? {} : { name, currency: args.currency, timezone: args.timezone }), version: (existing.version ?? 0) + 1 })
    } else {
      if (!user.restaurantScopes.includes("*")) throw new ConvexError("Создать организацию может только пользователь с доступом ко всей сети")
      externalId = `organization-${crypto.randomUUID()}`
      await ctx.db.insert("organizations", { externalId, name, currency: args.currency, timezone: args.timezone, active: true, ...local, version: 1 })
    }
    await writeOfficeAudit(ctx, email, { action: "organization.save", summary: `Организация «${name}»`, resourceType: "organization", resourceExternalId: externalId, capability: "office.organizations.edit" })
    await appendOutboxEvent(ctx, { aggregateType: "organization", aggregateExternalId: externalId, eventType: "organization.updated", organizationExternalId: externalId, payload: { name } })
    return externalId
  },
})

export const setOrganizationActive = mutation({
  args: { externalId: v.string(), active: v.boolean() },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.organizations.edit")
    await requireOrganizationScope(ctx, user, args.externalId, role)
    const email = (await getOfficeAuthEmail(ctx))!
    const organization = await ctx.db.query("organizations").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!organization) throw new ConvexError("Организация не найдена")
    if (!args.active) {
      const restaurants = await ctx.db.query("restaurants").withIndex("by_organization", (q) => q.eq("organizationExternalId", args.externalId)).take(200)
      if (restaurants.some((row) => row.active)) throw new ConvexError("Сначала отключите рестораны организации")
    }
    await ctx.db.patch(organization._id, { active: args.active, version: (organization.version ?? 0) + 1 })
    await writeOfficeAudit(ctx, email, { action: "organization.status", summary: `Организация «${organization.name}»: ${args.active ? "включена" : "отключена"}`, resourceType: "organization", resourceExternalId: organization.externalId, capability: "office.organizations.edit" })
  },
})
