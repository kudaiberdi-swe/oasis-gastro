import { ConvexError } from "convex/values"
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server"

import type { DataModel, Doc, Id } from "../_generated/dataModel"
import { SYSTEM_ACCOUNTS } from "./accounts"
import { postLedgerEntry } from "./finance"
import { postJournalEntry } from "./ledger"
import { accrueLoyaltyPoints } from "./loyalty"
import { appendOutboxEvent } from "./outbox"
import { consumeOrderStock } from "./recipeConsumption"
import { activeSettingsAt } from "./retailSettings"

type QueryCtx = GenericQueryCtx<DataModel>
type MutationCtx = GenericMutationCtx<DataModel>
type ProcessorKind = "cash" | "card" | "qr"

/**
 * Settlement core (W1-POS-02): the one place an order becomes paid — POS checkout today, delivery and
 * kiosk later — so payment types, postings, stock and loyalty never diverge between channels.
 */

export type PaymentInput = { paymentTypeExternalId?: string; method?: ProcessorKind; amount: number; tendered?: number }

export type ResolvedPaymentType = {
  externalId?: string
  name: string
  processorKind: ProcessorKind
  account: string
  combinable: boolean
  allowsChange: boolean
}

// Legacy `method` (until M-2 deploy 2) maps to the seeded payment type of that kind (W1-RTL-02).
const LEGACY_CODE: Record<ProcessorKind, string> = { cash: "cash", card: "card", qr: "kaspi-qr" }
const LEGACY_NAME: Record<ProcessorKind, string> = { cash: "Наличные", card: "Банковская карта", qr: "Kaspi QR" }

function fromSetting(row: Doc<"retailSettings">): ResolvedPaymentType {
  if (row.data.kind !== "payment-type") throw new ConvexError("Тип оплаты не найден")
  return { externalId: row.externalId, name: row.receiptName ?? row.name, processorKind: row.data.processorKind, account: row.data.account, combinable: row.data.combinable, allowsChange: row.data.allowsChange }
}

export async function resolvePaymentType(ctx: QueryCtx, restaurantExternalId: string, input: { paymentTypeExternalId?: string; method?: ProcessorKind }, at: number): Promise<ResolvedPaymentType> {
  if (input.paymentTypeExternalId) {
    const row = await ctx.db.query("retailSettings").withIndex("by_external_id", (q) => q.eq("externalId", input.paymentTypeExternalId!)).unique()
    const inForce = row && row.kind === "payment-type" && row.status === "published" && row.effectiveFrom <= at && (row.effectiveTo === undefined || at < row.effectiveTo)
    if (!row || !inForce || (row.restaurantExternalIds.length > 0 && !row.restaurantExternalIds.includes(restaurantExternalId))) throw new ConvexError("Тип оплаты недоступен на этой кассе")
    return fromSetting(row)
  }
  if (!input.method) throw new ConvexError("Укажите тип оплаты")
  const method = input.method
  const active = await activeSettingsAt(ctx, "payment-type", restaurantExternalId, at)
  const row = active.find((setting) => setting.code === LEGACY_CODE[method]) ?? active.find((setting) => setting.data.kind === "payment-type" && setting.data.processorKind === method)
  if (row) return fromSetting(row)
  // No retail settings yet (deployment before the W1 maintenance run): behave as before them.
  return { name: LEGACY_NAME[method], processorKind: method, account: method === "cash" ? "cash" : "inTransit", combinable: true, allowsChange: method === "cash" }
}

/** Journal postings need the chart of accounts; before it is seeded, M-4 back-fills from payments. */
export async function journalReady(ctx: QueryCtx) {
  const revenue = await ctx.db.query("accounts").withIndex("by_external_id", (q) => q.eq("externalId", SYSTEM_ACCOUNTS.revenue.externalId)).unique()
  return Boolean(revenue?.active)
}

export async function ensureKitchenTicket(ctx: MutationCtx, order: Doc<"orders">, now: number) {
  const existing = await ctx.db.query("kitchenTickets").withIndex("by_order", (q) => q.eq("orderId", order._id)).first()
  if (existing) return existing._id
  const ticketId = await ctx.db.insert("kitchenTickets", { orderId: order._id, orderNumber: order.number, status: "queued", fulfillment: order.orderType, source: "pos", createdAt: now, updatedAt: now })
  const lines = await ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(100)
  for (const line of lines) {
    await ctx.db.insert("kitchenTicketLines", { ticketId, productExternalId: line.productExternalId ?? String(line.productId), productName: line.productName, quantity: line.quantity, instructions: line.modifiers })
  }
  return ticketId
}

/**
 * Pays an order in one transaction: validates the split against the payment types, records payments,
 * posts Dr payment-type account / Cr revenue per payment and moves the service charge to its own
 * revenue account (revenue is net of discounts, so a discount needs no entry of its own), writes off
 * stock by recipe, accrues loyalty and announces order.paid. The caller has checked access, the shift,
 * the period and idempotency, and writes its own audit.
 */
export async function settleOrder(
  ctx: MutationCtx,
  args: {
    order: Doc<"orders">
    shift: Doc<"shifts">
    actor: { employeeId: Id<"employees">; restaurant: Doc<"restaurants">; terminal: Doc<"posTerminals"> | null }
    payments: PaymentInput[]
    idempotencyKey: string
    source: "pos" | "delivery" | "kiosk"
    occurredAt: number
  },
) {
  const { order, shift, actor, occurredAt: now } = args
  if (!args.payments.length) throw new ConvexError("Добавьте оплату")
  const restaurantExternalId = actor.restaurant.externalId
  const resolved: { input: PaymentInput; type: ResolvedPaymentType }[] = []
  for (const input of args.payments) {
    if (!Number.isInteger(input.amount) || input.amount <= 0) throw new ConvexError("Сумма оплаты должна быть указана в целых тенге")
    if (input.tendered != null && !Number.isInteger(input.tendered)) throw new ConvexError("Полученная сумма должна быть указана в целых тенге")
    resolved.push({ input, type: await resolvePaymentType(ctx, restaurantExternalId, input, now) })
  }
  if (resolved.reduce((sum, row) => sum + row.input.amount, 0) !== order.total) throw new ConvexError("Сумма оплат не равна сумме заказа")
  if (resolved.length > 1) {
    const single = resolved.find((row) => !row.type.combinable)
    if (single) throw new ConvexError(`«${single.type.name}» нельзя комбинировать с другими типами оплаты`)
  }
  for (const { input, type } of resolved) {
    const tendered = input.tendered ?? input.amount
    if (tendered < input.amount) throw new ConvexError("Полученной суммы недостаточно")
    if (tendered > input.amount && !type.allowsChange) throw new ConvexError(`Сдача возможна только с наличных, не с «${type.name}»`)
  }

  const businessDate = order.businessDate ?? shift.businessDate
  const withJournal = await journalReady(ctx)
  const sourceExternalId = String(order._id)
  const paymentIds: Id<"payments">[] = []
  for (const [index, { input, type }] of resolved.entries()) {
    const paymentKey = resolved.length === 1 ? args.idempotencyKey : `${args.idempotencyKey}:${index}`
    const tendered = input.tendered ?? input.amount
    const journalEntryId = withJournal
      ? (
          await postJournalEntry(ctx, {
            externalId: `pay:${paymentKey}`,
            restaurantExternalId,
            sourceModuleId: "orders",
            sourceExternalId,
            sourceNumber: String(order.number),
            occurredAt: now,
            businessDate,
            debitAccount: type.account,
            creditAccount: "revenue",
            amount: input.amount,
            description: `Оплата заказа №${order.number}: ${type.name}`,
          })
        ).externalId
      : undefined
    paymentIds.push(
      await ctx.db.insert("payments", {
        orderId: order._id,
        shiftId: shift._id,
        type: "sale",
        method: type.processorKind,
        processorKind: type.processorKind,
        paymentTypeExternalId: type.externalId,
        paymentTypeName: type.name,
        restaurantId: actor.restaurant._id,
        amount: input.amount,
        ...(type.allowsChange ? { tendered, change: tendered - input.amount } : {}),
        idempotencyKey: paymentKey,
        status: "recorded",
        createdBy: actor.employeeId,
        createdAt: now,
        ...(journalEntryId ? { journalEntryId } : {}),
      }),
    )
  }
  if (withJournal && order.serviceChargeAmount > 0) {
    await postJournalEntry(ctx, {
      externalId: `svc:${args.idempotencyKey}`,
      restaurantExternalId,
      sourceModuleId: "orders",
      sourceExternalId,
      sourceNumber: String(order.number),
      occurredAt: now,
      businessDate,
      debitAccount: "revenue",
      creditAccount: "serviceRevenue",
      amount: order.serviceChargeAmount,
      description: `Сервисный сбор заказа №${order.number}`,
    })
  }

  await ensureKitchenTicket(ctx, order, now)
  await ctx.db.patch(order._id, {
    status: "paid",
    paymentMethod: resolved.length === 1 ? resolved[0].type.processorKind : undefined,
    checkoutIdempotencyKey: args.idempotencyKey,
    businessDate,
    paidAt: now,
    updatedAt: now,
    updatedBy: actor.employeeId,
    version: (order.version ?? 1) + 1,
  })
  await ctx.db.insert("shiftEvents", { shiftId: shift._id, type: "order-paid", amount: order.total, reason: `Заказ №${order.number}`, actorId: actor.employeeId, orderId: order._id, createdAt: now })
  // Flat P&L ledger stays until M-4 (W1-FIN-07) moves its readers to the journal.
  await postLedgerEntry(ctx, { restaurantExternalId, occurredAt: now, kind: "revenue", category: "Продажи", amount: order.total, sourceModuleId: "orders", sourceExternalId, description: `Заказ №${order.number}`, businessDate })
  // Sale write-off by recipe and cost of goods sold (W1-RCP-03); never fails the sale.
  const soldLines = await ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(200)
  await consumeOrderStock(ctx, { order, lines: soldLines, restaurantExternalId, terminal: actor.terminal, idempotencyKey: args.idempotencyKey, occurredAt: now, businessDate })
  await accrueLoyaltyPoints(ctx, order, now)
  await appendOutboxEvent(ctx, {
    aggregateType: "order",
    aggregateExternalId: sourceExternalId,
    eventType: "order.paid",
    restaurantExternalId,
    payload: { number: order.number, total: order.total, businessDate, source: args.source, payments: resolved.map(({ input, type }) => ({ paymentTypeExternalId: type.externalId ?? null, processorKind: type.processorKind, amount: input.amount })) },
  })
  return { paymentIds, businessDate }
}
