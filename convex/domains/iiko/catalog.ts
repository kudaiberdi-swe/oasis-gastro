import { v } from "convex/values"
import type { GenericMutationCtx } from "convex/server"

import type { DataModel, Doc, Id } from "../../_generated/dataModel"
import { almatyDayStart } from "../../lib/time"
import { mirrored, resolveRestaurantForDepartment } from "./projections"

type MutationCtx = GenericMutationCtx<DataModel>
type Result = { changed: boolean; skipped?: string }

// iiko catalog projections (W1-IIKO-04, W2-IIKO-08/09; decision Б-B4 of 2026-09-26): the Sandyq groups
// of the shared iiko nomenclature become product groups, dishes / preparations / goods, recipe versions
// and branch prices. iiko stays read-only; every edit made in the office lives in the overlay
// (iikoEntityOverlays) or in Sandyq's own rows, and a re-import never overwrites it.

const SOURCE = "iiko-server" as const
const NO_GROUP = "iiko-no-group"

export const productGroupArgs = { externalId: v.string(), parentExternalId: v.optional(v.string()), name: v.string(), position: v.optional(v.number()), deleted: v.boolean(), payloadHash: v.string() }

export const productArgs = {
  externalId: v.string(),
  name: v.string(),
  num: v.optional(v.string()),
  parentExternalId: v.optional(v.string()),
  type: v.string(), // DISH | PREPARED | GOODS | …
  unitExternalId: v.optional(v.string()),
  unitName: v.optional(v.string()),
  defaultSalePrice: v.optional(v.number()),
  includedInMenu: v.boolean(),
  unitWeightKg: v.optional(v.number()),
  /** "bar" when the product sits in a bar group of iiko; otherwise the kitchen. */
  prepArea: v.optional(v.string()),
  /** A seed product with the same name (matched by the import script) that this iiko product becomes. */
  matchProductExternalId: v.optional(v.string()),
  deleted: v.boolean(),
  payloadHash: v.string(),
}

export const recipeChartArgs = {
  externalId: v.string(),
  assembledProductExternalId: v.string(),
  dateFrom: v.string(), // YYYY-MM-DD
  assembledAmount: v.number(),
  technology: v.optional(v.string()),
  // departmentExternalIds: the Sandyq departments a line is limited to (absent = all of them).
  items: v.array(v.object({ productExternalId: v.string(), amountIn: v.number(), amountMiddle: v.number(), amountOut: v.number(), departmentExternalIds: v.optional(v.array(v.string())) })),
  payloadHash: v.string(),
}

export const priceArgs = { departmentExternalId: v.string(), productExternalId: v.string(), price: v.number(), payloadHash: v.string() }

const groupExternalId = (iikoId: string) => `iiko-group-${iikoId}`

function productUnit(unitName: string | undefined): Doc<"products">["baseUnit"] {
  const name = (unitName ?? "").trim().toLocaleLowerCase("ru").replace(/\.$/, "")
  if (name === "кг" || name === "kg") return "кг"
  if (name === "л" || name === "l") return "л"
  if (name.startsWith("порц") || name === "portion") return "порц."
  return "шт"
}

async function ensureNoGroupCategory(ctx: MutationCtx) {
  const existing = await ctx.db.query("categories").withIndex("by_external_id", (q) => q.eq("externalId", NO_GROUP)).unique()
  if (!existing) await ctx.db.insert("categories", { externalId: NO_GROUP, label: "Без группы (iiko)", shortLabel: "Без группы", sortOrder: 999, active: true, sourceSystem: SOURCE })
}

export async function applyProductGroup(ctx: MutationCtx, args: { externalId: string; parentExternalId?: string; name: string; position?: number; deleted: boolean; payloadHash: string }): Promise<Result> {
  const mirror = await mirrored(ctx, "v2/entities/products/group/list", args.externalId, args.payloadHash)
  if (mirror.unchanged) return { changed: false }
  const externalId = groupExternalId(args.externalId)
  const existing = await ctx.db.query("categories").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  const name = args.name.trim() || "Группа iiko"
  const value = { label: name, shortLabel: name.slice(0, 24), sortOrder: args.position ?? 500, active: !args.deleted, parentExternalId: args.parentExternalId ? groupExternalId(args.parentExternalId) : undefined, sourceSystem: SOURCE, sourceHash: args.payloadHash, importedAt: Date.now() }
  if (existing) await ctx.db.patch(existing._id, value)
  else await ctx.db.insert("categories", { externalId, ...value })
  await mirror.save()
  return { changed: true }
}

async function overlayOf(ctx: MutationCtx, productExternalId: string) {
  return ctx.db.query("iikoEntityOverlays").withIndex("by_overlay_key", (q) => q.eq("overlayKey", `product:${productExternalId}`)).unique()
}

/**
 * DISH → a dish; PREPARED → a preparation product plus its stock item; GOODS → a stock item (and a sold
 * good when iiko includes it in the menu). A new iiko dish stays hidden from the POS until the office
 * shows it (Б-B4); a seed product with the same name is linked instead of duplicated and keeps its
 * names, Kazakh name, photo, branch prices and POS visibility.
 */
export async function applyProduct(ctx: MutationCtx, args: {
  externalId: string
  name: string
  num?: string
  parentExternalId?: string
  type: string
  unitExternalId?: string
  unitName?: string
  defaultSalePrice?: number
  includedInMenu: boolean
  unitWeightKg?: number
  prepArea?: string
  matchProductExternalId?: string
  deleted: boolean
  payloadHash: string
}): Promise<Result> {
  const itemType: Doc<"products">["itemType"] | null = args.type === "DISH" ? "dish" : args.type === "PREPARED" ? "preparation" : args.type === "GOODS" ? "good" : null
  if (!itemType) return { changed: false, skipped: `«${args.name}»: тип ${args.type} не переносится` }
  const mirror = await mirrored(ctx, "v2/entities/products/list", args.externalId, args.payloadHash)
  if (mirror.unchanged) return { changed: false }

  const now = Date.now()
  const name = args.name.trim() || "Без названия"
  const unit = productUnit(args.unitName)
  const category = args.parentExternalId ? groupExternalId(args.parentExternalId) : NO_GROUP
  if (!args.parentExternalId) await ensureNoGroupCategory(ctx)
  const sold = itemType !== "good" || args.includedInMenu

  let product: Doc<"products"> | null = null
  if (sold) {
    product = await ctx.db.query("products").withIndex("by_iiko_product", (q) => q.eq("iikoProductExternalId", args.externalId)).first()
    if (!product && args.matchProductExternalId) {
      const seed = await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", args.matchProductExternalId!)).unique()
      if (seed && !seed.iikoProductExternalId && seed.sourceSystem !== SOURCE) {
        // The seed product becomes the iiko one: only the link and the source revision change.
        await ctx.db.patch(seed._id, { iikoProductExternalId: args.externalId, sourceRevision: args.payloadHash, importedAt: now })
        product = (await ctx.db.get(seed._id))!
      }
    }
    if (!product || product.sourceSystem === SOURCE) {
      const externalId = product?.externalId ?? `iiko-product-${args.externalId}`
      const overlay = await overlayOf(ctx, externalId)
      const label = overlay?.label ?? name
      const nameKk = overlay?.labelKk ?? product?.nameKk ?? ""
      const sku = args.num?.trim() || args.externalId.slice(0, 8)
      const value = {
        name: label,
        nameKk,
        nameSort: label.toLocaleLowerCase("ru"),
        searchText: `${label} ${nameKk} ${sku}`.toLocaleLowerCase("ru"),
        category,
        basePrice: overlay?.localSettings?.price ?? Math.max(0, Math.round(args.defaultSalePrice ?? 0)),
        popular: overlay?.popular ?? product?.popular ?? false,
        sku,
        baseUnit: unit,
        // Hidden until the office shows it; deleted in iiko → hidden whatever the overlay says.
        enabled: !args.deleted && (overlay?.visibleInPos ?? product?.enabled ?? false),
        itemType,
        prepArea: overlay?.prepArea ?? product?.prepArea ?? args.prepArea ?? "hot",
        writeOffMethod: overlay?.localSettings?.writeOffMethod ?? product?.writeOffMethod ?? (itemType === "dish" ? ("ingredients" as const) : ("finished-product" as const)),
        unitWeightKg: overlay?.localSettings?.unitWeightKg ?? (args.unitWeightKg && args.unitWeightKg > 0 ? args.unitWeightKg : undefined),
        sourceSystem: SOURCE,
        sourceHash: args.payloadHash,
        importedAt: now,
        sourceDeleted: args.deleted,
        sourceReadOnly: true,
        iikoProductExternalId: args.externalId,
      }
      if (product) await ctx.db.patch(product._id, value)
      else {
        const id = await ctx.db.insert("products", { externalId, description: "", categorySort: 99, ...value })
        product = (await ctx.db.get(id))!
      }
    }
  }

  if (itemType !== "dish") {
    const existing = await ctx.db.query("inventoryItems").withIndex("by_iiko_product", (q) => q.eq("iikoProductExternalId", args.externalId)).first()
    const kind = itemType === "preparation" ? ("preparation" as const) : sold ? ("good" as const) : ("ingredient" as const)
    const value = {
      name,
      nameSort: name.toLocaleLowerCase("ru"),
      searchText: `${name} ${args.num ?? ""}`.toLocaleLowerCase("ru"),
      unit,
      unitExternalId: args.unitExternalId ? `iiko-unit-${args.unitExternalId}` : undefined,
      active: !args.deleted,
      kind,
      productExternalId: product?.externalId,
      sourceSystem: SOURCE,
      importedAt: now,
      iikoProductExternalId: args.externalId,
    }
    if (existing) await ctx.db.patch(existing._id, value)
    else await ctx.db.insert("inventoryItems", { externalId: `iiko-item-${args.externalId}`, ...value })
  }
  await mirror.save()
  return { changed: true }
}

/** The stock item or the preparation product an iiko product id stands for in a recipe. */
async function componentOf(ctx: MutationCtx, iikoProductExternalId: string) {
  const product = await ctx.db.query("products").withIndex("by_iiko_product", (q) => q.eq("iikoProductExternalId", iikoProductExternalId)).first()
  if (product?.itemType === "preparation") return { kind: "preparation" as const, product }
  const item = await ctx.db.query("inventoryItems").withIndex("by_iiko_product", (q) => q.eq("iikoProductExternalId", iikoProductExternalId)).first()
  if (item) return { kind: "item" as const, item }
  return null
}

const lossPercent = (before: number, after: number) => (before > 0 ? Math.min(100, Math.max(0, Math.round((1 - after / before) * 10000) / 100)) : 0)

/**
 * An iiko assembly chart becomes a recipe version «из iiko»: brutto = amountIn, cold loss from amountMiddle,
 * hot loss from amountOut, the batch = assembledAmount. A changed chart adds a new version from the import
 * date (history stays for past sales); Sandyq's own versions are never touched — the later one wins by date.
 */
export async function applyRecipeChart(ctx: MutationCtx, args: { externalId: string; assembledProductExternalId: string; dateFrom: string; assembledAmount: number; technology?: string; items: { productExternalId: string; amountIn: number; amountMiddle: number; amountOut: number; departmentExternalIds?: string[] }[]; payloadHash: string }): Promise<Result> {
  const mirror = await mirrored(ctx, "v2/assemblyCharts/getAll", args.externalId, args.payloadHash)
  if (mirror.unchanged) return { changed: false }
  const product = await ctx.db.query("products").withIndex("by_iiko_product", (q) => q.eq("iikoProductExternalId", args.assembledProductExternalId)).first()
  if (!product) return { changed: false, skipped: `техкарта ${args.externalId}: блюдо не импортировано` }

  const lines: Omit<Doc<"recipeLines">, "_id" | "_creationTime" | "versionId">[] = []
  const missing: string[] = []
  for (const [index, item] of args.items.entries()) {
    if (!(item.amountIn > 0)) continue
    const component = await componentOf(ctx, item.productExternalId)
    if (!component || (component.kind === "preparation" && component.product._id === product._id)) {
      missing.push(item.productExternalId)
      continue
    }
    const unit = component.kind === "item" ? component.item.unit : component.product.baseUnit
    const lineUnit = unit === "кг" || unit === "л" ? unit : "шт"
    const weight = component.kind === "preparation" ? component.product.unitWeightKg : undefined
    lines.push({
      kind: component.kind,
      inventoryItemId: component.kind === "item" ? component.item._id : undefined,
      componentProductId: component.kind === "preparation" ? component.product._id : undefined,
      name: component.kind === "item" ? component.item.name : component.product.name,
      unit: lineUnit,
      quantity: Math.round(item.amountIn * 1000) / 1000,
      unitWeightKg: lineUnit === "кг" ? 1 : (weight ?? 1),
      coldLossPercent: lossPercent(item.amountIn, item.amountMiddle),
      hotLossPercent: lossPercent(item.amountMiddle, item.amountOut),
      sortOrder: index,
      ...(item.departmentExternalIds?.length ? { iikoDepartmentExternalIds: item.departmentExternalIds } : {}),
    })
  }
  if (!lines.length) return { changed: false, skipped: `техкарта «${product.name}»: ни одного ингредиента из импортированных` }

  const now = Date.now()
  let recipe = await ctx.db.query("recipes").withIndex("by_product", (q) => q.eq("productId", product._id)).first()
  if (!recipe) recipe = (await ctx.db.get(await ctx.db.insert("recipes", { productId: product._id, createdAt: now })))!
  const previous = await ctx.db.query("recipeVersions").withIndex("by_iiko_chart", (q) => q.eq("iikoChartExternalId", args.externalId)).order("desc").first()
  const last = await ctx.db.query("recipeVersions").withIndex("by_recipe_version", (q) => q.eq("recipeId", recipe._id)).order("desc").first()
  const chartStart = almatyDayStart(args.dateFrom)
  const versionId: Id<"recipeVersions"> = await ctx.db.insert("recipeVersions", {
    recipeId: recipe._id,
    productId: product._id,
    version: (last?.version ?? 0) + 1,
    effectiveFrom: previous ? Math.max(chartStart, now) : chartStart,
    batchYield: args.assembledAmount > 0 ? args.assembledAmount : 1,
    technology: (args.technology ?? "").slice(0, 4000),
    status: "active",
    createdBy: "iiko",
    createdAt: now,
    sourceSystem: SOURCE,
    iikoChartExternalId: args.externalId,
    sourceHash: args.payloadHash,
  })
  if (previous?.status === "active") await ctx.db.patch(previous._id, { status: "superseded" })
  for (const line of lines) await ctx.db.insert("recipeLines", { versionId, ...line })
  if (!recipe.activeVersionId || previous?._id === recipe.activeVersionId) await ctx.db.patch(recipe._id, { activeVersionId: versionId })
  await mirror.save()
  return { changed: true, skipped: missing.length ? `техкарта «${product.name}»: пропущено ингредиентов — ${missing.length}` : undefined }
}

/**
 * iiko's price of a product in a department → the branch price of the linked restaurant. A branch price set
 * in Sandyq (a row without sourceSystem) wins; a difference is reported for reconciliation.
 */
export async function applyPrice(ctx: MutationCtx, args: { departmentExternalId: string; productExternalId: string; price: number; payloadHash: string }): Promise<Result> {
  const restaurant = await resolveRestaurantForDepartment(ctx, args.departmentExternalId)
  if (!restaurant) return { changed: false, skipped: `цены подразделения ${args.departmentExternalId}: не сопоставлено с рестораном` }
  const product = await ctx.db.query("products").withIndex("by_iiko_product", (q) => q.eq("iikoProductExternalId", args.productExternalId)).first()
  if (!product) return { changed: false }
  const price = Math.round(args.price)
  if (!(price >= 0)) return { changed: false }
  const existing = await ctx.db.query("productPrices").withIndex("by_product_restaurant", (q) => q.eq("productId", product._id).eq("restaurantExternalId", restaurant.externalId)).unique()
  if (existing && !existing.sourceSystem) {
    return existing.priceKzt === price ? { changed: false } : { changed: false, skipped: `«${product.name}» в «${restaurant.name}»: цена Sandyq ${existing.priceKzt} ₸, в iiko ${price} ₸` }
  }
  if (existing?.sourceHash === args.payloadHash) return { changed: false }
  const value = { priceKzt: price, sourceSystem: SOURCE, sourceHash: args.payloadHash, importedAt: Date.now() }
  if (existing) await ctx.db.patch(existing._id, value)
  else await ctx.db.insert("productPrices", { productId: product._id, restaurantExternalId: restaurant.externalId, ...value })
  return { changed: true }
}
