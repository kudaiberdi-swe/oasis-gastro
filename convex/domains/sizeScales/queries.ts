import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import { query, type QueryCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { requireOfficeCapability } from "../../lib/officeAccess"

async function withOptions(ctx: QueryCtx, scale: Doc<"sizeScales">) {
  const [options, products] = await Promise.all([
    ctx.db.query("sizeOptions").withIndex("by_scale_sort", (q) => q.eq("scaleId", scale._id)).take(50),
    ctx.db.query("products").withIndex("by_size_scale", (q) => q.eq("sizeScaleId", scale._id)).take(200),
  ])
  return {
    externalId: scale.externalId,
    name: scale.name,
    sortOrder: scale.sortOrder,
    options: options.map((option) => ({
      externalId: option.externalId,
      label: option.label,
      labelKk: option.labelKk ?? null,
      kitchenLabel: option.kitchenLabel,
      coefficient: option.coefficient,
      writeOffCoefficient: option.writeOffCoefficient ?? option.coefficient,
      sortOrder: option.sortOrder,
      isDefault: option.isDefault,
      available: option.available,
    })),
    products: products.map((product) => ({ externalId: product.externalId, name: product.name })),
  }
}

/** «Шкалы размеров» (W1-CAT-09). */
export const list = query({
  args: { search: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.size-scales.view")
    const search = args.search?.trim().toLocaleLowerCase("ru")
    const page = search
      ? await ctx.db.query("sizeScales").withSearchIndex("search_size_scales", (q) => q.search("searchText", search)).paginate(args.paginationOpts)
      : await ctx.db.query("sizeScales").withIndex("by_name").paginate(args.paginationOpts)
    return { ...page, page: await Promise.all(page.page.map((scale) => withOptions(ctx, scale))) }
  },
})

export const get = query({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.size-scales.view")
    const scale = await ctx.db.query("sizeScales").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    return scale ? withOptions(ctx, scale) : null
  },
})
