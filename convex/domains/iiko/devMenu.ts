import { v } from "convex/values"

import { internalMutation } from "../../_generated/server"
import { hidePdfMenuPage, showPricedIikoDishesPage } from "../catalog/office"
import { linkDepartment } from "./office"

// Dev deployment tooling for scripts/dev-iiko-menu.mjs (internal: `npx convex run`, never the browser). It does
// on dev what the owner does on prod in the office — link the pilot branches to their iiko departments, show the
// iiko dishes with a branch price, hide the PDF stand-in menu — through the same code the office buttons use.
const ACTOR = "dev-iiko-menu (npx convex run)"

export const linkDepartments = internalMutation({
  args: { links: v.array(v.object({ restaurantExternalId: v.string(), iikoDepartmentExternalId: v.string() })) },
  handler: async (ctx, args) => {
    for (const link of args.links) await linkDepartment(ctx, { ...link, confirmedBy: ACTOR })
    return { linked: args.links.length }
  },
})

export const showIikoMenuPage = internalMutation({
  args: { restaurantExternalIds: v.array(v.string()), cursor: v.union(v.string(), v.null()), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const inScope = (restaurantExternalId: string) => args.restaurantExternalIds.includes(restaurantExternalId)
    return showPricedIikoDishesPage(ctx, { inScope, email: ACTOR, paginationOpts: { numItems: 200, cursor: args.cursor }, dryRun: args.dryRun, auditRestaurantExternalId: args.restaurantExternalIds[0] })
  },
})

export const hidePdfMenuPageDev = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), dryRun: v.optional(v.boolean()) },
  // The journal needs an organization; without an office user it comes from a pilot branch.
  handler: async (ctx, args) => hidePdfMenuPage(ctx, { email: ACTOR, paginationOpts: { numItems: 200, cursor: args.cursor }, dryRun: args.dryRun, auditRestaurantExternalId: "sandyq-almaty" }),
})
