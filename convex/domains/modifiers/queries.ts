import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import { query } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { requireOfficeCapability } from "../../lib/officeAccess"

function modifierRow(modifier: Doc<"modifiers">, group?: Doc<"modifierGroups"> | null, ingredient?: Doc<"inventoryItems"> | null) {
  return {
    ingredientInventoryItemExternalId: ingredient?.externalId ?? null,
    externalId: modifier.externalId,
    groupExternalId: group?.externalId ?? null,
    groupName: group?.name ?? null,
    name: modifier.name,
    nameKk: modifier.nameKk ?? null,
    price: modifier.price,
    ingredientName: modifier.ingredientName,
    ingredientQuantity: modifier.ingredientQuantity,
    unit: modifier.unit,
    available: modifier.available,
    sortOrder: modifier.sortOrder,
  }
}

export const listGroups = query({
  args: {},
  handler: async (ctx) => {
    await requireOfficeCapability(ctx, "office.modifiers.view")
    const groups = await ctx.db.query("modifierGroups").withIndex("by_name").take(200)
    return groups.map((group) => ({ externalId: group.externalId, name: group.name, nameKk: group.nameKk ?? null, sortOrder: group.sortOrder, active: group.active }))
  },
})

export const list = query({
  args: { groupExternalId: v.optional(v.string()), search: v.optional(v.string()), sort: v.optional(v.union(v.literal("name"), v.literal("price"))), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.modifiers.view")
    const group = args.groupExternalId ? await ctx.db.query("modifierGroups").withIndex("by_external_id", (q) => q.eq("externalId", args.groupExternalId!)).unique() : null
    if (args.groupExternalId && !group) return { page: [], isDone: true, continueCursor: "" }
    const search = args.search?.trim().toLocaleLowerCase("ru")
    const page = search
      ? await ctx.db.query("modifiers").withSearchIndex("search_modifiers", (q) => (group ? q.search("searchText", search).eq("groupId", group._id) : q.search("searchText", search))).paginate(args.paginationOpts)
      : group
        ? await ctx.db.query("modifiers").withIndex(args.sort === "price" ? "by_group_price" : "by_group_name", (q) => q.eq("groupId", group._id)).paginate(args.paginationOpts)
        : await ctx.db.query("modifiers").withIndex(args.sort === "price" ? "by_price" : "by_group_name").paginate(args.paginationOpts)
    const groups = new Map<string, Doc<"modifierGroups"> | null>()
    const rows = []
    for (const modifier of page.page) {
      if (!groups.has(modifier.groupId)) groups.set(modifier.groupId, await ctx.db.get(modifier.groupId))
      rows.push(modifierRow(modifier, groups.get(modifier.groupId), modifier.ingredientInventoryItemId ? await ctx.db.get(modifier.ingredientInventoryItemId) : null))
    }
    return { ...page, page: rows }
  },
})

export const get = query({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.modifiers.view")
    const modifier = await ctx.db.query("modifiers").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    return modifier ? modifierRow(modifier, await ctx.db.get(modifier.groupId), modifier.ingredientInventoryItemId ? await ctx.db.get(modifier.ingredientInventoryItemId) : null) : null
  },
})

/** The dish designer: groups attached to a product with their limits and per-modifier rules. */
export const getProductRules = query({
  args: { productExternalId: v.string() },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.modifiers.view")
    const product = await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", args.productExternalId)).unique()
    if (!product) return null
    const assignments = await ctx.db.query("productModifierGroups").withIndex("by_product", (q) => q.eq("productId", product._id)).take(20)
    return Promise.all(
      assignments.map(async (assignment) => {
        const group = await ctx.db.get(assignment.groupId)
        const rules = await ctx.db.query("productModifierRules").withIndex("by_assignment_sort", (q) => q.eq("productModifierGroupId", assignment._id)).take(50)
        return {
          groupExternalId: group?.externalId ?? null,
          groupName: group?.name ?? null,
          required: assignment.required,
          minQuantity: assignment.minQuantity,
          maxQuantity: assignment.maxQuantity,
          freeQuantity: assignment.freeQuantity,
          enforceItemLimits: assignment.enforceItemLimits,
          sortOrder: assignment.sortOrder,
          rules: await Promise.all(
            rules.map(async (rule) => {
              const modifier = await ctx.db.get(rule.modifierId)
              return { modifierExternalId: modifier?.externalId ?? null, name: modifier?.name ?? null, price: modifier?.price ?? 0, minQuantity: rule.minQuantity, maxQuantity: rule.maxQuantity, defaultQuantity: rule.defaultQuantity, freeQuantity: rule.freeQuantity, sortOrder: rule.sortOrder }
            }),
          ),
        }
      }),
    )
  },
})
