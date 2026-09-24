import { ConvexError } from "convex/values"
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server"

import type { DataModel, Doc } from "../../_generated/dataModel"
import type { SaveDomainRecordArgs, TransitionHooks } from "../../lib/domainRecords"
import { postJournalEntry, reverseJournalEntries } from "../../lib/ledger"
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
    default:
      return {}
  }
}

/** Posting a manual operation writes its journal line; reversing it writes the inverse (W1-FIN-05). */
export function financeHooks(ctx: MutationCtx, moduleId: FinanceModuleId): TransitionHooks {
  if (moduleId !== "transactions") return {}
  return {
    beforePost: async (record: Doc<"financeRecords">) => {
      await postJournalEntry(ctx, {
        externalId: `finance-${record.externalId}`,
        restaurantExternalId: record.restaurantExternalId,
        sourceModuleId: "transactions",
        sourceExternalId: record.externalId,
        sourceNumber: record.number,
        occurredAt: Date.now(),
        businessDate: record.businessDate,
        debitAccount: record.debitAccountExternalId!,
        creditAccount: record.creditAccountExternalId!,
        amount: record.amount,
        description: record.name,
        manual: true,
      })
    },
    beforeReverse: async (record: Doc<"financeRecords">) => {
      await reverseJournalEntries(ctx, { sourceExternalId: record.externalId, occurredAt: Date.now(), reversalKey: "reverse", description: `Сторно: ${record.name}` })
    },
  }
}
