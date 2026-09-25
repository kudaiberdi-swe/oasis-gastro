import type { GenericMutationCtx } from "convex/server"
import type { DataModel } from "../_generated/dataModel"
import { almatyBusinessDate } from "./time"

type MutationCtx = GenericMutationCtx<DataModel>

/**
 * LEGACY (flat P&L ledger) — new postings go through lib/ledger.ts postJournalEntry; this and
 * ledgerEntries are removed after migration M-4 (W1-FIN-07).
 *
 * Posts one line to the flat P&L ledger. Called directly from the domains that produce money
 * events — orders/mutations.ts (checkout, refund) and the finance manual expense — rather
 * than routed through a separate finance mutation, so a sale or a stock receipt always posts
 * atomically in the same transaction as the event that caused it.
 */
export async function postLedgerEntry(
  ctx: MutationCtx,
  entry: {
    restaurantExternalId: string
    occurredAt: number
    kind: "revenue" | "expense"
    category: string
    amount: number
    sourceModuleId: "orders" | "stock" | "manual"
    sourceExternalId: string
    description: string
    createdByEmail?: string
    /** POS money events pass the shift's business date; others default to the calendar day. */
    businessDate?: string
  },
) {
  await ctx.db.insert("ledgerEntries", {
    restaurantExternalId: entry.restaurantExternalId,
    businessDate: entry.businessDate ?? almatyBusinessDate(entry.occurredAt),
    occurredAt: entry.occurredAt,
    kind: entry.kind,
    category: entry.category,
    amount: entry.amount,
    sourceModuleId: entry.sourceModuleId,
    sourceExternalId: entry.sourceExternalId,
    description: entry.description,
    createdByEmail: entry.createdByEmail,
    createdAt: Date.now(),
  })
}
