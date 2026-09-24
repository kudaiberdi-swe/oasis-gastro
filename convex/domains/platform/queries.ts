import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { query } from "../../_generated/server"
import { hasNetworkScope, hasScope, requireOfficeCapability, requireRestaurantScope } from "../../lib/officeAccess"
import { findPeriodLocks, lockedThroughDate, periodLockMessage } from "../../lib/periods"

/** For the «Период закрыт» banner on office documents (OFFICE-DESIGN §7). */
export const periodLockFor = query({
  args: { restaurantExternalId: v.string(), businessDate: v.string(), moduleId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, `office.${args.moduleId ?? "document-locks"}.view`)
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.restaurantExternalId)).unique()
    if (!restaurant) return null
    const [lock] = await findPeriodLocks(ctx, {
      organizationExternalId: restaurant.organizationExternalId,
      restaurantExternalId: restaurant.externalId,
      businessDate: args.businessDate,
      moduleId: args.moduleId,
    })
    return lock ? { kind: lock.kind, lockedThroughDate: lockedThroughDate(lock.lockedThrough), message: periodLockMessage(lock) } : null
  },
})

/**
 * «Журнал событий»: POS and office events in one list, newest first, paginated through indexes
 * (never take(1000) + filter). A branch-scoped user reads only their restaurants.
 */
export const auditLog = query({
  args: {
    search: v.optional(v.string()),
    restaurantExternalId: v.optional(v.string()),
    actorKey: v.optional(v.string()),
    action: v.optional(v.string()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.audit-log.view")
    const network = hasNetworkScope(user)
    let restaurantExternalId = args.restaurantExternalId
    if (restaurantExternalId !== undefined) {
      if (!hasScope(user.restaurantScopes, restaurantExternalId)) throw new ConvexError("Нет доступа к ресторану")
    } else if (!network) {
      // A branch user with one restaurant reads it by default; with several they pick one.
      if (user.restaurantScopes.length !== 1) throw new ConvexError("Выберите ресторан")
      restaurantExternalId = user.restaurantScopes[0]
    }
    const from = args.from ?? 0
    const to = args.to ?? Number.MAX_SAFE_INTEGER
    const search = args.search?.trim().toLocaleLowerCase("ru")

    if (search) {
      return ctx.db
        .query("auditEvents")
        .withSearchIndex("search_audit", (q) => {
          let scoped = q.search("searchText", search)
          if (restaurantExternalId) scoped = scoped.eq("restaurantExternalId", restaurantExternalId)
          if (args.action) scoped = scoped.eq("action", args.action)
          return scoped
        })
        .filter((q) => q.and(q.gte(q.field("occurredAt"), from), q.lte(q.field("occurredAt"), to), args.actorKey ? q.eq(q.field("actorKey"), args.actorKey) : true))
        .paginate(args.paginationOpts)
    }

    const base = restaurantExternalId
      ? ctx.db.query("auditEvents").withIndex("by_restaurant_occurred", (q) => q.eq("restaurantExternalId", restaurantExternalId).gte("occurredAt", from).lte("occurredAt", to))
      : args.actorKey
        ? ctx.db.query("auditEvents").withIndex("by_actor_occurred", (q) => q.eq("actorKey", args.actorKey!).gte("occurredAt", from).lte("occurredAt", to))
        : ctx.db.query("auditEvents").withIndex("by_occurred_at", (q) => q.gte("occurredAt", from).lte("occurredAt", to))
    return base
      .order("desc")
      .filter((q) =>
        q.and(args.action ? q.eq(q.field("action"), args.action) : true, restaurantExternalId && args.actorKey ? q.eq(q.field("actorKey"), args.actorKey) : true),
      )
      .paginate(args.paginationOpts)
  },
})
