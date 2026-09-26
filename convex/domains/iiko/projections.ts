import { v } from "convex/values"
import type { GenericMutationCtx } from "convex/server"

import type { DataModel, Doc } from "../../_generated/dataModel"

type MutationCtx = GenericMutationCtx<DataModel>

// iiko → Sandyq projections (W1-IIKO-03). Read-only source: each record is mirrored by payload hash and
// projected only when it changed. Stores and terminals need a confirmed restaurant link (W1-IIKO-02).

export const warehouseArgs = { externalId: v.string(), parentExternalId: v.optional(v.string()), code: v.optional(v.string()), name: v.string(), type: v.optional(v.string()), deleted: v.boolean(), payloadHash: v.string() }
export const terminalArgs = { externalId: v.string(), name: v.string(), anonymous: v.boolean(), departmentExternalId: v.optional(v.string()), deleted: v.boolean(), payloadHash: v.string() }
export const unitArgs = { externalId: v.string(), code: v.optional(v.string()), name: v.string(), fullName: v.optional(v.string()), deleted: v.boolean(), payloadHash: v.string() }
export const supplierArgs = { externalId: v.string(), code: v.optional(v.string()), name: v.string(), isSupplier: v.boolean(), deleted: v.boolean(), payloadHash: v.string() }

type Result = { changed: boolean; skipped?: string }

export async function mirrored(ctx: MutationCtx, endpointKey: string, recordExternalId: string, payloadHash: string) {
  const mirrorKey = `${endpointKey}:${recordExternalId}`
  const existing = await ctx.db.query("iikoMirrorRecords").withIndex("by_mirror_key", (q) => q.eq("mirrorKey", mirrorKey)).unique()
  return {
    unchanged: existing?.payloadHash === payloadHash,
    save: async () => {
      const now = Date.now()
      if (existing) await ctx.db.patch(existing._id, { payloadHash, importedAt: now })
      else await ctx.db.insert("iikoMirrorRecords", { mirrorKey, endpointKey, recordExternalId, payloadHash, importedAt: now })
    },
  }
}

/** The Sandyq restaurant linked to an iiko department, or null (then the record is skipped — B-24). */
export async function resolveRestaurantForDepartment(ctx: MutationCtx, departmentExternalId: string | undefined): Promise<Doc<"restaurants"> | null> {
  if (!departmentExternalId) return null
  const link = await ctx.db.query("restaurantSourceLinks").withIndex("by_department", (q) => q.eq("iikoDepartmentExternalId", departmentExternalId)).first()
  if (!link) return null
  return ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", link.restaurantExternalId)).unique()
}

export async function applyWarehouse(ctx: MutationCtx, args: { externalId: string; parentExternalId?: string; code?: string; name: string; type?: string; deleted: boolean; payloadHash: string }): Promise<Result> {
  const mirror = await mirrored(ctx, "corporation/stores", args.externalId, args.payloadHash)
  if (mirror.unchanged) return { changed: false }
  const restaurant = await resolveRestaurantForDepartment(ctx, args.parentExternalId)
  if (!restaurant) return { changed: false, skipped: `склад «${args.name}»: подразделение ${args.parentExternalId ?? "—"} не сопоставлено с рестораном` }
  const existing = await ctx.db.query("warehouses").withIndex("by_iiko_store", (q) => q.eq("iikoStoreExternalId", args.externalId)).unique()
  // Imported fields only; the office keeps its own settings (sales default, negative stock, kind).
  const value = { name: args.name, shortName: args.code || args.name.slice(0, 24), restaurantExternalId: restaurant.externalId, organizationExternalId: restaurant.organizationExternalId, active: !args.deleted, searchText: `${args.name} ${args.code ?? ""}`.toLocaleLowerCase("ru"), sourceSystem: "iiko-server" }
  if (existing) await ctx.db.patch(existing._id, value)
  else await ctx.db.insert("warehouses", { ...value, externalId: `iiko-store-${args.externalId}`, iikoStoreExternalId: args.externalId, kind: "storage", allowNegativeStock: false, internalTransfers: true, isSalesDefault: false })
  await mirror.save()
  return { changed: true }
}

/** A new iiko terminal gets the next free number of its restaurant and stays inactive until the office enables it. */
export async function applyTerminal(ctx: MutationCtx, args: { externalId: string; name: string; anonymous: boolean; departmentExternalId?: string; deleted: boolean; payloadHash: string }): Promise<Result> {
  if (args.anonymous) return { changed: false, skipped: `терминал «${args.name}»: анонимный` }
  const mirror = await mirrored(ctx, "corporation/terminals", args.externalId, args.payloadHash)
  if (mirror.unchanged) return { changed: false }
  const restaurant = await resolveRestaurantForDepartment(ctx, args.departmentExternalId)
  if (!restaurant) return { changed: false, skipped: `терминал «${args.name}»: подразделение ${args.departmentExternalId ?? "—"} не сопоставлено с рестораном` }
  const externalId = `iiko-terminal-${args.externalId}`
  const existing = await ctx.db.query("posTerminals").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (existing) {
    await ctx.db.patch(existing._id, { name: args.name, sourceHash: args.payloadHash, importedAt: Date.now(), ...(args.deleted ? { active: false } : {}) })
  } else {
    const last = await ctx.db.query("posTerminals").withIndex("by_restaurant_number", (q) => q.eq("restaurantId", restaurant._id)).order("desc").first()
    await ctx.db.insert("posTerminals", { externalId, restaurantId: restaurant._id, name: args.name, terminalNumber: (last?.terminalNumber ?? 0) + 1, nextOrderNumber: 1, active: false, kind: "pos", sourceSystem: "iiko-server", sourceReadOnly: true, departmentExternalId: args.departmentExternalId, sourceHash: args.payloadHash, importedAt: Date.now() })
  }
  await mirror.save()
  return { changed: true }
}

const DIMENSIONS: [RegExp, Doc<"units">["dimension"]][] = [
  [/^(кг|г|гр|мг|т|kg|g)$/i, "mass"],
  [/^(л|мл|l|ml)$/i, "volume"],
  [/^(порц|порция|portion)/i, "portion"],
]

export async function applyUnit(ctx: MutationCtx, args: { externalId: string; code?: string; name: string; fullName?: string; deleted: boolean; payloadHash: string }): Promise<Result> {
  const mirror = await mirrored(ctx, "v2/entities/list?rootType=MeasureUnit", args.externalId, args.payloadHash)
  if (mirror.unchanged) return { changed: false }
  const externalId = `iiko-unit-${args.externalId}`
  const shortName = (args.code || args.name).trim()
  const dimension = DIMENSIONS.find(([pattern]) => pattern.test(shortName.replace(/\.$/, "")))?.[1] ?? "count"
  const existing = await ctx.db.query("units").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  const value = { name: args.fullName || args.name, shortName, active: !args.deleted, searchText: `${args.name} ${shortName}`.toLocaleLowerCase("ru"), sourceSystem: "iiko-server", importedAt: Date.now() }
  if (existing) await ctx.db.patch(existing._id, value)
  else await ctx.db.insert("units", { ...value, externalId, dimension, precision: dimension === "count" || dimension === "portion" ? 0 : 3, coefficient: 1 })
  await mirror.save()
  return { changed: true }
}

/** Suppliers only; the BIN stays empty until the office fills it (iiko doesn't give it to the mirror). */
export async function applySupplier(ctx: MutationCtx, args: { externalId: string; code?: string; name: string; isSupplier: boolean; deleted: boolean; payloadHash: string }): Promise<Result> {
  if (!args.isSupplier) return { changed: false }
  const mirror = await mirrored(ctx, "suppliers", args.externalId, args.payloadHash)
  if (mirror.unchanged) return { changed: false }
  const externalId = `iiko-supplier-${args.externalId}`
  const existing = await ctx.db.query("suppliers").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (existing) await ctx.db.patch(existing._id, { name: args.name, active: !args.deleted, searchText: `${args.name} ${existing.bin}`.toLocaleLowerCase("ru") })
  else await ctx.db.insert("suppliers", { externalId, name: args.name, bin: "", supplierType: "external", priceDeviationPolicy: "warn", allowedDeviationPercent: 10, restaurantExternalIds: [], active: !args.deleted, searchText: args.name.toLocaleLowerCase("ru"), sourceSystem: "iiko-server" })
  await mirror.save()
  return { changed: true }
}
