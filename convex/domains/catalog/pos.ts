import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { mutation, query, type MutationCtx, type QueryCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { writeAudit } from "../../lib/audit"
import { requireManagerApproval, requireOperator } from "../../lib/auth"
import { stopListActive, stopListRow } from "../../lib/availability"
import { loadModifierAssignments } from "../../lib/modifierPricing"
import { getOfficeAuthEmail, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"
import { appendOutboxEvent } from "../../lib/outbox"
import { resolvePrice, resolveSizedPrice } from "../../lib/pricing"

// POS catalog (W1-CAT-12/13/14): product configuration, cashier favorites, branch stop list.
// The restaurant always comes from the operator's session, never from an argument.

const FAVORITES_LIMIT = 60

async function productByExternalId(ctx: QueryCtx, externalId: string) {
  return ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
}

async function imageUrl(ctx: QueryCtx, product: Doc<"products">) {
  if (product.imageStorageId) return ctx.storage.getUrl(product.imageStorageId)
  return product.imagePath ?? null
}

/** Everything the size and modifier dialog needs in one call (prices at the server's now). */
export const getProductConfiguration = query({
  args: { sessionToken: v.string(), productExternalId: v.string() },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const restaurantExternalId = access.restaurant.externalId
    const product = await productByExternalId(ctx, args.productExternalId)
    if (!product) return null
    const at = Date.now()
    const [price, stop, options, assignments] = await Promise.all([
      resolvePrice(ctx, { product, restaurantExternalId, at }),
      stopListRow(ctx, product._id, restaurantExternalId),
      product.sizeScaleId ? ctx.db.query("sizeOptions").withIndex("by_scale_sort", (q) => q.eq("scaleId", product.sizeScaleId!)).take(20) : Promise.resolve([]),
      loadModifierAssignments(ctx, product),
    ])
    const sizes = await Promise.all(
      options.map(async (option) => ({
        externalId: option.externalId,
        label: option.label,
        labelKk: option.labelKk ?? null,
        price: (await resolveSizedPrice(ctx, { product, restaurantExternalId, at, sizeOption: option })).price,
        isDefault: option.isDefault,
        available: option.available,
      })),
    )
    const groupRows = await ctx.db.query("productModifierGroups").withIndex("by_product", (q) => q.eq("productId", product._id)).take(20)
    const groupDocs = await Promise.all(groupRows.map((row) => ctx.db.get(row.groupId)))
    return {
      product: {
        externalId: product.externalId,
        name: product.name,
        nameKk: product.nameKk,
        imageUrl: await imageUrl(ctx, product),
        price: price.price,
        prepArea: product.prepArea ?? "hot",
        available: product.enabled && !stopListActive(stop, at),
      },
      sizes,
      groups: assignments.map((group, index) => ({
        groupExternalId: groupDocs[index]?.externalId ?? "",
        name: groupDocs[index]?.name ?? "",
        required: group.required,
        minQuantity: group.minQuantity,
        maxQuantity: group.maxQuantity,
        freeQuantity: group.freeQuantity,
        enforceItemLimits: group.enforceItemLimits,
        options: group.rules.map((rule) => ({
          externalId: rule.modifier.externalId,
          name: rule.modifier.name,
          price: rule.modifier.price,
          imageUrl: null,
          minQuantity: rule.minQuantity,
          maxQuantity: rule.maxQuantity,
          defaultQuantity: rule.defaultQuantity,
          freeQuantity: rule.freeQuantity,
          available: rule.modifier.available,
        })),
      })),
    }
  },
})

export const favoriteIds = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const rows = await ctx.db.query("employeeFavorites").withIndex("by_employee", (q) => q.eq("employeeId", access.employee._id)).take(FAVORITES_LIMIT)
    const products = await Promise.all(rows.map((row) => ctx.db.get(row.productId)))
    return products.filter((product): product is Doc<"products"> => Boolean(product)).map((product) => product.externalId)
  },
})

/** The cashier's favorites, priced for the session's restaurant; hidden and stop-listed dishes left out. */
export const favoriteProducts = query({
  args: { sessionToken: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const restaurantExternalId = access.restaurant.externalId
    const at = Date.now()
    const page = await ctx.db.query("employeeFavorites").withIndex("by_employee", (q) => q.eq("employeeId", access.employee._id)).order("desc").paginate(args.paginationOpts)
    const rows = []
    for (const favorite of page.page) {
      const product = await ctx.db.get(favorite.productId)
      if (!product?.enabled || stopListActive(await stopListRow(ctx, product._id, restaurantExternalId), at)) continue
      const { basePrice: _base, ...rest } = product
      rows.push({ ...rest, price: (await resolvePrice(ctx, { product, restaurantExternalId, at })).price })
    }
    return { ...page, page: rows }
  },
})

export const toggleFavorite = mutation({
  args: { sessionToken: v.string(), productExternalId: v.string() },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const product = await productByExternalId(ctx, args.productExternalId)
    if (!product) throw new ConvexError("Блюдо не найдено")
    const existing = await ctx.db.query("employeeFavorites").withIndex("by_employee_product", (q) => q.eq("employeeId", access.employee._id).eq("productId", product._id)).unique()
    if (existing) {
      await ctx.db.delete(existing._id)
      await writeAudit(ctx, access, { action: "pos.favorite.remove", summary: `Убрано из избранного: ${product.name}` })
      return { favorite: false }
    }
    const count = (await ctx.db.query("employeeFavorites").withIndex("by_employee", (q) => q.eq("employeeId", access.employee._id)).take(FAVORITES_LIMIT)).length
    if (count >= FAVORITES_LIMIT) throw new ConvexError(`В избранном не больше ${FAVORITES_LIMIT} блюд`)
    await ctx.db.insert("employeeFavorites", { employeeId: access.employee._id, productId: product._id, createdAt: Date.now() })
    await writeAudit(ctx, access, { action: "pos.favorite.add", summary: `Добавлено в избранное: ${product.name}` })
    return { favorite: true }
  },
})

async function writeAvailability(
  ctx: MutationCtx,
  product: Doc<"products">,
  restaurantExternalId: string,
  value: { available: boolean; reason?: string; until?: number; updatedBy: string },
) {
  const existing = await stopListRow(ctx, product._id, restaurantExternalId)
  const row = { available: value.available, reason: value.reason?.trim() || undefined, until: value.available ? undefined : value.until, updatedBy: value.updatedBy, updatedAt: Date.now() }
  if (existing) await ctx.db.patch(existing._id, row)
  else await ctx.db.insert("productAvailability", { productId: product._id, restaurantExternalId, ...row })
  await appendOutboxEvent(ctx, { aggregateType: "product", aggregateExternalId: product.externalId, eventType: "stop-list.changed", restaurantExternalId, payload: { available: value.available } })
}

/** Office: branch availability from the product card. */
export const setAvailability = mutation({
  args: { productExternalId: v.string(), restaurantExternalId: v.string(), available: v.boolean(), reason: v.optional(v.string()), until: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.nomenclature.edit")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    const product = await productByExternalId(ctx, args.productExternalId)
    if (!product) throw new ConvexError("Блюдо не найдено")
    await writeAvailability(ctx, product, args.restaurantExternalId, { available: args.available, reason: args.reason, until: args.until, updatedBy: email })
    await writeOfficeAudit(ctx, email, {
      action: "catalog.stop-list",
      summary: `«${product.name}» ${args.available ? "снова в продаже" : "в стоп-листе"}${args.reason ? `: ${args.reason}` : ""}`,
      resourceType: "product",
      resourceExternalId: product.externalId,
      restaurantExternalId: args.restaurantExternalId,
      capability: "office.nomenclature.edit",
    })
  },
})

/** POS: a manager marks a dish «закончилось» (or back) at their own branch. */
export const setAvailabilityFromPos = mutation({
  args: { sessionToken: v.string(), productExternalId: v.string(), available: v.boolean(), reason: v.string(), managerApprovalToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const manager = await requireManagerApproval(ctx, args.managerApprovalToken, access.restaurant._id)
    const product = await productByExternalId(ctx, args.productExternalId)
    if (!product) throw new ConvexError("Блюдо не найдено")
    if (!args.available && args.reason.trim().length < 3) throw new ConvexError("Укажите причину")
    await writeAvailability(ctx, product, access.restaurant.externalId, { available: args.available, reason: args.reason, updatedBy: access.employee.code })
    await writeAudit(ctx, access, { action: "catalog.stop-list", summary: `«${product.name}» ${args.available ? "снова в продаже" : `в стоп-листе: ${args.reason.trim()}`}`, managerId: manager._id })
  },
})
