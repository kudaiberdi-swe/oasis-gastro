import { ConvexError } from "convex/values"
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server"

import type { DataModel, Doc } from "../../_generated/dataModel"
import type { SaveDomainRecordArgs, TransitionHooks } from "../../lib/domainRecords"
import { postJournalEntry, reverseJournalEntries } from "../../lib/ledger"
import { allocateObligation, cancelObligations, createObligation, getObligation } from "../../lib/obligations"
import type { FinanceModuleId } from "./validators"

type QueryCtx = GenericQueryCtx<DataModel>
type MutationCtx = GenericMutationCtx<DataModel>
type Data = SaveDomainRecordArgs["data"]

// Module rules on top of the domain-record engine (W1-FIN-03/04/05): what each module's data must
// hold, and what posting a manual operation writes to the journal.

const text = (data: Data, key: string) => (typeof data[key] === "string" ? (data[key] as string).trim() : "")

const DIRECTIONS = ["incoming", "outgoing", "both"]
const ACTIVITIES = ["operating", "investing", "financing"]
const ROLES = ["supplier", "customer", "aggregator"]

async function financeRecord(ctx: QueryCtx, externalId: string) {
  return ctx.db.query("financeRecords").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
}

/** Checks and normalises a record before save; returns the fields to store (bin for counterparties). */
export async function validateFinanceRecord(ctx: QueryCtx, moduleId: FinanceModuleId, args: SaveDomainRecordArgs) {
  switch (moduleId) {
    case "cashflow-categories": {
      if (!text(args.data, "code")) throw new ConvexError("Укажите код статьи")
      const direction = text(args.data, "direction")
      if (!DIRECTIONS.includes(direction)) throw new ConvexError("Укажите направление: приход, расход или оба")
      if (!ACTIVITIES.includes(text(args.data, "activity"))) throw new ConvexError("Укажите вид деятельности")
      const parentId = text(args.data, "parentExternalId")
      // Walk up the parents: same direction (or «both») and no cycle back to this record.
      let parent = parentId ? await financeRecord(ctx, parentId) : null
      if (parentId && (!parent || parent.moduleId !== "cashflow-categories")) throw new ConvexError("Родительская статья не найдена")
      if (parent && parent.data.direction !== direction && parent.data.direction !== "both") throw new ConvexError("Родительская статья другого направления")
      for (let depth = 0; parent && depth < 20; depth += 1) {
        if (args.externalId && parent.externalId === args.externalId) throw new ConvexError("Статья не может быть родителем самой себя")
        const next = typeof parent.data.parentExternalId === "string" ? parent.data.parentExternalId : ""
        parent = next ? await financeRecord(ctx, next) : null
      }
      return { amount: 0 }
    }
    case "counterparties": {
      const bin = text(args.data, "bin")
      if (!/^\d{12}$/.test(bin)) throw new ConvexError("БИН / ИИН — 12 цифр")
      const roles = text(args.data, "roles").split(",").map((role) => role.trim()).filter(Boolean)
      if (!roles.length || roles.some((role) => !ROLES.includes(role))) throw new ConvexError("Укажите роли: поставщик, покупатель или агрегатор")
      const iban = text(args.data, "bankAccount").replace(/\s+/g, "").toUpperCase()
      if (iban && !/^KZ\d{2}[A-Z0-9]{16}$/.test(iban)) throw new ConvexError("IBAN — KZ и 18 символов")
      const delay = args.data.paymentDelayDays
      if (delay !== undefined && delay !== null && !(typeof delay === "number" && Number.isInteger(delay) && delay >= 0 && delay <= 365)) throw new ConvexError("Отсрочка — от 0 до 365 дней")
      const sameBin = await ctx.db.query("financeRecords").withIndex("by_bin", (q) => q.eq("bin", bin)).take(10)
      if (sameBin.some((row) => row.moduleId === "counterparties" && row.externalId !== args.externalId)) throw new ConvexError("Контрагент с таким БИН уже есть")
      return { amount: 0, bin }
    }
    case "transactions": {
      if (!args.debitAccountExternalId || !args.creditAccountExternalId) throw new ConvexError("Укажите дебет и кредит")
      if (!(args.amount > 0)) throw new ConvexError("Сумма проводки должна быть больше нуля")
      for (const externalId of [args.debitAccountExternalId, args.creditAccountExternalId]) {
        const account = await ctx.db.query("accounts").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
        if (!account?.active) throw new ConvexError("Счёт не найден в плане счетов")
        if (!account.allowManualEntries) throw new ConvexError(`На счёт ${account.code} нельзя делать ручные проводки`)
      }
      return {}
    }
    case "services": {
      if (!args.counterpartyExternalId) throw new ConvexError("Выберите контрагента")
      const direction = text(args.data, "serviceDirection")
      if (direction !== "received" && direction !== "provided") throw new ConvexError("Укажите вид акта: получены или оказаны услуги")
      const vatRate = Number(args.data.vatRate ?? 0)
      if (![0, 12].includes(vatRate)) throw new ConvexError("НДС — 0 или 12 %")
      if (!(args.amount > 0)) throw new ConvexError("Сумма акта должна быть больше нуля")
      const due = text(args.data, "dueDate")
      if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new ConvexError("Срок оплаты — ГГГГ-ММ-ДД")
      // Amount includes VAT; the VAT part is computed here, never taken from the client.
      const vatAmount = vatRate ? Math.round((args.amount * vatRate) / (100 + vatRate)) : 0
      args.data.vatAmount = vatAmount
      return {
        debitAccountExternalId: args.debitAccountExternalId ?? (direction === "received" ? "acc-7210" : "acc-1210"),
        creditAccountExternalId: args.creditAccountExternalId ?? (direction === "received" ? "acc-3310" : "acc-6030"),
      }
    }
    case "payments": {
      if (!args.counterpartyExternalId) throw new ConvexError("Выберите контрагента")
      if (!args.cashflowCategoryExternalId) throw new ConvexError("Выберите статью ДДС")
      const direction = text(args.data, "direction")
      if (direction !== "incoming" && direction !== "outgoing") throw new ConvexError("Укажите направление платежа")
      const method = text(args.data, "method")
      if (method !== "cash" && method !== "bank") throw new ConvexError("Укажите способ: касса или банк")
      if (!(args.amount > 0)) throw new ConvexError("Сумма платежа должна быть больше нуля")
      return {}
    }
    default:
      return {}
  }
}

/** What posting and reversing a record writes: journal lines, obligations, payment allocations. */
export function financeHooks(ctx: MutationCtx, moduleId: FinanceModuleId): TransitionHooks {
  const line = (record: Doc<"financeRecords">, suffix: string, debit: string, credit: string, amount: number, description: string, manual = false) =>
    amount > 0
      ? postJournalEntry(ctx, { externalId: `finance-${record.externalId}${suffix}`, restaurantExternalId: record.restaurantExternalId, sourceModuleId: moduleId, sourceExternalId: record.externalId, sourceNumber: record.number, occurredAt: Date.now(), businessDate: record.businessDate, debitAccount: debit, creditAccount: credit, amount, description, manual })
      : null
  const reverse = async (record: Doc<"financeRecords">) => {
    await reverseJournalEntries(ctx, { sourceExternalId: record.externalId, occurredAt: Date.now(), reversalKey: "reverse", description: `Сторно: ${record.name}` })
  }

  if (moduleId === "transactions") {
    return {
      beforePost: async (record) => {
        await line(record, "", record.debitAccountExternalId!, record.creditAccountExternalId!, record.amount, record.name, true)
      },
      beforeReverse: reverse,
    }
  }
  if (moduleId === "services") {
    return {
      // Net amount to the service accounts, VAT on its own line, and the obligation to settle.
      beforePost: async (record) => {
        const received = record.data.serviceDirection === "received"
        const vat = Number(record.data.vatAmount ?? 0)
        await line(record, "", record.debitAccountExternalId!, record.creditAccountExternalId!, record.amount - vat, record.name)
        if (vat) await line(record, ":vat", received ? "vatRecoverable" : record.debitAccountExternalId!, received ? record.creditAccountExternalId! : "vatPayable", vat, `НДС: ${record.name}`)
        await createObligation(ctx, {
          restaurantExternalId: record.restaurantExternalId,
          direction: received ? "payable" : "receivable",
          amount: record.amount,
          name: `${received ? "Оплата услуг" : "Оплата от покупателя"}: ${record.name}`,
          kind: "service",
          sourceModuleId: "services",
          sourceExternalId: record.externalId,
          sourceNumber: record.number,
          dueDate: typeof record.data.dueDate === "string" && record.data.dueDate ? record.data.dueDate : undefined,
          counterpartyExternalId: record.counterpartyExternalId,
          occurredAt: Date.now(),
        })
      },
      beforeReverse: async (record) => {
        await cancelObligations(ctx, "services", record.externalId)
        await reverse(record)
      },
    }
  }
  if (moduleId === "payments") {
    return {
      // Outgoing: Dr payables / Cr money; incoming: Dr money / Cr receivables; then settle the allocations.
      beforePost: async (record) => {
        const outgoing = record.data.direction === "outgoing"
        const money = record.data.method === "cash" ? "cash" : "bank"
        const allocations = await ctx.db.query("paymentAllocations").withIndex("by_payment", (q) => q.eq("paymentExternalId", record.externalId)).take(100)
        const allocated = allocations.reduce((sum, row) => sum + row.amount, 0)
        if (allocated > record.amount) throw new ConvexError("Распределено больше суммы платежа")
        for (const allocation of allocations) {
          const obligation = await getObligation(ctx, allocation.obligationExternalId)
          if (!obligation || obligation.status !== "posted") throw new ConvexError("Обязательство не найдено или закрыто")
          if ((obligation.data.direction === "payable") !== outgoing) throw new ConvexError("Направление платежа не совпадает с обязательством")
          await allocateObligation(ctx, obligation, allocation.amount)
          await ctx.db.patch(allocation._id, { appliedAt: Date.now() })
        }
        await line(record, "", outgoing ? "payables" : money, outgoing ? money : "receivables", record.amount, record.name)
      },
      beforeReverse: async (record) => {
        for (const allocation of await ctx.db.query("paymentAllocations").withIndex("by_payment", (q) => q.eq("paymentExternalId", record.externalId)).take(100)) {
          if (!allocation.appliedAt) continue
          const obligation = await getObligation(ctx, allocation.obligationExternalId)
          if (obligation) await allocateObligation(ctx, obligation, -allocation.amount)
          await ctx.db.patch(allocation._id, { appliedAt: undefined })
        }
        await reverse(record)
      },
    }
  }
  return {}
}
