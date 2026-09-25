import { ConvexError } from "convex/values"
import type { GenericMutationCtx } from "convex/server"

import type { DataModel, Doc } from "../_generated/dataModel"
import { nextNumber } from "./numbering"
import { businessDateFor } from "./time"

type MutationCtx = GenericMutationCtx<DataModel>
export type ObligationKind = "supplier" | "service" | "tax" | "payroll" | "other"

// Obligations (W2-FIN-09): what we owe (payable) or are owed (receivable), as «accounts-payable» finance
// records. Documents create them when posted; payments settle them (W2-FIN-10). `amount` is the open
// remainder; data keeps the original and the settled part. One source can have several, told apart by `part`.

export const obligationExternalId = (sourceModuleId: string, sourceExternalId: string, part = "main") => `obligation:${sourceModuleId}:${sourceExternalId}:${part}`

export async function createObligation(
  ctx: MutationCtx,
  args: { restaurantExternalId: string; direction: "payable" | "receivable"; amount: number; name: string; kind: ObligationKind; sourceModuleId: string; sourceExternalId: string; sourceNumber: string; part?: string; dueDate?: string; counterpartyExternalId?: string; occurredAt: number },
) {
  const externalId = obligationExternalId(args.sourceModuleId, args.sourceExternalId, args.part)
  const existing = await ctx.db.query("financeRecords").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (existing) return existing
  const amount = Math.round(args.amount)
  if (amount <= 0) return null
  const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.restaurantExternalId)).unique()
  if (!restaurant) throw new ConvexError("Ресторан не найден")
  const businessDate = businessDateFor(args.occurredAt, restaurant.businessDayCutoffMinutes)
  const number = await nextNumber(ctx, { moduleId: "accounts-payable", prefix: "ОБ", organizationExternalId: restaurant.organizationExternalId, businessDate })
  const now = Date.now()
  const id = await ctx.db.insert("financeRecords", {
    externalId,
    moduleId: "accounts-payable",
    number,
    name: args.name,
    status: "posted",
    organizationExternalId: restaurant.organizationExternalId,
    restaurantExternalId: restaurant.externalId,
    businessDate,
    amount,
    ...(args.counterpartyExternalId ? { counterpartyExternalId: args.counterpartyExternalId } : {}),
    data: { direction: args.direction, originalAmount: amount, allocatedAmount: 0, dueDate: args.dueDate ?? null, sourceModuleId: args.sourceModuleId, sourceExternalId: args.sourceExternalId, sourceNumber: args.sourceNumber, obligationKind: args.kind },
    searchText: `${number} ${args.name} ${args.sourceNumber}`.toLocaleLowerCase("ru"),
    version: 1,
    createdAt: now,
    updatedAt: now,
    postedAt: now,
  })
  return (await ctx.db.get(id))!
}

export async function getObligation(ctx: MutationCtx, externalId: string) {
  const row = await ctx.db.query("financeRecords").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  return row?.moduleId === "accounts-payable" ? row : null
}

/** Settles `amount` of an obligation (negative to release it on a payment reversal). */
export async function allocateObligation(ctx: MutationCtx, obligation: Doc<"financeRecords">, amount: number) {
  const allocated = Number(obligation.data.allocatedAmount ?? 0) + amount
  const original = Number(obligation.data.originalAmount ?? obligation.amount)
  if (amount > 0 && amount > obligation.amount) throw new ConvexError("Сумма платежа превышает открытый остаток")
  if (allocated < 0) throw new ConvexError("Нельзя снять больше, чем распределено")
  await ctx.db.patch(obligation._id, { amount: original - allocated, data: { ...obligation.data, allocatedAmount: allocated }, version: obligation.version + 1, updatedAt: Date.now() })
}

/** Cancels the obligations of a reversed document; refused while anything is settled against them. */
export async function cancelObligations(ctx: MutationCtx, sourceModuleId: string, sourceExternalId: string, parts: string[] = ["main"]) {
  for (const part of parts) {
    const row = await getObligation(ctx, obligationExternalId(sourceModuleId, sourceExternalId, part))
    if (!row || row.status === "reversed") continue
    if (Number(row.data.allocatedAmount ?? 0) > 0) throw new ConvexError("Сначала сторнируйте распределённые платежи")
    await ctx.db.patch(row._id, { status: "reversed", amount: 0, reversedAt: Date.now(), version: row.version + 1, updatedAt: Date.now() })
  }
}

/** A supplier's counterparty in finance: the one linked, or the one with the same BIN. */
export async function supplierCounterparty(ctx: MutationCtx, supplier: Doc<"suppliers">) {
  if (supplier.counterpartyExternalId) return supplier.counterpartyExternalId
  if (!supplier.bin) return undefined
  return (await ctx.db.query("financeRecords").withIndex("by_bin", (q) => q.eq("bin", supplier.bin)).take(5)).find((row) => row.moduleId === "counterparties")?.externalId
}

/** Due date N days after a date (YYYY-MM-DD). */
export const dueAfter = (businessDate: string, days: number) => new Date(Date.parse(`${businessDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
