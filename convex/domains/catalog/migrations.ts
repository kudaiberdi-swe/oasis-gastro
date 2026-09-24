import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import { internalMutation } from "../../_generated/server"

/** Kitchen area of a category (W1-CAT-01 table): drinks → bar, bakery → bakery, salads/cold → cold, rest → hot. */
export function categoryPrepArea(label: string | undefined): "bar" | "bakery" | "cold" | "hot" {
  const text = (label ?? "").toLocaleLowerCase("ru")
  if (/напит|сусын|фреш|лимонад|шай|чай|кофе/.test(text)) return "bar"
  if (/выпечк|нан-тоқаш|нан |хлеб|десерт|тәтті/.test(text)) return "bakery"
  if (/салат|салам|деликатес|тіскебасар|холодн/.test(text)) return "cold"
  return "hot"
}

/**
 * migration-batch M-1: products created before catalog v2 get itemType "dish", writeOffMethod
 * "ingredients", prepArea from their category and customizable false. unitWeightKg is left unset
 * (never invented). Idempotent; run page by page until isDone.
 */
export const m1BackfillProducts = internalMutation({
  args: { paginationOpts: paginationOptsValidator, dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("products").withIndex("by_external_id").paginate(args.paginationOpts)
    const categoryLabels = new Map<string, string>()
    let patched = 0
    for (const product of page.page) {
      if (product.itemType && product.writeOffMethod && product.prepArea && product.customizable !== undefined) continue
      if (!categoryLabels.has(product.category)) {
        const category = await ctx.db.query("categories").withIndex("by_external_id", (q) => q.eq("externalId", product.category)).unique()
        categoryLabels.set(product.category, category?.label ?? "")
      }
      patched += 1
      if (!args.dryRun) {
        await ctx.db.patch(product._id, {
          itemType: product.itemType ?? "dish",
          writeOffMethod: product.writeOffMethod ?? "ingredients",
          prepArea: product.prepArea ?? categoryPrepArea(categoryLabels.get(product.category)),
          customizable: product.customizable ?? false,
        })
      }
    }
    return { scanned: page.page.length, patched, isDone: page.isDone, continueCursor: page.continueCursor, dryRun: args.dryRun ?? false }
  },
})

/** migration-batch M-1b: moves legacy untyped iikoEntityOverlays.data into the typed fields. */
export const m1bOverlays = internalMutation({
  args: { paginationOpts: paginationOptsValidator, dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("iikoEntityOverlays").withIndex("by_overlay_key").paginate(args.paginationOpts)
    let patched = 0
    for (const overlay of page.page) {
      const data = overlay.data as Record<string, unknown> | undefined
      if (!data || typeof data !== "object") continue
      const text = (key: string) => (typeof data[key] === "string" ? (data[key] as string) : undefined)
      const flag = (key: string) => (typeof data[key] === "boolean" ? (data[key] as boolean) : undefined)
      const price = typeof data.price === "number" ? data.price : undefined
      patched += 1
      if (!args.dryRun) {
        await ctx.db.patch(overlay._id, {
          sourceSystem: "iiko-server",
          label: overlay.label ?? text("label"),
          labelKk: overlay.labelKk ?? text("labelKk"),
          visibleInPos: overlay.visibleInPos ?? flag("visibleInPos"),
          popular: overlay.popular ?? flag("popular"),
          prepArea: overlay.prepArea ?? text("prepArea"),
          localSettings: overlay.localSettings ?? (price !== undefined ? { price } : undefined),
          updatedAt: overlay.updatedAt ?? Date.now(),
          data: undefined,
        })
      }
    }
    return { scanned: page.page.length, patched, isDone: page.isDone, continueCursor: page.continueCursor, dryRun: args.dryRun ?? false }
  },
})
