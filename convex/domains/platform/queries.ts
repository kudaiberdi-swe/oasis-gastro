import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { query } from "../../_generated/server"
import { effectiveScopes, hasNetworkScope, hasScope, requireOfficeCapability, requireRestaurantScope, restaurantScopeFilter, scopedRestaurants } from "../../lib/officeAccess"
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

/** «Терминалы» (W1-ADM-01): terminals of restaurants in scope, by restaurant and status. */
export const listTerminals = query({
  args: { restaurantExternalId: v.optional(v.string()), status: v.optional(v.union(v.literal("active"), v.literal("inactive"))), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.terminals.view")
    const inScope = restaurantScopeFilter(user, args.restaurantExternalId)
    const restaurants = await scopedRestaurants(ctx, user)
    const byId = new Map(restaurants.map((restaurant) => [restaurant._id, restaurant]))
    const requested = args.restaurantExternalId ? restaurants.find((restaurant) => restaurant.externalId === args.restaurantExternalId) : undefined
    if (args.restaurantExternalId && !requested) return { page: [], isDone: true, continueCursor: "" }
    const active = args.status === undefined ? undefined : args.status === "active"
    const base = requested
      ? ctx.db.query("posTerminals").withIndex("by_restaurant_active_and_number", (q) => (active === undefined ? q.eq("restaurantId", requested._id) : q.eq("restaurantId", requested._id).eq("active", active)))
      : ctx.db.query("posTerminals").withIndex("by_external_id")
    const result = await base.filter((q) => (active === undefined || requested ? true : q.eq(q.field("active"), active))).paginate(args.paginationOpts)
    return {
      ...result,
      page: result.page
        .map((terminal) => ({ terminal, restaurant: byId.get(terminal.restaurantId) }))
        .filter(({ restaurant }) => restaurant && inScope(restaurant.externalId))
        .map(({ terminal, restaurant }) => ({
          externalId: terminal.externalId,
          name: terminal.name,
          terminalNumber: terminal.terminalNumber,
          kind: terminal.kind ?? "pos",
          active: terminal.active,
          lastLoginAt: terminal.lastLoginAt ?? null,
          appVersion: terminal.appVersion ?? null,
          heartbeatUrl: terminal.heartbeatUrl ?? null,
          sourceReadOnly: terminal.sourceReadOnly ?? false,
          version: terminal.version ?? 1,
          restaurantExternalId: restaurant!.externalId,
          restaurantName: restaurant!.name,
        })),
    }
  },
})

/** «Закрытие периода» (W1-ADM-03): locks of the user's organizations, newest first. */
export const listPeriodLocks = query({
  args: { status: v.optional(v.union(v.literal("active"), v.literal("reopened"))), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.document-locks.view")
    const scopes = await effectiveScopes(ctx, user, role)
    const inScope = restaurantScopeFilter(user)
    const result = await ctx.db
      .query("periodLocks")
      .withIndex("by_external_id")
      .order("desc")
      .filter((q) => (args.status === undefined ? true : q.eq(q.field("active"), args.status === "active")))
      .paginate(args.paginationOpts)
    return {
      ...result,
      page: result.page
        .filter((lock) => hasScope(scopes.organizationScopes, lock.organizationExternalId) && (lock.restaurantExternalId ? inScope(lock.restaurantExternalId) : true))
        .map((lock) => ({ ...lock, lockedThroughDate: lockedThroughDate(lock.lockedThrough) })),
    }
  },
})

/**
 * Start page (W1-ADM-05): aggregates only — revenue, paid orders and average check from the sales facts
 * with the previous period for the delta, posted and draft documents, exchange errors, the restaurants
 * with their turnover and whether a shift ran today, and 30 days of revenue for the chart.
 */
export const dashboard = query({
  args: { restaurantExternalId: v.optional(v.string()), from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.dashboard.view")
    if (args.restaurantExternalId) await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.from) || !/^\d{4}-\d{2}-\d{2}$/.test(args.to) || args.from > args.to) throw new ConvexError("Укажите период")
    const scoped = await scopedRestaurants(ctx, user)
    const restaurants = args.restaurantExternalId ? scoped.filter((row) => row.externalId === args.restaurantExternalId) : scoped
    const dayMs = 86_400_000
    const shift = (date: string, by: number) => new Date(Date.parse(`${date}T00:00:00Z`) + by * dayMs).toISOString().slice(0, 10)
    const days = (Date.parse(`${args.to}T00:00:00Z`) - Date.parse(`${args.from}T00:00:00Z`)) / dayMs + 1
    const previousFrom = shift(args.from, -days)
    const seriesFrom = shift(args.to, -29)
    const from = Date.parse(`${args.from}T00:00:00+05:00`)
    const to = Date.parse(`${args.to}T23:59:59+05:00`)
    const todayStart = Date.parse(`${args.to}T00:00:00+05:00`)
    const series = new Map<string, number>()
    let revenue = 0
    let previousRevenue = 0
    let orders = 0
    let previousOrders = 0
    let postedDocuments = 0
    let draftDocuments = 0
    const rows = []
    for (const restaurant of restaurants) {
      let net = 0
      let count = 0
      const start = previousFrom < seriesFrom ? previousFrom : seriesFrom
      for await (const fact of ctx.db.query("dailySalesFacts").withIndex("by_restaurant_type_date", (q) => q.eq("restaurantExternalId", restaurant.externalId).eq("factType", "branch").gte("businessDate", start).lte("businessDate", args.to))) {
        const value = fact.netAmount - fact.refundAmount
        if (fact.businessDate >= seriesFrom) series.set(fact.businessDate, (series.get(fact.businessDate) ?? 0) + value)
        if (fact.businessDate >= args.from) {
          net += value
          count += fact.orderCount
        } else if (fact.businessDate >= previousFrom && fact.businessDate < args.from) {
          previousRevenue += value
          previousOrders += fact.orderCount
        }
      }
      revenue += net
      orders += count
      let documents = 0
      for (const status of ["posted", "draft"] as const) {
        const receipts = await ctx.db.query("receipts").withIndex("by_restaurant_status_date", (q) => (status === "posted" ? q.eq("restaurantExternalId", restaurant.externalId).eq("status", status).gte("date", from).lte("date", to) : q.eq("restaurantExternalId", restaurant.externalId).eq("status", status))).take(200)
        let total = receipts.length
        for (const type of ["inventory", "transfer", "writeoff", "outgoing-invoice", "supplier-return"] as const) {
          const docs = await ctx.db.query("stockDocuments").withIndex("by_type_restaurant_status_date", (q) => (status === "posted" ? q.eq("type", type).eq("restaurantExternalId", restaurant.externalId).eq("status", status).gte("date", from).lte("date", to) : q.eq("type", type).eq("restaurantExternalId", restaurant.externalId).eq("status", status))).take(200)
          total += docs.length
        }
        if (status === "posted") {
          postedDocuments += total
          documents += total
        } else draftDocuments += total
      }
      const lastShift = await ctx.db.query("shifts").withIndex("by_restaurant_opened", (q) => q.eq("restaurantId", restaurant._id)).order("desc").first()
      const working = Boolean(lastShift && (lastShift.status === "open" || (lastShift.closedAt ?? 0) >= todayStart))
      rows.push({ restaurantExternalId: restaurant.externalId, name: restaurant.name, documents, turnover: net, orders: count, status: working ? ("working" as const) : ("no-shifts" as const) })
    }
    const organizations = new Set(restaurants.map((row) => row.organizationExternalId))
    let exchangeErrors = 0
    for (const status of ["failed", "dead-letter"] as const) {
      const jobs = await ctx.db.query("integrationJobs").withIndex("by_status_attempt", (q) => q.eq("status", status)).take(200)
      exchangeErrors += jobs.filter((job) => !job.organizationExternalId || organizations.has(job.organizationExternalId) || user.restaurantScopes.includes("*")).length
    }
    return {
      revenue,
      previousRevenue,
      orders,
      previousOrders,
      averageCheck: orders ? Math.round(revenue / orders) : 0,
      postedDocuments,
      draftDocuments,
      exchangeErrors,
      restaurants: rows.sort((a, b) => b.turnover - a.turnover),
      series: Array.from({ length: 30 }, (_, index) => shift(seriesFrom, index)).map((date) => ({ date, value: series.get(date) ?? 0 })),
    }
  },
})
