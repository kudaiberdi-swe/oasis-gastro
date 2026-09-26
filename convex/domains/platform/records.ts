import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { mutation, query, type QueryCtx } from "../../_generated/server"
import { getDomainRecord, isOrganizationScope, listDomainRecords, saveDomainRecord, transitionCapability, transitionDomainRecord, type ModuleDefinition } from "../../lib/domainRecords"
import { getOfficeAuthEmail, hasNetworkScope, requireNetworkScope, requireOfficeCapability, requireRestaurantScope, restaurantScopeFilter, scopedRestaurants } from "../../lib/officeAccess"
import { STATION_LABEL } from "../../lib/reportFacts"
import { officeDomainStatus } from "../../lib/validators"
import { organizationOfScope, platformHooks, ROUTING_DEVICES, validatePlatformRecord, type EquipmentType } from "./modules"
import { PLATFORM_MODULES, platformModuleId, platformRecordData, printRoutingRule, type PlatformModuleId } from "./validators"

// Platform records (W3-ADM-10…12: print templates, equipment, system settings) on the domain-record engine.
// Every handler checks office.<module>.<action> and the scope itself: a restaurant record needs that
// restaurant, a network-wide one («organization:<id>») needs network scope.

function moduleOf(moduleId: PlatformModuleId): ModuleDefinition<"platformRecords"> {
  // Reference data, not postings: a closed period never blocks a template or a setting.
  return { moduleId, ...PLATFORM_MODULES[moduleId], periodLocked: false }
}

const domainAction = v.union(v.literal("activate"), v.literal("deactivate"), v.literal("publish"), v.literal("expire"))

async function requirePlatformScope(ctx: QueryCtx, user: { restaurantScopes: string[] }, role: { capabilities: string[] }, restaurantExternalId: string) {
  const organization = organizationOfScope(restaurantExternalId)
  if (organization === null) return requireRestaurantScope(ctx, user, restaurantExternalId)
  requireNetworkScope(user, role)
  const row = await ctx.db.query("organizations").withIndex("by_external_id", (q) => q.eq("externalId", organization)).unique()
  if (!row) throw new ConvexError("Организация не найдена")
}

export const list = query({
  args: {
    moduleId: platformModuleId,
    status: v.optional(officeDomainStatus),
    restaurantExternalId: v.optional(v.string()),
    search: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, `office.${args.moduleId}.view`)
    restaurantScopeFilter(user, args.restaurantExternalId) // throws for a restaurant outside the scope
    return listDomainRecords(ctx, "platformRecords", user, args)
  },
})

export const get = query({
  args: { moduleId: platformModuleId, externalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, `office.${args.moduleId}.view`)
    return getDomainRecord(ctx, "platformRecords", user, args.moduleId, args.externalId)
  },
})

/** Pick lists for the cards: restaurants and organizations in scope, terminals, printers, kitchen stations. */
export const references = query({
  args: { moduleId: platformModuleId },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, `office.${args.moduleId}.view`)
    const restaurants = await scopedRestaurants(ctx, user)
    const network = hasNetworkScope(user)
    const organizations = network ? await ctx.db.query("organizations").take(50) : []
    const terminals = []
    if (args.moduleId !== "print-templates") {
      for (const restaurant of restaurants) {
        for (const terminal of await ctx.db.query("posTerminals").withIndex("by_restaurant_number", (q) => q.eq("restaurantId", restaurant._id)).take(50)) {
          terminals.push({ externalId: terminal.externalId, name: terminal.name, restaurantExternalId: restaurant.externalId, active: terminal.active })
        }
      }
    }
    const inScope = restaurantScopeFilter(user)
    const devices = args.moduleId === "equipment" ? await ctx.db.query("platformRecords").withIndex("by_module_status_date", (q) => q.eq("moduleId", "equipment").eq("status", "active")).take(200) : []
    const printers = devices
      .filter((row) => inScope(row.restaurantExternalId) && ROUTING_DEVICES.includes(row.data.type as EquipmentType))
      .map((row) => ({ externalId: row.externalId, name: row.name, type: row.data.type as EquipmentType, restaurantExternalId: row.restaurantExternalId }))
    return {
      restaurants: restaurants.map((restaurant) => ({ externalId: restaurant.externalId, name: restaurant.name, organizationExternalId: restaurant.organizationExternalId })),
      organizations: organizations.filter((row) => row.active).map((row) => ({ externalId: row.externalId, name: row.name })),
      network,
      terminals,
      printers,
      stations: Object.entries(STATION_LABEL).map(([value, label]) => ({ value, label })),
    }
  },
})

export const save = mutation({
  args: {
    moduleId: platformModuleId,
    externalId: v.optional(v.string()),
    expectedVersion: v.optional(v.number()),
    name: v.string(),
    restaurantExternalId: v.string(),
    businessDate: v.string(),
    data: platformRecordData,
    routing: v.optional(v.array(printRoutingRule)),
  },
  handler: async (ctx, { moduleId, ...input }) => {
    const { user, role } = await requireOfficeCapability(ctx, `office.${moduleId}.edit`)
    if (isOrganizationScope(input.restaurantExternalId)) await requirePlatformScope(ctx, user, role, input.restaurantExternalId)
    else await requireRestaurantScope(ctx, user, input.restaurantExternalId)
    const email = await getOfficeAuthEmail(ctx)
    if (!email) throw new ConvexError("Требуется вход в Office")
    const args = { ...input, amount: 0 }
    const derived = await validatePlatformRecord(ctx, moduleId, args)
    const record = await saveDomainRecord(ctx, "platformRecords", email, moduleOf(moduleId), { ...args, ...derived })
    return { externalId: record.externalId, number: record.number, version: record.version }
  },
})

export const transition = mutation({
  args: { moduleId: platformModuleId, externalId: v.string(), action: domainAction, expectedVersion: v.number(), reason: v.optional(v.string()) },
  handler: async (ctx, { moduleId, ...args }) => {
    const module = moduleOf(moduleId)
    const { user, role } = await requireOfficeCapability(ctx, transitionCapability(module, args.action))
    const email = await getOfficeAuthEmail(ctx)
    if (!email) throw new ConvexError("Требуется вход в Office")
    const current = await getDomainRecord(ctx, "platformRecords", user, moduleId, args.externalId)
    if (current && isOrganizationScope(current.restaurantExternalId)) await requirePlatformScope(ctx, user, role, current.restaurantExternalId)
    const record = await transitionDomainRecord(ctx, "platformRecords", email, user, module, args, platformHooks(ctx, moduleId, email))
    return { status: record.status, version: record.version }
  },
})
