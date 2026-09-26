import { ConvexError, v } from "convex/values"
import type { GenericQueryCtx } from "convex/server"

import type { DataModel, Doc } from "../../_generated/dataModel"
import type { CapabilityAction } from "../../lib/capabilities"

type QueryCtx = GenericQueryCtx<DataModel>

// «План на кухню» and «Ведомость полуфабрикатов» (W3-PRD-07/08) over the productionRecords table.
// A plan is reference data (rights view/edit): draft → active («Утвердить»), draft|active → cancelled.
// A sheet is a document: draft → posted (fact frozen) → reversed, draft → cancelled. Neither moves stock —
// the stock moves through the production acts a sheet makes.

export type ProductionRecord = Doc<"productionRecords">
export type RecordModule = ProductionRecord["moduleId"]
export type RecordStatus = ProductionRecord["status"]
export type RecordAction = "approve" | "post" | "reverse" | "cancel"

export const MODULE = v.union(v.literal("kitchen-plan"), v.literal("semi-finished-sheet"))
export const STATUS = v.union(v.literal("draft"), v.literal("active"), v.literal("posted"), v.literal("reversed"), v.literal("cancelled"))
export const ACTION = v.union(v.literal("approve"), v.literal("post"), v.literal("reverse"), v.literal("cancel"))

export const MODULES: Record<RecordModule, { prefix: string; label: string; transitions: Partial<Record<RecordAction, { from: RecordStatus[]; to: RecordStatus; capability: CapabilityAction }>> }> = {
  "kitchen-plan": {
    prefix: "ПК",
    label: "План на кухню",
    transitions: {
      approve: { from: ["draft"], to: "active", capability: "edit" },
      cancel: { from: ["draft", "active"], to: "cancelled", capability: "edit" },
    },
  },
  "semi-finished-sheet": {
    prefix: "ВП",
    label: "Ведомость полуфабрикатов",
    transitions: {
      post: { from: ["draft"], to: "posted", capability: "post" },
      reverse: { from: ["posted"], to: "reversed", capability: "reverse" },
      cancel: { from: ["draft"], to: "cancelled", capability: "cancel" },
    },
  },
}

export const recordCap = (moduleId: RecordModule, action: CapabilityAction) => `office.${moduleId}.${action}`

export async function requireRestaurant(ctx: QueryCtx, externalId: string) {
  const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!restaurant) throw new ConvexError("Ресторан не найден")
  return restaurant
}

export async function recordOf(ctx: QueryCtx, externalId: string) {
  return ctx.db.query("productionRecords").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
}

/** The live record of a restaurant and date (not cancelled or reversed), if any — one per day. */
export async function openRecordOf(ctx: QueryCtx, moduleId: RecordModule, restaurantExternalId: string, businessDate: string) {
  const records = await ctx.db
    .query("productionRecords")
    .withIndex("by_module_restaurant_date", (q) => q.eq("moduleId", moduleId).eq("restaurantExternalId", restaurantExternalId).eq("businessDate", businessDate))
    .take(50)
  return records.find((record) => record.status !== "cancelled" && record.status !== "reversed") ?? null
}

export function searchTextOf(record: Pick<ProductionRecord, "number" | "businessDate" | "comment" | "lines">) {
  return [record.number, record.businessDate, record.comment, ...record.lines.map((line) => line.name)].join(" ").toLocaleLowerCase("ru")
}

/** Restaurant warehouses a sheet's production act can use: the kitchen first, then the sales default. */
export async function restaurantWarehouses(ctx: QueryCtx, restaurantExternalId: string) {
  const warehouses = await ctx.db.query("warehouses").withIndex("by_restaurant_active", (q) => q.eq("restaurantExternalId", restaurantExternalId).eq("active", true)).take(50)
  const rank = (warehouse: Doc<"warehouses">) => (warehouse.kind === "kitchen" ? 0 : warehouse.isSalesDefault ? 1 : 2)
  return warehouses.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "ru")).map((warehouse) => ({ externalId: warehouse.externalId, name: warehouse.name, kind: warehouse.kind }))
}
