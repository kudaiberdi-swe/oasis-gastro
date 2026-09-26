import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { mutation, query, type MutationCtx, type QueryCtx } from "../../_generated/server"
import type { Doc, Id } from "../../_generated/dataModel"
import { getOfficeAuthEmail, requireOfficeCapability, restaurantScopeFilter, scopedRestaurants, writeOfficeAudit } from "../../lib/officeAccess"
import { stopListActive, stopListRow } from "../../lib/availability"
import { resolvePrice } from "../../lib/pricing"
import { categoryColorToken, unit } from "../../lib/validators"
import { normalizeBarcode } from "./queries"

// Office catalog (W1-CAT-03…06): product groups, nomenclature register, product card, images.

const MAX_GROUP_DEPTH = 5
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const itemType = v.union(v.literal("dish"), v.literal("good"), v.literal("preparation"))
const writeOffMethod = v.union(v.literal("ingredients"), v.literal("finished-product"))

async function categoryByExternalId(ctx: QueryCtx, externalId: string) {
  return ctx.db.query("categories").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
}

/** Walks up from the new parent: the group itself must not appear, and the tree stays ≤ 5 levels. */
async function assertNoCategoryCycle(ctx: QueryCtx, externalId: string | undefined, parentExternalId: string | undefined) {
  let depth = 1
  let current = parentExternalId
  while (current) {
    if (current === externalId) throw new ConvexError("Группа не может быть вложена сама в себя")
    depth += 1
    if (depth > MAX_GROUP_DEPTH) throw new ConvexError(`Вложенность групп — не больше ${MAX_GROUP_DEPTH} уровней`)
    const parent = await categoryByExternalId(ctx, current)
    if (!parent) throw new ConvexError("Родительская группа не найдена")
    current = parent.parentExternalId
  }
}

export const listProductGroups = query({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.product-groups.view")
    const groups = await ctx.db.query("categories").withIndex("by_sort_order").take(200)
    return groups
      .filter((group) => args.includeInactive || group.active !== false)
      .map((group) => ({
        externalId: group.externalId,
        label: group.label,
        shortLabel: group.shortLabel,
        sortOrder: group.sortOrder,
        parentExternalId: group.parentExternalId ?? null,
        active: group.active !== false,
        colorToken: group.colorToken ?? null,
      }))
  },
})

export const saveProductGroup = mutation({
  args: {
    externalId: v.optional(v.string()),
    label: v.string(),
    shortLabel: v.string(),
    parentExternalId: v.optional(v.string()),
    sortOrder: v.number(),
    active: v.boolean(),
    // The POS strip color: a cat-* token; null — back to the guess from the label; omitted — unchanged.
    colorToken: v.optional(v.union(categoryColorToken, v.null())),
  },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.product-groups.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const label = args.label.trim()
    if (!label) throw new ConvexError("Укажите название группы")
    if (!Number.isInteger(args.sortOrder)) throw new ConvexError("Порядок — целое число")
    const existing = args.externalId ? await categoryByExternalId(ctx, args.externalId) : null
    if (args.externalId && !existing) throw new ConvexError("Группа не найдена")
    const parentExternalId = args.parentExternalId || undefined
    await assertNoCategoryCycle(ctx, existing?.externalId, parentExternalId)
    if (existing && existing.active !== false && !args.active) {
      const activeProduct = await ctx.db.query("products").withIndex("by_enabled_and_category_and_name", (q) => q.eq("enabled", true).eq("category", existing.externalId)).first()
      if (activeProduct) throw new ConvexError("В группе есть активные блюда")
    }
    const value = {
      label,
      shortLabel: args.shortLabel.trim() || label,
      parentExternalId,
      sortOrder: args.sortOrder,
      active: args.active,
      ...(args.colorToken !== undefined ? { colorToken: args.colorToken ?? undefined } : {}),
    }
    let externalId: string
    if (existing) {
      await ctx.db.patch(existing._id, value)
      externalId = existing.externalId
    } else {
      externalId = `group-${crypto.randomUUID()}`
      await ctx.db.insert("categories", { externalId, ...value })
    }
    await writeOfficeAudit(ctx, email, { action: "catalog.group.save", summary: `Группа «${label}»`, resourceType: "category", resourceExternalId: externalId, capability: "office.product-groups.edit" })
    return externalId
  },
})

async function imageUrlOf(ctx: QueryCtx, product: Doc<"products">, overlay?: Doc<"iikoEntityOverlays"> | null) {
  const storageId = overlay?.imageStorageId ?? product.imageStorageId
  if (storageId) return ctx.storage.getUrl(storageId)
  return product.imagePath ?? null
}

async function overlayOf(ctx: QueryCtx, product: Doc<"products">) {
  if (product.sourceSystem !== "iiko-server") return null
  return ctx.db.query("iikoEntityOverlays").withIndex("by_entity_type_and_source_external_id", (q) => q.eq("entityType", "product").eq("sourceExternalId", product.externalId)).unique()
}

/** «Номенклатура» register: indexes for sort, filter and search, never take + in-memory filter. */
export const listNomenclature = query({
  args: {
    search: v.optional(v.string()),
    categoryExternalId: v.optional(v.string()),
    itemType: v.optional(itemType),
    status: v.optional(v.union(v.literal("active"), v.literal("hidden"), v.literal("all"))),
    sort: v.optional(v.union(v.literal("name"), v.literal("price"), v.literal("category"))),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.nomenclature.view")
    const inScope = restaurantScopeFilter(user)
    const status = args.status ?? "all"
    const enabled = status === "all" ? undefined : status === "active"
    const search = args.search?.trim()

    const base = search
      ? ctx.db.query("products").withSearchIndex("search_products", (q) => {
          let builder = q.search("searchText", search.toLocaleLowerCase("ru"))
          if (enabled !== undefined) builder = builder.eq("enabled", enabled)
          if (args.categoryExternalId) builder = builder.eq("category", args.categoryExternalId)
          return builder
        })
      : args.categoryExternalId
        ? enabled !== undefined
          ? ctx.db.query("products").withIndex("by_enabled_and_category_and_name", (q) => q.eq("enabled", enabled).eq("category", args.categoryExternalId!))
          : ctx.db.query("products").withIndex("by_category_name", (q) => q.eq("category", args.categoryExternalId!))
        : args.sort === "price"
          ? ctx.db.query("products").withIndex("by_price")
          : args.sort === "category"
            ? ctx.db.query("products").withIndex("by_category_name")
            : enabled !== undefined
              ? ctx.db.query("products").withIndex("by_enabled_and_name", (q) => q.eq("enabled", enabled))
              : ctx.db.query("products").withIndex("by_enabled_and_name")
    const needsEnabledFilter = !search && !args.categoryExternalId && (args.sort === "price" || args.sort === "category") && enabled !== undefined
    const page = await base
      .filter((q) =>
        q.and(needsEnabledFilter ? q.eq(q.field("enabled"), enabled!) : true, args.itemType ? q.eq(q.field("itemType"), args.itemType) : true),
      )
      .paginate(args.paginationOpts)

    const categories = new Map<string, string>()
    const rows = await Promise.all(
      page.page.map(async (product) => {
        if (!categories.has(product.category)) categories.set(product.category, (await categoryByExternalId(ctx, product.category))?.label ?? "Без группы")
        const overlay = await overlayOf(ctx, product)
        // One row per branch at most, so this read is bounded by the number of restaurants.
        const allPrices = await ctx.db.query("productPrices").withIndex("by_product_restaurant", (q) => q.eq("productId", product._id)).take(100)
        const prices = allPrices.filter((price) => inScope(price.restaurantExternalId))
        const amounts = prices.length ? prices.map((price) => price.priceKzt) : [product.basePrice]
        return {
          _id: product._id,
          externalId: product.externalId,
          name: overlay?.label ?? product.name,
          nameKk: overlay?.labelKk ?? product.nameKk,
          description: product.description,
          imageUrl: await imageUrlOf(ctx, product, overlay),
          category: { externalId: product.category, label: categories.get(product.category)! },
          basePrice: product.basePrice,
          priceRange: { min: Math.min(...amounts), max: Math.max(...amounts) },
          settingsSummary: "стандарт" as const,
          itemType: product.itemType ?? "dish",
          enabled: product.enabled,
          sku: product.sku,
          sourceSystem: product.sourceSystem ?? "sandyq",
        }
      }),
    )
    return { ...page, page: rows }
  },
})

/** Product card (W1-CAT-05): overlay applied, branch prices of restaurants in scope, price in force now. */
export const getProductCard = query({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.nomenclature.view")
    const product = await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!product) return null
    const overlay = await overlayOf(ctx, product)
    const restaurants = await scopedRestaurants(ctx, user)
    const now = Date.now()
    const branchPrices = await Promise.all(
      restaurants.map(async (restaurant) => {
        const own = await ctx.db
          .query("productPrices")
          .withIndex("by_product_restaurant", (q) => q.eq("productId", product._id).eq("restaurantExternalId", restaurant.externalId))
          .unique()
        const resolved = await resolvePrice(ctx, { product, restaurantExternalId: restaurant.externalId, at: now })
        const stop = await stopListRow(ctx, product._id, restaurant.externalId)
        return {
          restaurantExternalId: restaurant.externalId,
          name: restaurant.name,
          priceKzt: own?.priceKzt ?? null,
          resolvedPriceNow: resolved,
          availability: { available: !stopListActive(stop, now), reason: stop?.reason ?? null, until: stop?.until ?? null },
        }
      }),
    )
    const category = await categoryByExternalId(ctx, product.category)
    return {
      productId: product._id,
      externalId: product.externalId,
      name: overlay?.label ?? product.name,
      nameKk: overlay?.labelKk ?? product.nameKk,
      description: product.description,
      categoryExternalId: product.category,
      categoryLabel: category?.label ?? null,
      itemType: product.itemType ?? "dish",
      prepArea: overlay?.prepArea ?? product.prepArea ?? "hot",
      writeOffMethod: overlay?.localSettings?.writeOffMethod ?? product.writeOffMethod ?? "ingredients",
      sku: product.sku,
      barcode: product.barcode ?? "",
      basePrice: overlay?.localSettings?.price ?? product.basePrice,
      baseUnit: product.baseUnit,
      unitWeightKg: overlay?.localSettings?.unitWeightKg ?? product.unitWeightKg ?? null,
      technology: product.technology ?? "",
      enabled: overlay?.visibleInPos ?? product.enabled,
      imageUrl: await imageUrlOf(ctx, product, overlay),
      branchPrices,
      modifierGroupCount: (await ctx.db.query("productModifierGroups").withIndex("by_product", (q) => q.eq("productId", product._id)).take(20)).length,
      sizeScaleExternalId: product.sizeScaleId ? ((await ctx.db.get(product.sizeScaleId))?.externalId ?? null) : null,
      source: product.sourceSystem === "iiko-server" ? ("iiko-server" as const) : ("sandyq" as const),
    }
  },
})

/** A barcode for the POS scanner: digits, Latin letters and «-», up to 64; one product per code. "" clears it. */
async function checkedBarcode(ctx: QueryCtx, product: Doc<"products">, raw: string): Promise<string | undefined> {
  const barcode = normalizeBarcode(raw)
  if (!barcode) return undefined
  if (raw.replace(/\s+/g, "").length > 64 || !/^[0-9A-Za-z-]+$/.test(barcode)) throw new ConvexError("Штрихкод — цифры и латинские буквы, не длиннее 64 символов")
  const taken = await ctx.db.query("products").withIndex("by_barcode", (q) => q.eq("barcode", barcode)).first()
  if (taken && taken._id !== product._id) throw new ConvexError(`Штрихкод уже у «${taken.name}»`)
  return barcode
}

function productSearchText(name: string, nameKk: string, sku: string) {
  return `${name} ${nameKk} ${sku}`.toLocaleLowerCase("ru")
}

export const saveProductCard = mutation({
  args: {
    externalId: v.string(),
    name: v.string(),
    nameKk: v.string(),
    description: v.string(),
    categoryExternalId: v.string(),
    itemType,
    prepArea: v.string(),
    writeOffMethod,
    sku: v.string(),
    basePrice: v.number(),
    baseUnit: unit,
    unitWeightKg: v.optional(v.number()),
    technology: v.optional(v.string()),
    enabled: v.boolean(),
    // W3-POS-01: omitted — left as is; "" — removed.
    barcode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.nomenclature.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const product = await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!product) throw new ConvexError("Блюдо не найдено")
    const barcode = args.barcode === undefined ? product.barcode : await checkedBarcode(ctx, product, args.barcode)
    const name = args.name.trim()
    if (!name) throw new ConvexError("Укажите название")
    if (!Number.isInteger(args.basePrice) || args.basePrice < 0 || args.basePrice > 100_000_000) throw new ConvexError("Цена — целое число от 0 до 100 000 000 ₸")
    if ((args.baseUnit === "л" || args.baseUnit === "шт") && args.unitWeightKg !== undefined && args.unitWeightKg <= 0) throw new ConvexError("Вес одной единицы должен быть больше нуля")
    if (!(await categoryByExternalId(ctx, args.categoryExternalId))) throw new ConvexError("Группа не найдена")

    const changed: string[] = []
    if (product.sourceSystem === "iiko-server") {
      // iiko owns the canonical product; local edits live in the overlay (re-import never clobbers them).
      const overlay = await overlayOf(ctx, product)
      const value = {
        label: name,
        labelKk: args.nameKk.trim(),
        prepArea: args.prepArea,
        visibleInPos: args.enabled,
        localSettings: { ...(overlay?.localSettings ?? {}), price: args.basePrice, writeOffMethod: args.writeOffMethod, unitWeightKg: args.unitWeightKg },
        sourceSystem: "iiko-server" as const,
        updatedBy: email,
        updatedAt: Date.now(),
      }
      if (overlay) await ctx.db.patch(overlay._id, value)
      else await ctx.db.insert("iikoEntityOverlays", { overlayKey: `product:${product.externalId}`, entityType: "product", sourceExternalId: product.externalId, ...value })
      // The product row is what the POS reads: mirror the overlay onto it now (the next import keeps it — W1-IIKO-04).
      const nameKk = args.nameKk.trim()
      await ctx.db.patch(product._id, { name, nameKk, nameSort: name.toLocaleLowerCase("ru"), searchText: productSearchText(name, nameKk, product.sku), prepArea: args.prepArea, enabled: args.enabled && !product.sourceDeleted, writeOffMethod: args.writeOffMethod, unitWeightKg: args.unitWeightKg, barcode })
      changed.push("overlay")
      if (barcode !== product.barcode) changed.push("barcode")
    } else {
      const next = {
        name,
        nameKk: args.nameKk.trim(),
        nameSort: name.toLocaleLowerCase("ru"),
        searchText: productSearchText(name, args.nameKk.trim(), args.sku.trim()),
        description: args.description.trim(),
        category: args.categoryExternalId,
        itemType: args.itemType,
        prepArea: args.prepArea,
        writeOffMethod: args.writeOffMethod,
        sku: args.sku.trim(),
        basePrice: args.basePrice,
        baseUnit: args.baseUnit,
        unitWeightKg: args.unitWeightKg,
        technology: args.technology?.trim() || undefined,
        enabled: args.enabled,
        barcode,
      }
      for (const [key, value] of Object.entries(next)) if ((product as Record<string, unknown>)[key] !== value) changed.push(key)
      await ctx.db.patch(product._id, next)
    }
    await writeOfficeAudit(ctx, email, {
      action: "catalog.product.update",
      summary: `Изменено «${name}»`,
      resourceType: "product",
      resourceExternalId: product.externalId,
      capability: "office.nomenclature.edit",
      details: { changed },
    })
    return { changed }
  },
})

/**
 * «Показать блюда iiko с ценой» (W1-IIKO-04, decision Б-B4): iiko dishes arrive hidden; this shows on the POS
 * every iiko dish that has an iiko branch price in a restaurant of the user's scope — what iiko actually
 * sells there. A dish the office hid on purpose (overlay «В продаже» off) and one deleted in iiko stay hidden.
 * Paged over productPrices; `dryRun` only counts.
 */
export const showPricedIikoDishes = mutation({
  args: { paginationOpts: paginationOptsValidator, dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.nomenclature.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const inScope = restaurantScopeFilter(user)
    const page = await ctx.db.query("productPrices").withIndex("by_restaurant").paginate(args.paginationOpts)
    const seen = new Set<string>()
    const ids: Id<"products">[] = []
    let shown = 0
    for (const price of page.page) {
      if (price.sourceSystem !== "iiko-server" || !inScope(price.restaurantExternalId) || seen.has(price.productId)) continue
      seen.add(price.productId)
      const product = await ctx.db.get(price.productId)
      if (!product || product.sourceSystem !== "iiko-server" || product.itemType !== "dish" || product.enabled || product.sourceDeleted) continue
      const overlay = await overlayOf(ctx, product)
      if (overlay?.visibleInPos === false) continue
      shown += 1
      ids.push(product._id)
      if (args.dryRun) continue
      await ctx.db.patch(product._id, { enabled: true })
      const value = { visibleInPos: true, sourceSystem: "iiko-server" as const, updatedBy: email, updatedAt: Date.now() }
      if (overlay) await ctx.db.patch(overlay._id, value)
      else await ctx.db.insert("iikoEntityOverlays", { overlayKey: `product:${product.externalId}`, entityType: "product", sourceExternalId: product.externalId, ...value })
    }
    if (shown && !args.dryRun) {
      await writeOfficeAudit(ctx, email, { action: "catalog.product.update", summary: `Показано на кассе блюд iiko с ценой: ${shown}`, resourceType: "product", resourceExternalId: "iiko-priced-dishes", capability: "office.nomenclature.edit", details: { shown } })
    }
    // The dry run's ids let the office count each dish once across pages (a dish is priced in several branches).
    return { shown, productIds: args.dryRun ? ids : [], isDone: page.isDone, continueCursor: page.continueCursor, dryRun: args.dryRun ?? false }
  },
})

/** Upload URL for an image; the file is checked and attached by attachProductImage. */
export const generateImageUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireOfficeCapability(ctx, "office.nomenclature.edit").catch(async (error) => {
      if (error instanceof ConvexError && error.data === "Недостаточно прав") return requireOfficeCapability(ctx, "office.modifiers.edit")
      throw error
    })
    return ctx.storage.generateUploadUrl()
  },
})

async function checkedImage(ctx: MutationCtx, storageId: Id<"_storage">) {
  const file = await ctx.db.system.get(storageId)
  if (!file) throw new ConvexError("Файл не найден")
  // Uploads from the office always send the file's type; the size limit holds regardless.
  if ((file.contentType !== undefined && !file.contentType.startsWith("image/")) || file.size > MAX_IMAGE_BYTES) {
    await ctx.storage.delete(storageId)
    throw new ConvexError("Нужно изображение до 2 МБ")
  }
  return file
}

export const attachProductImage = mutation({
  args: { productExternalId: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.nomenclature.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const product = await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", args.productExternalId)).unique()
    if (!product) {
      await ctx.storage.delete(args.storageId)
      throw new ConvexError("Блюдо не найдено")
    }
    await checkedImage(ctx, args.storageId)
    if (product.sourceSystem === "iiko-server") {
      const overlay = await overlayOf(ctx, product)
      if (overlay?.imageStorageId && overlay.imageStorageId !== args.storageId) await ctx.storage.delete(overlay.imageStorageId)
      if (overlay) await ctx.db.patch(overlay._id, { imageStorageId: args.storageId, updatedBy: email, updatedAt: Date.now() })
      else await ctx.db.insert("iikoEntityOverlays", { overlayKey: `product:${product.externalId}`, entityType: "product", sourceExternalId: product.externalId, sourceSystem: "iiko-server", imageStorageId: args.storageId, updatedBy: email, updatedAt: Date.now() })
    } else {
      if (product.imageStorageId && product.imageStorageId !== args.storageId) await ctx.storage.delete(product.imageStorageId)
      await ctx.db.patch(product._id, { imageStorageId: args.storageId })
    }
    await writeOfficeAudit(ctx, email, { action: "catalog.product.image", summary: `Изображение «${product.name}»`, resourceType: "product", resourceExternalId: product.externalId, capability: "office.nomenclature.edit" })
  },
})
