import { ConvexError } from "convex/values"
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server"

import type { DataModel, Doc } from "../_generated/dataModel"
import { isSystemAccountKey, SYSTEM_ACCOUNTS, type SystemAccountKey } from "./accounts"
import { assertPeriodOpen } from "./periods"
import { businessDateFor } from "./time"

type MutationCtx = GenericMutationCtx<DataModel>

export type JournalPosting = {
  /** Idempotency key: a repeat with the same externalId returns the existing entry. */
  externalId: string
  restaurantExternalId: string
  sourceModuleId: string
  sourceExternalId: string
  sourceNumber: string
  occurredAt: number
  /** A SYSTEM_ACCOUNTS key or an account externalId from the chart of accounts — never a name. */
  debitAccount: SystemAccountKey | string
  creditAccount: SystemAccountKey | string
  amount: number
  description: string
  /** Defaults to the restaurant's business date of occurredAt; POS passes the shift's. */
  businessDate?: string
  warehouseExternalId?: string
  quantity?: number
  itemName?: string
  /** Manual office entries may only use accounts that allow them. */
  manual?: boolean
  reversalOf?: Doc<"journalEntries">["_id"]
  /** Service migrations (M-4) write history before any period lock and mark their lines. */
  migration?: "M-4"
}

async function resolveAccount(ctx: MutationCtx, reference: string, manual: boolean) {
  const externalId = isSystemAccountKey(reference) ? SYSTEM_ACCOUNTS[reference].externalId : reference
  const account = await ctx.db.query("accounts").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!account) throw new ConvexError(`Счёт ${reference} не найден в плане счетов`)
  if (!account.active) throw new ConvexError(`Счёт ${account.code} «${account.name}» отключён`)
  if (manual && !account.allowManualEntries) throw new ConvexError(`На счёт ${account.code} нельзя делать ручные проводки`)
  return account
}

/** One double-entry line: debit and credit of the same amount by construction (W1-PLT-03). */
export async function postJournalEntry(ctx: MutationCtx, posting: JournalPosting): Promise<Doc<"journalEntries">> {
  const existing = await ctx.db.query("journalEntries").withIndex("by_external_id", (q) => q.eq("externalId", posting.externalId)).unique()
  if (existing) return existing

  if (!Number.isInteger(posting.amount) || posting.amount <= 0) throw new ConvexError("Сумма проводки должна быть целым положительным числом тенге")
  const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", posting.restaurantExternalId)).unique()
  if (!restaurant) throw new ConvexError("Ресторан не найден")
  const [debit, credit] = await Promise.all([resolveAccount(ctx, posting.debitAccount, posting.manual ?? false), resolveAccount(ctx, posting.creditAccount, posting.manual ?? false)])
  if (debit._id === credit._id) throw new ConvexError("Дебет и кредит проводки совпадают")

  const businessDate = posting.businessDate ?? businessDateFor(posting.occurredAt, restaurant.businessDayCutoffMinutes)
  if (!posting.migration) await assertPeriodOpen(ctx, { organizationExternalId: restaurant.organizationExternalId, restaurantExternalId: restaurant.externalId, businessDate, moduleId: posting.sourceModuleId })

  const id = await ctx.db.insert("journalEntries", {
    externalId: posting.externalId,
    organizationExternalId: restaurant.organizationExternalId,
    restaurantExternalId: restaurant.externalId,
    sourceModuleId: posting.sourceModuleId,
    sourceExternalId: posting.sourceExternalId,
    sourceNumber: posting.sourceNumber,
    occurredAt: posting.occurredAt,
    businessDate,
    debitAccountExternalId: debit.externalId,
    creditAccountExternalId: credit.externalId,
    amount: posting.amount,
    description: posting.description,
    ...(posting.warehouseExternalId ? { warehouseExternalId: posting.warehouseExternalId } : {}),
    ...(posting.quantity !== undefined ? { quantity: posting.quantity } : {}),
    ...(posting.itemName ? { itemName: posting.itemName } : {}),
    ...(posting.reversalOf ? { reversalOf: posting.reversalOf } : {}),
    ...(posting.migration ? { migration: posting.migration } : {}),
  })
  return (await ctx.db.get(id))!
}

/** A document (order, receipt, act) has a handful of entries; this bounds the read. */
const MAX_ENTRIES_PER_SOURCE = 400

/**
 * Reverses a source's entries (debit ↔ credit) for `share` of their amount — 1 for a full reversal,
 * refunded / paid for a partial refund (B-9). `reversalKey` makes a repeat idempotent; entries that
 * are themselves reversals are skipped.
 */
export async function reverseJournalEntries(
  ctx: MutationCtx,
  args: { sourceExternalId: string; occurredAt: number; reversalKey: string; share?: number; description?: string; businessDate?: string; only?: (entry: Doc<"journalEntries">) => boolean },
) {
  const share = args.share ?? 1
  if (!(share > 0 && share <= 1)) throw new ConvexError("Доля сторно должна быть от 0 до 1")
  const reversals: Doc<"journalEntries">[] = []
  // Read first, then write: reversals share the source index, so they must not join this loop.
  const entries = await ctx.db
    .query("journalEntries")
    .withIndex("by_source", (q) => q.eq("sourceExternalId", args.sourceExternalId))
    .take(MAX_ENTRIES_PER_SOURCE + 1)
  if (entries.length > MAX_ENTRIES_PER_SOURCE) throw new ConvexError("Слишком много проводок у документа для сторно в одной операции")
  for (const entry of entries) {
    if (entry.reversalOf || (args.only && !args.only(entry))) continue
    const amount = Math.round(entry.amount * share)
    if (amount <= 0) continue
    const externalId = `${entry.externalId}:reversal:${args.reversalKey}`
    const existing = await ctx.db.query("journalEntries").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
    if (existing) {
      reversals.push(existing)
      continue
    }
    const reversal = await postJournalEntry(ctx, {
      externalId,
      restaurantExternalId: entry.restaurantExternalId,
      sourceModuleId: entry.sourceModuleId,
      sourceExternalId: entry.sourceExternalId,
      sourceNumber: entry.sourceNumber,
      occurredAt: args.occurredAt,
      businessDate: args.businessDate,
      debitAccount: entry.creditAccountExternalId,
      creditAccount: entry.debitAccountExternalId,
      amount,
      description: args.description ?? `Сторно: ${entry.description}`,
      warehouseExternalId: entry.warehouseExternalId,
      quantity: entry.quantity === undefined ? undefined : -entry.quantity * share,
      itemName: entry.itemName,
      reversalOf: entry._id,
    })
    reversals.push(reversal)
  }
  return reversals
}

/** Journal postings need the chart of accounts; before it is seeded, M-4 back-fills from payments. */
export async function journalReady(ctx: GenericQueryCtx<DataModel>) {
  const revenue = await ctx.db.query("accounts").withIndex("by_external_id", (q) => q.eq("externalId", SYSTEM_ACCOUNTS.revenue.externalId)).unique()
  return Boolean(revenue?.active)
}
