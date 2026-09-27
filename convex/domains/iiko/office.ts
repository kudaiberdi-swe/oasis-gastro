import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { mutation, query, type MutationCtx } from "../../_generated/server"
import { getOfficeAuthEmail, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"

// Office view of the iiko mirror (W1-IIKO-06) and branch mapping (W1-IIKO-02). Read-only towards
// iiko: nothing here calls it; imports run from scripts/iiko on a trusted machine.

export const integrationOverview = query({
  args: {},
  handler: async (ctx) => {
    await requireOfficeCapability(ctx, "office.data-exchange.view")
    const runs = await ctx.db.query("iikoImportRuns").order("desc").take(10)
    const states = await ctx.db.query("iikoEndpointStates").take(200)
    const last = runs[0] ?? null
    return {
      lastRun: last,
      runs,
      kpis: {
        operations: states.length,
        mirrored: states.filter((state) => (state.classification ?? "mirrored") === "mirrored").length,
        blockedOneWay: states.filter((state) => state.classification === "blocked-one-way").length,
        lastRunRecords: last ? Object.values(last.countsByEndpoint ?? {}).reduce((sum, value) => sum + value, 0) || (last.counts ? last.counts.departments + last.counts.employees : 0) : 0,
      },
    }
  },
})

export const listEndpointStates = query({
  args: { domain: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.data-exchange.view")
    return args.domain
      ? ctx.db.query("iikoEndpointStates").withIndex("by_domain", (q) => q.eq("domain", args.domain)).paginate(args.paginationOpts)
      : ctx.db.query("iikoEndpointStates").withIndex("by_endpoint_key").paginate(args.paginationOpts)
  },
})

export const listImportRuns = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.data-exchange.view")
    return ctx.db.query("iikoImportRuns").order("desc").paginate(args.paginationOpts)
  },
})

/** Sandyq restaurants with their confirmed iiko department, and the iiko departments to choose from. */
export const restaurantLinkOptions = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireOfficeCapability(ctx, "office.data-exchange.view")
    const network = user.restaurantScopes.includes("*")
    // Every active restaurant, not only those with a POS terminal: an iiko branch gets its terminals from the
    // import, and the import needs this link first.
    const active = await ctx.db.query("restaurants").withIndex("by_active_and_name", (q) => q.eq("active", true)).take(200)
    const restaurants = active.filter((restaurant) => network || user.restaurantScopes.includes(restaurant.externalId))
    const allDepartments = await ctx.db.query("iikoDepartments").take(200)
    const departments = allDepartments.filter((department) => department.type === "DEPARTMENT")
    const rows = []
    for (const restaurant of restaurants) {
      const link = await ctx.db.query("restaurantSourceLinks").withIndex("by_restaurant", (q) => q.eq("restaurantExternalId", restaurant.externalId)).first()
      const department = link ? departments.find((row) => row.externalId === link.iikoDepartmentExternalId) : null
      rows.push({ restaurantExternalId: restaurant.externalId, restaurantName: restaurant.name, fromIiko: restaurant.sourceSystem === "iiko-server", iikoDepartmentExternalId: link?.iikoDepartmentExternalId ?? null, iikoDepartmentName: department?.name ?? null, confirmedBy: link?.confirmedBy ?? null, confirmedAt: link?.confirmedAt ?? null })
    }
    return { restaurants: rows, departments: departments.map((row) => ({ externalId: row.externalId, name: row.name, code: row.code ?? null })) }
  },
})

/** One iiko department ↔ one Sandyq restaurant; relinking replaces the previous link of either side. */
export async function linkDepartment(ctx: MutationCtx, args: { restaurantExternalId: string; iikoDepartmentExternalId?: string; confirmedBy: string }) {
  for (const link of await ctx.db.query("restaurantSourceLinks").withIndex("by_restaurant", (q) => q.eq("restaurantExternalId", args.restaurantExternalId)).take(10)) await ctx.db.delete(link._id)
  if (!args.iikoDepartmentExternalId) return
  const department = await ctx.db.query("iikoDepartments").withIndex("by_external_id", (q) => q.eq("externalId", args.iikoDepartmentExternalId!)).unique()
  if (!department || department.type !== "DEPARTMENT") throw new ConvexError("Подразделение iiko не найдено")
  for (const link of await ctx.db.query("restaurantSourceLinks").withIndex("by_department", (q) => q.eq("iikoDepartmentExternalId", args.iikoDepartmentExternalId!)).take(10)) await ctx.db.delete(link._id)
  await ctx.db.insert("restaurantSourceLinks", { restaurantExternalId: args.restaurantExternalId, iikoDepartmentExternalId: args.iikoDepartmentExternalId, confirmedBy: args.confirmedBy, confirmedAt: Date.now() })
  // The import creates a restaurant per iiko department until it is linked; once the department belongs to a
  // Sandyq restaurant, that stand-in is switched off so the terminal picker shows the branch once.
  const standIn = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.iikoDepartmentExternalId!)).unique()
  if (standIn && standIn.externalId !== args.restaurantExternalId && standIn.sourceSystem === "iiko-server" && standIn.active) await ctx.db.patch(standIn._id, { active: false })
}

export const linkRestaurantToIikoDepartment = mutation({
  args: { restaurantExternalId: v.string(), iikoDepartmentExternalId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.data-exchange.edit")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.restaurantExternalId)).unique()
    if (!restaurant) throw new ConvexError("Ресторан не найден")
    await linkDepartment(ctx, { restaurantExternalId: args.restaurantExternalId, iikoDepartmentExternalId: args.iikoDepartmentExternalId, confirmedBy: email })
    await writeOfficeAudit(ctx, email, {
      action: "iiko.restaurant.link",
      summary: args.iikoDepartmentExternalId ? `«${restaurant.name}» сопоставлен с подразделением iiko ${args.iikoDepartmentExternalId}` : `Снято сопоставление «${restaurant.name}» с iiko`,
      resourceType: "restaurant",
      resourceExternalId: restaurant.externalId,
      restaurantExternalId: restaurant.externalId,
      capability: "office.data-exchange.edit",
    })
  },
})
