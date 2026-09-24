import { ConvexError } from "convex/values"
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server"

import type { DataModel, Doc, Id } from "../_generated/dataModel"
import { journalReady, postJournalEntry } from "./ledger"
import { accrueLoyaltyPoints, reverseLoyaltyPoints } from "./loyalty"

type QueryCtx = GenericQueryCtx<DataModel>
type MutationCtx = GenericMutationCtx<DataModel>

// Loyalty core (W1-LOY-03): quote, apply at checkout, reverse at refund. 1 point = 1 ₸. Before a
// program exists (M-5 not run) the old 1 % accrual on guests.points keeps working unchanged.

export const BASE_PROGRAM_EXTERNAL_ID = "loyalty-program-base"

/**
 * The program for this guest here and now: in its window, for this restaurant (or "*"), a program for
 * the guest's category before a general one, then higher priority, later start, id — deterministic (B-20).
 */
export async function selectProgram(ctx: QueryCtx, restaurantExternalId: string, guest: Doc<"guests">, at: number) {
  const published = await ctx.db.query("loyaltyPrograms").withIndex("by_status_priority", (q) => q.eq("status", "published")).order("desc").take(50)
  const categories = new Set(guest.categoryExternalIds ?? [])
  const eligible = published.filter(
    (program) =>
      program.startsAt <= at &&
      (program.endsAt === undefined || at < program.endsAt) &&
      (program.restaurantExternalIds.includes("*") || program.restaurantExternalIds.includes(restaurantExternalId)) &&
      (!program.categoryExternalId || categories.has(program.categoryExternalId)),
  )
  eligible.sort((a, b) => Number(Boolean(b.categoryExternalId)) - Number(Boolean(a.categoryExternalId)) || b.priority - a.priority || b.startsAt - a.startsAt || a.externalId.localeCompare(b.externalId))
  return eligible[0] ?? null
}

async function accountOf(ctx: QueryCtx, guestId: Id<"guests">, programExternalId: string) {
  return ctx.db.query("loyaltyAccounts").withIndex("by_guest_program", (q) => q.eq("guestId", guestId).eq("programExternalId", programExternalId)).unique()
}

/** What the guest can spend and would earn on `payable` ₸ (before redemption). Null without a program. */
export async function quoteLoyalty(ctx: QueryCtx, args: { guestId: Id<"guests">; restaurantExternalId: string; payable: number; at: number }) {
  const guest = await ctx.db.get(args.guestId)
  if (!guest || guest.status === "inactive") return null
  const program = await selectProgram(ctx, args.restaurantExternalId, guest, args.at)
  if (!program) return null
  const account = await accountOf(ctx, guest._id, program.externalId)
  const balance = Math.max(0, (account?.balance ?? 0) - (account?.reserved ?? 0))
  const maxRedemption = Math.min(balance, Math.floor((args.payable * program.maxRedemptionPercent) / 100))
  const accrual = (redemption: number) => Math.floor(((args.payable - redemption) * program.accrualPercent) / 100)
  return { program, account, balance, maxRedemption, accrualWithout: accrual(0), accrualFor: accrual }
}

async function move(ctx: MutationCtx, args: { guest: Doc<"guests">; account: Doc<"loyaltyAccounts">; kind: "accrual" | "redemption" | "reversal"; points: number; order: Doc<"orders">; idempotencyKey: string; occurredAt: number; description: string; expiresAt?: number; paymentId?: Id<"payments">; shortfall?: number }) {
  const existing = await ctx.db.query("loyaltyTransactions").withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", args.idempotencyKey)).unique()
  if (existing) return existing
  const account = (await ctx.db.get(args.account._id))!
  const guest = (await ctx.db.get(args.guest._id))!
  const balanceAfter = account.balance + args.points
  await ctx.db.patch(account._id, { balance: balanceAfter, updatedAt: args.occurredAt })
  // guests.points mirrors the balance while the office still reads it (dropped in W2).
  await ctx.db.patch(guest._id, { points: Math.max(0, guest.points + args.points), updatedAt: args.occurredAt })
  const id = await ctx.db.insert("loyaltyTransactions", {
    guestId: guest._id,
    kind: args.kind,
    points: args.points,
    orderId: args.order._id,
    balanceAfter,
    occurredAt: args.occurredAt,
    accountId: account._id,
    programExternalId: account.programExternalId,
    idempotencyKey: args.idempotencyKey,
    description: args.description,
    ...(args.expiresAt ? { expiresAt: args.expiresAt } : {}),
    ...(args.paymentId ? { paymentId: args.paymentId } : {}),
    ...(args.shortfall ? { shortfall: args.shortfall } : {}),
  })
  return (await ctx.db.get(id))!
}

/**
 * At checkout: spends `redemption` points (0…maxRedemption, partial allowed — B-20) and accrues on what
 * the guest paid. The redemption is revenue paid with the loyalty liability: Dr 3510 / Cr 6010.
 */
export async function applyOrderLoyalty(ctx: MutationCtx, args: { order: Doc<"orders">; redemption: number; idempotencyKey: string; restaurantExternalId: string; occurredAt: number; businessDate: string }) {
  const { order } = args
  if (!order.guestId) {
    if (args.redemption) throw new ConvexError("Списание баллов без гостя невозможно")
    return { redeemed: 0, accrued: 0 }
  }
  const quote = await quoteLoyalty(ctx, { guestId: order.guestId, restaurantExternalId: args.restaurantExternalId, payable: order.total, at: args.occurredAt })
  if (!quote) {
    if (args.redemption) throw new ConvexError("Для гостя нет программы лояльности")
    await accrueLoyaltyPoints(ctx, order, args.occurredAt)
    return { redeemed: 0, accrued: Math.floor(order.total / 100) }
  }
  if (!Number.isInteger(args.redemption) || args.redemption < 0 || args.redemption > quote.maxRedemption) throw new ConvexError(`Списать можно от 0 до ${quote.maxRedemption} баллов`)
  const guest = (await ctx.db.get(order.guestId))!
  let account = quote.account
  if (!account) {
    const id = await ctx.db.insert("loyaltyAccounts", { externalId: `loyalty-account-${crypto.randomUUID()}`, guestId: guest._id, programExternalId: quote.program.externalId, kind: quote.program.programKind, balance: 0, reserved: 0, updatedAt: args.occurredAt })
    account = (await ctx.db.get(id))!
  }
  if (args.redemption > 0) {
    await move(ctx, { guest, account, kind: "redemption", points: -args.redemption, order, idempotencyKey: `${args.idempotencyKey}:redemption`, occurredAt: args.occurredAt, description: `Списание по заказу №${order.number}` })
    if (await journalReady(ctx)) {
      await postJournalEntry(ctx, { externalId: `loyalty:${args.idempotencyKey}`, restaurantExternalId: args.restaurantExternalId, sourceModuleId: "orders", sourceExternalId: String(order._id), sourceNumber: String(order.number), occurredAt: args.occurredAt, businessDate: args.businessDate, debitAccount: "loyaltyLiability", creditAccount: "revenue", amount: args.redemption, description: `Оплата баллами заказа №${order.number}` })
    }
  }
  const accrued = quote.accrualFor(args.redemption)
  if (accrued > 0) {
    const expiresAt = quote.program.expirationDays ? args.occurredAt + quote.program.expirationDays * 86_400_000 : undefined
    await move(ctx, { guest, account, kind: "accrual", points: accrued, order, idempotencyKey: `${args.idempotencyKey}:accrual`, occurredAt: args.occurredAt, description: `Начисление по заказу №${order.number}`, expiresAt })
  }
  await ctx.db.patch(guest._id, { visits: (guest.visits ?? 0) + 1, lastVisitAt: args.occurredAt, turnover: (guest.turnover ?? 0) + order.total, restaurantExternalId: guest.restaurantExternalId ?? args.restaurantExternalId })
  await ctx.db.patch(order._id, { loyaltyProgramExternalId: quote.program.externalId, loyaltyRedeemed: args.redemption, loyaltyAccrued: accrued })
  return { redeemed: args.redemption, accrued }
}

/**
 * At refund: takes back the refunded share of the accrual and gives back that share of the redemption,
 * cumulatively over partial refunds (S-8). Points the guest already spent are recorded as shortfall —
 * a refund of money is never blocked by a loyalty balance.
 */
export async function reverseOrderLoyalty(ctx: MutationCtx, args: { order: Doc<"orders">; paidTotal: number; refundedTotal: number; paymentId: Id<"payments">; occurredAt: number }) {
  const { order } = args
  if (!order.guestId || args.paidTotal <= 0) return
  if (!order.loyaltyProgramExternalId) {
    await reverseLoyaltyPoints(ctx, order, { paidTotal: args.paidTotal, refundedTotal: args.refundedTotal, paymentId: args.paymentId, occurredAt: args.occurredAt })
    return
  }
  const guest = await ctx.db.get(order.guestId)
  const account = guest ? await accountOf(ctx, guest._id, order.loyaltyProgramExternalId) : null
  if (!guest || !account) return
  const ratio = Math.min(1, args.refundedTotal / args.paidTotal)
  const history = await ctx.db.query("loyaltyTransactions").withIndex("by_order_occurred", (q) => q.eq("orderId", order._id)).take(200)
  const reversed = history.filter((row) => row.kind === "reversal").reduce((sum, row) => sum + row.points - (row.shortfall ?? 0), 0) // net points already moved back
  const target = Math.floor((order.loyaltyRedeemed ?? 0) * ratio) - Math.floor((order.loyaltyAccrued ?? 0) * ratio) // + returns spent points, − takes earned ones
  let delta = target - reversed
  if (delta === 0) return
  let shortfall = 0
  const current = (await ctx.db.get(account._id))!
  if (current.balance + delta < 0) {
    shortfall = -(current.balance + delta)
    delta = -current.balance
  }
  await move(ctx, { guest, account, kind: "reversal", points: delta, order, idempotencyKey: `refund:${args.paymentId}:loyalty`, occurredAt: args.occurredAt, description: `Возврат по заказу №${order.number}`, paymentId: args.paymentId, shortfall })
}
