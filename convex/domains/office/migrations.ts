import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import { internalMutation } from "../../_generated/server"

/**
 * migration-batch M-6 (W1-ACL-02): fills organizationScopes / warehouseScopes of office users that
 * predate them. Administrators get ["*"]/["*"]; others the organizations of their restaurants and
 * ["*"] warehouses until warehouse scopes are assigned (W1 stock). Run page by page until isDone.
 */
export const m6BackfillScopes = internalMutation({
  args: { paginationOpts: paginationOptsValidator, dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("officeUsers").withIndex("by_external_id").paginate(args.paginationOpts)
    let patched = 0
    let skipped = 0
    for (const user of page.page) {
      if (user.organizationScopes && user.warehouseScopes) {
        skipped += 1
        continue
      }
      const role = await ctx.db.query("officeRoles").withIndex("by_external_id", (q) => q.eq("externalId", user.roleExternalId)).unique()
      const administrator = user.roleExternalId === "administrator" || role?.capabilities.includes("*") || user.restaurantScopes.includes("*")
      let organizationScopes = user.organizationScopes
      if (!organizationScopes) {
        if (administrator) organizationScopes = ["*"]
        else {
          const organizations = new Set<string>()
          for (const externalId of user.restaurantScopes) {
            const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
            if (restaurant) organizations.add(restaurant.organizationExternalId)
          }
          organizationScopes = [...organizations]
        }
      }
      patched += 1
      if (!args.dryRun) await ctx.db.patch(user._id, { organizationScopes, warehouseScopes: user.warehouseScopes ?? ["*"] })
    }
    return { scanned: page.page.length, patched, skipped, isDone: page.isDone, continueCursor: page.continueCursor, dryRun: args.dryRun ?? false }
  },
})
