import { ConvexError } from "convex/values"
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server"

import type { DataModel, Doc } from "../../_generated/dataModel"
import { monthEnd } from "../../lib/budgets"
import { saveDomainRecord, type SaveDomainRecordArgs, type TransitionHooks } from "../../lib/domainRecords"
import { postJournalEntry, reverseJournalEntries } from "../../lib/ledger"
import { allocateObligation, cancelObligations, createObligation, getObligation } from "../../lib/obligations"
import { allowsCapability, writeOfficeAudit } from "../../lib/officeAccess"
import { FINANCE_MODULES, type FinanceModuleId } from "./validators"

type QueryCtx = GenericQueryCtx<DataModel>
type MutationCtx = GenericMutationCtx<DataModel>
type Data = SaveDomainRecordArgs["data"]

// Module rules on top of the domain-record engine (W1-FIN-03/04/05): what each module's data must
// hold, and what posting a manual operation writes to the journal.

const text = (data: Data, key: string) => (typeof data[key] === "string" ? (data[key] as string).trim() : "")

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DIRECTIONS = ["incoming", "outgoing", "both"]
const PRIORITIES = ["required", "normal", "optional"]
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
    case "accounts-payable": {
      // A manual obligation; those of documents are created posted and never pass through here.
      const direction = text(args.data, "direction")
      if (direction !== "payable" && direction !== "receivable") throw new ConvexError("Укажите вид задолженности: кредиторская или дебиторская")
      if (!(Number.isInteger(args.amount) && args.amount > 0)) throw new ConvexError("Сумма — целое число тенге больше нуля")
      const due = text(args.data, "dueDate")
      if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new ConvexError("Срок оплаты — ГГГГ-ММ-ДД")
      if (args.data.sourceModuleId) throw new ConvexError("Обязательство документа меняется только через документ")
      Object.assign(args.data, { originalAmount: args.amount, allocatedAmount: 0, obligationKind: text(args.data, "obligationKind") || "other", dueDate: due || null })
      return {}
    }
    case "bank-statements": {
      // Lines come only from importStatement; a draft line's card changes its counterparty (when the BIN
      // found none), the cashflow category its payment gets, and a comment — never the bank's own fields.
      const existing = args.externalId ? await financeRecord(ctx, args.externalId) : null
      if (!existing) throw new ConvexError("Строки выписки создаются импортом CSV")
      const counterpartyChanged = (args.counterpartyExternalId ?? "") !== (existing.counterpartyExternalId ?? "")
      if (counterpartyChanged && existing.data.matchStatus === "matched") throw new ConvexError("Сначала снимите сопоставление")
      if (args.counterpartyExternalId) {
        const counterparty = await financeRecord(ctx, args.counterpartyExternalId)
        if (!counterparty || counterparty.moduleId !== "counterparties") throw new ConvexError("Контрагент не найден")
      }
      if (args.cashflowCategoryExternalId) {
        const category = await financeRecord(ctx, args.cashflowCategoryExternalId)
        if (!category || category.moduleId !== "cashflow-categories") throw new ConvexError("Статья ДДС не найдена")
      }
      const comment = text(args.data, "comment")
      const data = counterpartyChanged ? withoutSuggestion({ ...existing.data, matchStatus: "unmatched" }) : { ...existing.data }
      if (comment) data.comment = comment
      else delete data.comment
      return { name: existing.name, businessDate: existing.businessDate, amount: existing.amount, data }
    }
    case "payment-calendar": {
      const direction = text(args.data, "direction")
      if (direction !== "incoming" && direction !== "outgoing") throw new ConvexError("Укажите поток: поступление или платёж")
      const plannedAt = text(args.data, "plannedAt")
      if (!DATE.test(plannedAt)) throw new ConvexError("Плановая дата — ГГГГ-ММ-ДД")
      const priority = text(args.data, "priority") || "normal"
      if (!PRIORITIES.includes(priority)) throw new ConvexError("Приоритет: обязательный, обычный или отложенный")
      if (!(Number.isInteger(args.amount) && args.amount > 0)) throw new ConvexError("Сумма — целое число тенге больше нуля")
      const obligationId = text(args.data, "obligationExternalId")
      if (obligationId) {
        const obligation = await financeRecord(ctx, obligationId)
        if (!obligation || obligation.moduleId !== "accounts-payable" || obligation.restaurantExternalId !== args.restaurantExternalId) throw new ConvexError("Обязательство не найдено в этом ресторане")
        if ((obligation.data.direction === "receivable") !== (direction === "incoming")) throw new ConvexError("Поток не совпадает с видом задолженности")
      }
      Object.assign(args.data, { direction, plannedAt, priority })
      return {}
    }
    case "budgets": {
      // The version is the server's: 1 for a new budget, the next one only through copyBudgetVersion.
      const existing = args.externalId ? await financeRecord(ctx, args.externalId) : null
      const month = args.businessDate.slice(0, 7)
      const start = text(args.data, "periodStart") || `${month}-01`
      const end = text(args.data, "periodEnd") || monthEnd(month)
      if (!DATE.test(start) || !DATE.test(end)) throw new ConvexError("Период бюджета — даты ГГГГ-ММ-ДД")
      if (start > end) throw new ConvexError("Начало периода позже его конца")
      const version = existing && typeof existing.data.budgetVersion === "number" ? existing.data.budgetVersion : 1
      const previous = existing && typeof existing.data.previousVersionExternalId === "string" ? { previousVersionExternalId: existing.data.previousVersionExternalId } : {}
      Object.assign(args.data, { periodStart: start, periodEnd: end, budgetVersion: version, ...previous })
      return {}
    }
    default:
      return {}
  }
}

/** A bank line's data without an auto-match suggestion. */
export function withoutSuggestion(data: Data): Data {
  const { suggestedExternalId: _id, suggestedKind: _kind, suggestedNumber: _number, ...rest } = data
  return rest
}

export type FinanceActor = { email: string; capabilities: string[] }

/** Posts a payment the office did not walk through approval here (one a bank line creates or confirms). */
async function postPaymentRecord(ctx: MutationCtx, payment: Doc<"financeRecords">, actor: FinanceActor, summary: string) {
  await financeHooks(ctx, "payments").beforePost!(payment)
  const now = Date.now()
  await ctx.db.patch(payment._id, { status: "posted", postedAt: now, version: payment.version + 1, updatedAt: now })
  await writeOfficeAudit(ctx, actor.email, { action: "payments.bank-post", summary, resourceType: "payments", resourceExternalId: payment.externalId, restaurantExternalId: payment.restaurantExternalId, capability: "office.bank-statements.post", details: { number: payment.number } })
}

/** Drops a payment's link to a bank line (the line was unmatched, cancelled or reversed). */
export async function unlinkBankPayment(ctx: MutationCtx, paymentExternalId: string, lineExternalId: string) {
  const payment = await financeRecord(ctx, paymentExternalId)
  if (!payment || payment.data.bankLineExternalId !== lineExternalId) return
  const { bankLineExternalId: _line, ...data } = payment.data
  await ctx.db.patch(payment._id, { data, version: payment.version + 1, updatedAt: Date.now() })
}

/**
 * A bank line (W3-FIN-11) posted: matched to a payment — the payment is (or gets) posted and nothing else
 * is written; otherwise the line becomes a posted bank payment of its counterparty, allocated to the
 * matched obligation if any. Reversing a line reverses the payment it created.
 */
function bankLineHooks(ctx: MutationCtx, actor?: FinanceActor): TransitionHooks {
  return {
    beforePost: async (line) => {
      if (!actor) throw new ConvexError("Требуется вход в Office")
      const direction = line.data.direction === "incoming" ? "incoming" : "outgoing"
      const linked = text(line.data, "matchedPaymentExternalId")
      if (linked) {
        const payment = await financeRecord(ctx, linked)
        if (!payment || payment.moduleId !== "payments") throw new ConvexError("Сопоставленный платёж не найден — снимите сопоставление")
        if (payment.status === "approved") {
          if (!allowsCapability(actor.capabilities, "office.payments.post")) throw new ConvexError(`Платёж ${payment.number} согласован, но не проведён — проведите его в «Платежах»`)
          await postPaymentRecord(ctx, payment, actor, `Платёж ${payment.number} проведён по выписке ${line.number}`)
        } else if (payment.status !== "posted") throw new ConvexError(`Платёж ${payment.number} не согласован — снимите сопоставление`)
        await ctx.db.patch(line._id, { data: withoutSuggestion({ ...line.data, matchStatus: "posted" }) })
        return
      }
      const counterpartyExternalId = line.counterpartyExternalId
      if (!counterpartyExternalId) throw new ConvexError("Контрагент по БИН не найден — выберите контрагента в строке")
      if (!line.cashflowCategoryExternalId) throw new ConvexError("Выберите статью ДДС — строка станет платежом")
      const obligationId = text(line.data, "matchedObligationExternalId")
      const obligation = obligationId ? await getObligation(ctx, obligationId) : null
      if (obligationId && (!obligation || obligation.status !== "posted" || obligation.amount <= 0)) throw new ConvexError("Сопоставленное обязательство уже закрыто — снимите сопоставление")
      const payment = await saveDomainRecord(ctx, "financeRecords", actor.email, { moduleId: "payments", ...FINANCE_MODULES.payments }, {
        name: text(line.data, "purpose") || line.name,
        restaurantExternalId: obligation?.restaurantExternalId ?? line.restaurantExternalId,
        businessDate: line.businessDate,
        amount: line.amount,
        counterpartyExternalId,
        cashflowCategoryExternalId: line.cashflowCategoryExternalId,
        data: { direction, method: "bank", bankLineExternalId: line.externalId, comment: `Банковская выписка, строка ${line.number}` },
      })
      if (obligation) await ctx.db.insert("paymentAllocations", { paymentExternalId: payment.externalId, obligationExternalId: obligation.externalId, amount: Math.min(line.amount, obligation.amount) })
      await postPaymentRecord(ctx, payment, actor, `Платёж ${payment.number} создан и проведён по выписке ${line.number}`)
      await ctx.db.patch(line._id, { data: withoutSuggestion({ ...line.data, matchStatus: "posted", matchedPaymentExternalId: payment.externalId, matchedNumber: payment.number, createdPayment: true }) })
    },
    beforeReverse: async (line) => {
      const linked = text(line.data, "matchedPaymentExternalId")
      const payment = linked ? await financeRecord(ctx, linked) : null
      if (payment && line.data.createdPayment === true) {
        if (payment.status === "posted") {
          await financeHooks(ctx, "payments").beforeReverse!(payment)
          const now = Date.now()
          await ctx.db.patch(payment._id, { status: "reversed", reversedAt: now, version: payment.version + 1, updatedAt: now })
          if (actor) await writeOfficeAudit(ctx, actor.email, { action: "payments.bank-reverse", summary: `Платёж ${payment.number} сторнирован со строкой выписки ${line.number}`, resourceType: "payments", resourceExternalId: payment.externalId, restaurantExternalId: payment.restaurantExternalId, capability: "office.bank-statements.reverse" })
        }
      } else if (payment) await unlinkBankPayment(ctx, payment.externalId, line.externalId)
      const { matchedPaymentExternalId: _payment, matchedObligationExternalId: _obligation, matchedNumber: _number, createdPayment: _created, ...data } = line.data
      await ctx.db.patch(line._id, { data: { ...withoutSuggestion(data), matchStatus: "unmatched" } })
    },
    beforeCancel: async (line) => {
      const linked = text(line.data, "matchedPaymentExternalId")
      if (linked) await unlinkBankPayment(ctx, linked, line.externalId)
    },
  }
}

/** What posting and reversing a record writes: journal lines, obligations, payment allocations. */
export function financeHooks(ctx: MutationCtx, moduleId: FinanceModuleId, actor?: FinanceActor): TransitionHooks {
  const line = (record: Doc<"financeRecords">, suffix: string, debit: string, credit: string, amount: number, description: string, manual = false) =>
    amount > 0
      ? postJournalEntry(ctx, { externalId: `finance-${record.externalId}${suffix}`, restaurantExternalId: record.restaurantExternalId, sourceModuleId: moduleId, sourceExternalId: record.externalId, sourceNumber: record.number, occurredAt: Date.now(), businessDate: record.businessDate, debitAccount: debit, creditAccount: credit, amount, description, manual })
      : null
  const reverse = async (record: Doc<"financeRecords">) => {
    await reverseJournalEntries(ctx, { sourceExternalId: record.externalId, occurredAt: Date.now(), reversalKey: "reverse", description: `Сторно: ${record.name}` })
  }

  if (moduleId === "bank-statements") return bankLineHooks(ctx, actor)
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
  if (moduleId === "accounts-payable") {
    // An obligation of a document is reversed with its document; a settled one after its payments.
    const guard = async (record: Doc<"financeRecords">) => {
      if (record.data.sourceModuleId) throw new ConvexError(`Обязательство создано документом${record.data.sourceNumber ? ` ${record.data.sourceNumber}` : ""} — сторнируйте документ`)
      if (Number(record.data.allocatedAmount ?? 0) > 0) throw new ConvexError("Сначала сторнируйте распределённые платежи")
    }
    return { beforeReverse: guard, beforeCancel: guard }
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
