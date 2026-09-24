import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import { query } from "../../_generated/server"
import { requireOperator } from "../../lib/auth"
import { requireOfficeCapability } from "../../lib/officeAccess"
import { SYSTEM_ACCOUNTS } from "../../lib/accounts"
import { activeSettingsAt } from "../../lib/retailSettings"
import { RETAIL_MODULES, retailKind } from "./validators"

function visibleTo(restaurantExternalIds: string[], scopes: string[]) {
  return scopes.includes("*") || restaurantExternalIds.length === 0 || restaurantExternalIds.some((restaurant) => scopes.includes(restaurant))
}

export const listSettings = query({
  args: { kind: retailKind, status: v.optional(v.union(v.literal("draft"), v.literal("published"), v.literal("expired"))), search: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, `office.${RETAIL_MODULES[args.kind]}.view`)
    const needle = args.search?.trim().toLocaleLowerCase("ru")
    const page = needle
      ? await ctx.db.query("retailSettings").withSearchIndex("search_retail_settings", (q) => (args.status ? q.search("searchText", needle).eq("kind", args.kind).eq("status", args.status) : q.search("searchText", needle).eq("kind", args.kind))).paginate(args.paginationOpts)
      : args.status
        ? await ctx.db.query("retailSettings").withIndex("by_kind_status_start", (q) => q.eq("kind", args.kind).eq("status", args.status!)).paginate(args.paginationOpts)
        : await ctx.db.query("retailSettings").withIndex("by_kind_order", (q) => q.eq("kind", args.kind)).paginate(args.paginationOpts)
    return { ...page, page: page.page.filter((row) => visibleTo(row.restaurantExternalIds, user.restaurantScopes)) }
  },
})

export const getSetting = query({
  args: { kind: retailKind, externalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, `office.${RETAIL_MODULES[args.kind]}.view`)
    const row = await ctx.db.query("retailSettings").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    return row && row.kind === args.kind && visibleTo(row.restaurantExternalIds, user.restaurantScopes) ? row : null
  },
})

/** What the terminal's restaurant uses today: published settings of every kind, by sortOrder. */
export const activeForPos = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const now = Date.now()
    const restaurant = access.restaurant.externalId
    const pick = (row: Awaited<ReturnType<typeof activeSettingsAt>>[number]) => ({ externalId: row.externalId, code: row.code, name: row.name, receiptName: row.receiptName ?? row.name, version: row.version, data: row.data })
    const [paymentTypes, orderTypes, discountTypes, deletionReasons, cashOperationTypes] = await Promise.all(
      (["payment-type", "order-type", "discount-type", "deletion-reason", "cash-operation-type"] as const).map((kind) => activeSettingsAt(ctx, kind, restaurant, now)),
    )
    return {
      paymentTypes: paymentTypes.map(pick),
      orderTypes: orderTypes.map(pick),
      discountTypes: discountTypes.map(pick),
      deletionReasons: deletionReasons.map(pick),
      cashOperationTypes: cashOperationTypes.map(pick),
    }
  },
})

/**
 * Accounts a retail setting can point at (payment type account, deletion expense, cash operation
 * accounts). `value` is what the setting stores: the system key for system accounts, else the externalId.
 */
export const accountOptions = query({
  args: { kind: retailKind },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, `office.${RETAIL_MODULES[args.kind]}.view`)
    const keyByExternalId = new Map(Object.entries(SYSTEM_ACCOUNTS).map(([key, account]) => [account.externalId, key]))
    const accounts = await ctx.db.query("accounts").withIndex("by_code").take(200)
    return accounts.filter((account) => account.active).map((account) => ({ value: keyByExternalId.get(account.externalId) ?? account.externalId, code: account.code, name: account.name, type: account.type }))
  },
})
