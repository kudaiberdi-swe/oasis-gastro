import { ConvexError, v } from "convex/values"
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server"

import type { DataModel, Doc } from "../../_generated/dataModel"
import { mutation, query } from "../../_generated/server"
import { nextNumber } from "../../lib/numbering"
import { getOfficeAuthEmail, requireOfficeCapability, requireRestaurantScope, restaurantScopeFilter, writeOfficeAudit } from "../../lib/officeAccess"
import { appendOutboxEvent } from "../../lib/outbox"
import { assertPeriodOpen } from "../../lib/periods"
import { unlinkBankPayment, withoutSuggestion } from "./modules"
import { FINANCE_MODULES } from "./validators"

type QueryCtx = GenericQueryCtx<DataModel>
type MutationCtx = GenericMutationCtx<DataModel>
type FinanceRecord = Doc<"financeRecords">
type ScopedUser = { restaurantScopes: string[] }

// Bank statements (W3-FIN-11): CSV lines parsed in the browser (frontend/app/office/features/finance/model/parse-statement.ts)
// become «bank-statements» finance records, one per line; they are matched to payments and obligations of
// W2-FIN-09/10 by the counterparty's BIN, the amount and the date, and posted (modules.ts bankLineHooks).
// Sandyq banks: Kaspi Business, Halyk and others (owner decision Б-6); no sample file has been seen yet, so
// the column mapping is saved per bank account (bankImportProfiles) and the presets are unverified.

export const MAX_IMPORT_ROWS = 500
const DATE = /^\d{4}-\d{2}-\d{2}$/
const IBAN = /^KZ\d{2}[A-Z0-9]{16}$/
/** Days a payment date may differ from the bank's date and still match. */
export const MATCH_DAYS = 3
const CANDIDATE_SCAN = 500
const STATEMENT_SCAN = 5000

const MODULE = { moduleId: "bank-statements" as const, ...FINANCE_MODULES["bank-statements"] }
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "")
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000

export const normalizeIban = (value: string) => value.replace(/\s+/g, "").toUpperCase()

function fnv1a(value: string, seed: number) {
  let hash = seed >>> 0
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

type StatementRow = { date: string; number: string; amount: number; direction: "incoming" | "outgoing"; counterparty: string; bin: string; purpose: string; occurrence?: number }

/**
 * The line's identity: account, date, bank document number, direction, amount and BIN — not its position in
 * the file (bahandi's `bank-<statement>-<index>` duplicated a re-import in another order). `occurrence`
 * tells apart identical lines of one file (two equal fees on a day), counted by the parser in file order.
 */
export function bankLineExternalId(accountIban: string, row: Pick<StatementRow, "date" | "number" | "amount" | "direction" | "bin" | "occurrence">) {
  const key = [normalizeIban(accountIban), row.date, row.number.trim(), row.direction, row.amount, row.bin.trim(), row.occurrence ?? 0].join("|")
  return `bank-line:${fnv1a(key, 0x811c9dc5)}${fnv1a(key, 0x9e3779b9)}`
}

async function financeRecord(ctx: QueryCtx, externalId: string) {
  return ctx.db.query("financeRecords").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
}

async function counterpartyByBin(ctx: QueryCtx, bin: string) {
  if (!/^\d{12}$/.test(bin)) return null
  const rows = await ctx.db.query("financeRecords").withIndex("by_bin", (q) => q.eq("bin", bin)).take(5)
  return rows.find((row) => row.moduleId === "counterparties") ?? null
}

async function bankLine(ctx: QueryCtx, user: ScopedUser, externalId: string) {
  const line = await financeRecord(ctx, externalId)
  if (!line || line.moduleId !== "bank-statements") throw new ConvexError("Строка выписки не найдена")
  await requireRestaurantScope(ctx, user, line.restaurantExternalId)
  return line
}

const statementRow = v.object({
  date: v.string(),
  number: v.string(),
  amount: v.number(),
  direction: v.union(v.literal("incoming"), v.literal("outgoing")),
  counterparty: v.string(),
  bin: v.string(),
  purpose: v.string(),
  occurrence: v.optional(v.number()),
})

/**
 * Imports up to 500 lines of one statement; the browser sends a longer file in parts with the same
 * statementExternalId. A line already imported (by its identity) is counted as a duplicate, never twice.
 */
export const importStatement = mutation({
  args: { restaurantExternalId: v.string(), accountIban: v.string(), bank: v.string(), statementExternalId: v.string(), fileName: v.optional(v.string()), rows: v.array(statementRow) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.bank-statements.edit")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const email = await getOfficeAuthEmail(ctx)
    if (!email) throw new ConvexError("Требуется вход в Office")
    if (args.rows.length > MAX_IMPORT_ROWS) throw new ConvexError(`Не больше ${MAX_IMPORT_ROWS} строк за один вызов`)
    if (!args.rows.length) throw new ConvexError("В выписке нет строк")
    const iban = normalizeIban(args.accountIban)
    if (!IBAN.test(iban)) throw new ConvexError("Счёт — IBAN: KZ и 18 символов")
    const bank = args.bank.trim().slice(0, 40) || "manual"
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.restaurantExternalId)).unique()
    if (!restaurant) throw new ConvexError("Ресторан не найден")
    const header = await ctx.db.query("bankStatementImports").withIndex("by_external_id", (q) => q.eq("externalId", args.statementExternalId)).unique()
    if (header && (header.accountIban !== iban || header.restaurantExternalId !== restaurant.externalId)) throw new ConvexError("Выписка уже загружена по другому счёту или ресторану")

    const counterparties = new Map<string, FinanceRecord | null>()
    const openDates = new Set<string>()
    const seen = new Set<string>()
    let imported = 0
    let duplicates = 0
    let periodFrom = header?.periodFrom ?? ""
    let periodTo = header?.periodTo ?? ""
    const now = Date.now()
    for (const [index, row] of args.rows.entries()) {
      const where = `Строка ${index + 1}`
      if (!DATE.test(row.date)) throw new ConvexError(`${where}: дата — ГГГГ-ММ-ДД`)
      if (!(Number.isInteger(row.amount) && row.amount > 0)) throw new ConvexError(`${where}: сумма — целое число тенге больше нуля`)
      const bin = row.bin.replace(/\s+/g, "")
      if (bin && !/^\d{12}$/.test(bin)) throw new ConvexError(`${where}: БИН / ИИН — 12 цифр`)
      const externalId = bankLineExternalId(iban, { ...row, bin })
      if (seen.has(externalId) || (await financeRecord(ctx, externalId))) {
        duplicates += 1
        continue
      }
      seen.add(externalId)
      if (!openDates.has(row.date)) {
        await assertPeriodOpen(ctx, { organizationExternalId: restaurant.organizationExternalId, restaurantExternalId: restaurant.externalId, businessDate: row.date, moduleId: MODULE.moduleId })
        openDates.add(row.date)
      }
      if (!counterparties.has(bin)) counterparties.set(bin, await counterpartyByBin(ctx, bin))
      const counterparty = counterparties.get(bin)
      const purpose = row.purpose.trim().slice(0, 500)
      const counterpartyName = row.counterparty.trim().slice(0, 200)
      const number = await nextNumber(ctx, { moduleId: MODULE.moduleId, prefix: MODULE.prefix, organizationExternalId: restaurant.organizationExternalId, businessDate: row.date })
      const data = { statementExternalId: args.statementExternalId, bank, accountIban: iban, direction: row.direction, counterparty: counterpartyName, bin, purpose, documentNumber: row.number.trim().slice(0, 60), matchStatus: "unmatched" }
      const name = (purpose || counterpartyName || "Строка выписки").slice(0, 200)
      await ctx.db.insert("financeRecords", {
        externalId,
        moduleId: MODULE.moduleId,
        number,
        name,
        status: "draft",
        organizationExternalId: restaurant.organizationExternalId,
        restaurantExternalId: restaurant.externalId,
        businessDate: row.date,
        amount: row.amount,
        ...(counterparty ? { counterpartyExternalId: counterparty.externalId } : {}),
        data,
        searchText: [number, name, ...Object.values(data)].join(" ").toLocaleLowerCase("ru"),
        version: 1,
        createdAt: now,
        updatedAt: now,
      })
      imported += 1
      if (!periodFrom || row.date < periodFrom) periodFrom = row.date
      if (!periodTo || row.date > periodTo) periodTo = row.date
    }

    if (header) await ctx.db.patch(header._id, { importedCount: header.importedCount + imported, duplicateCount: header.duplicateCount + duplicates, periodFrom: periodFrom || header.periodFrom, periodTo: periodTo || header.periodTo })
    else {
      const first = args.rows.map((row) => row.date).sort()
      await ctx.db.insert("bankStatementImports", {
        externalId: args.statementExternalId,
        accountIban: iban,
        bank,
        organizationExternalId: restaurant.organizationExternalId,
        restaurantExternalId: restaurant.externalId,
        ...(args.fileName?.trim() ? { fileName: args.fileName.trim().slice(0, 200) } : {}),
        periodFrom: periodFrom || first[0],
        periodTo: periodTo || first[first.length - 1],
        importedCount: imported,
        duplicateCount: duplicates,
        importedAt: now,
        importedByEmail: email,
      })
    }
    await writeOfficeAudit(ctx, email, {
      action: "bank-statements.import",
      summary: `Выписка ${iban}: загружено ${imported} строк, повторов ${duplicates}`,
      resourceType: MODULE.moduleId,
      resourceExternalId: args.statementExternalId,
      restaurantExternalId: restaurant.externalId,
      capability: "office.bank-statements.edit",
      details: { imported, duplicates, bank },
    })
    if (imported) await appendOutboxEvent(ctx, { aggregateType: MODULE.moduleId, aggregateExternalId: args.statementExternalId, eventType: "bank-statement.imported", restaurantExternalId: restaurant.externalId, payload: { imported } })
    return { statementExternalId: args.statementExternalId, imported, duplicates }
  },
})

export type MatchCandidate = { kind: "payment" | "obligation"; externalId: string; number: string; name: string; amount: number; date: string; restaurantExternalId: string; status: string; exact: boolean }

/**
 * Payments (approved or posted, by bank, not yet on another line) and open obligations of the line's
 * counterparty in the same organization and the user's restaurants, in the line's direction. `exact`:
 * the same amount and a date within ±3 days (an obligation: of its due date, or on/after it without one).
 */
async function candidatesFor(ctx: QueryCtx, line: FinanceRecord, user: ScopedUser): Promise<MatchCandidate[]> {
  const counterparty = line.counterpartyExternalId
  if (!counterparty) return []
  const inScope = restaurantScopeFilter(user)
  const outgoing = line.data.direction === "outgoing"
  const near = (date: string) => Math.abs(dayNumber(date) - dayNumber(line.businessDate)) <= MATCH_DAYS
  const result: MatchCandidate[] = []
  const rows = async function* (moduleId: "payments" | "accounts-payable") {
    let scanned = 0
    for await (const row of ctx.db.query("financeRecords").withIndex("by_counterparty_module", (q) => q.eq("counterpartyExternalId", counterparty).eq("moduleId", moduleId))) {
      if ((scanned += 1) > CANDIDATE_SCAN) return
      if (row.organizationExternalId === line.organizationExternalId && inScope(row.restaurantExternalId)) yield row
    }
  }
  for await (const row of rows("payments")) {
    if (row.status !== "approved" && row.status !== "posted") continue
    if ((row.data.direction === "outgoing") !== outgoing || row.data.method !== "bank") continue
    const linked = text(row.data.bankLineExternalId)
    if (linked && linked !== line.externalId) continue
    result.push({ kind: "payment", externalId: row.externalId, number: row.number, name: row.name, amount: row.amount, date: row.businessDate, restaurantExternalId: row.restaurantExternalId, status: row.status, exact: row.amount === line.amount && near(row.businessDate) })
  }
  for await (const row of rows("accounts-payable")) {
    if (row.status !== "posted" || row.amount <= 0 || (row.data.direction === "payable") !== outgoing) continue
    const due = text(row.data.dueDate)
    const onTime = DATE.test(due) ? near(due) : line.businessDate >= row.businessDate
    result.push({ kind: "obligation", externalId: row.externalId, number: row.number, name: row.name, amount: row.amount, date: DATE.test(due) ? due : row.businessDate, restaurantExternalId: row.restaurantExternalId, status: row.status, exact: row.amount === line.amount && onTime })
  }
  const distance = (candidate: MatchCandidate) => Math.abs(candidate.amount - line.amount) * 1000 + Math.abs(dayNumber(candidate.date) - dayNumber(line.businessDate))
  return result.sort((a, b) => Number(b.exact) - Number(a.exact) || (a.kind === b.kind ? 0 : a.kind === "payment" ? -1 : 1) || distance(a) - distance(b)).slice(0, 20)
}

/** A draft line that may still be matched. */
function assertMatchable(line: FinanceRecord) {
  if (line.status !== "draft") throw new ConvexError("Сопоставление меняется только у непроведённой строки")
}

async function setMatch(ctx: MutationCtx, line: FinanceRecord, target: MatchCandidate | null) {
  const previous = text(line.data.matchedPaymentExternalId)
  if (previous && previous !== target?.externalId) await unlinkBankPayment(ctx, previous, line.externalId)
  const { matchedPaymentExternalId: _payment, matchedObligationExternalId: _obligation, matchedNumber: _number, ...rest } = withoutSuggestion(line.data)
  const data = target
    ? { ...rest, matchStatus: "matched", matchedNumber: target.number, ...(target.kind === "payment" ? { matchedPaymentExternalId: target.externalId } : { matchedObligationExternalId: target.externalId }) }
    : { ...rest, matchStatus: "unmatched" }
  await ctx.db.patch(line._id, { data, version: line.version + 1, updatedAt: Date.now() })
  if (target?.kind === "payment") {
    const payment = (await financeRecord(ctx, target.externalId))!
    if (payment.data.bankLineExternalId !== line.externalId) await ctx.db.patch(payment._id, { data: { ...payment.data, bankLineExternalId: line.externalId }, version: payment.version + 1, updatedAt: Date.now() })
  }
}

/**
 * Suggests a match for each open line of a statement: the only exact payment, or — without one — the only
 * exact obligation. Several equally good candidates, or none, leave the line for manual matching; a
 * candidate is suggested to one line of the run only. Lines whose BIN now has a counterparty get it.
 */
export const autoMatch = mutation({
  args: { statementExternalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.bank-statements.edit")
    const header = await ctx.db.query("bankStatementImports").withIndex("by_external_id", (q) => q.eq("externalId", args.statementExternalId)).unique()
    if (!header) throw new ConvexError("Выписка не найдена")
    await requireRestaurantScope(ctx, user, header.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    const lines: FinanceRecord[] = []
    let scanned = 0
    const range = ctx.db.query("financeRecords").withIndex("by_module_restaurant_date", (q) => q.eq("moduleId", "bank-statements").eq("restaurantExternalId", header.restaurantExternalId).gte("businessDate", header.periodFrom).lte("businessDate", header.periodTo))
    for await (const row of range) {
      if ((scanned += 1) > STATEMENT_SCAN) break
      if (row.data.statementExternalId === header.externalId && row.status === "draft" && (row.data.matchStatus === "unmatched" || row.data.matchStatus === "suggested")) lines.push(row)
    }
    const used = new Set<string>()
    let suggested = 0
    for (let line of lines) {
      if (!line.counterpartyExternalId) {
        const counterparty = await counterpartyByBin(ctx, text(line.data.bin))
        if (counterparty) {
          await ctx.db.patch(line._id, { counterpartyExternalId: counterparty.externalId })
          line = { ...line, counterpartyExternalId: counterparty.externalId }
        }
      }
      const exact = (await candidatesFor(ctx, line, user)).filter((candidate) => candidate.exact && !used.has(candidate.externalId))
      const payments = exact.filter((candidate) => candidate.kind === "payment")
      const pick = payments.length === 1 ? payments[0] : !payments.length && exact.length === 1 ? exact[0] : null
      const base = withoutSuggestion(line.data)
      if (pick) {
        used.add(pick.externalId)
        suggested += 1
        await ctx.db.patch(line._id, { data: { ...base, matchStatus: "suggested", suggestedExternalId: pick.externalId, suggestedKind: pick.kind, suggestedNumber: pick.number }, version: line.version + 1, updatedAt: Date.now() })
      } else if (line.data.matchStatus === "suggested") {
        await ctx.db.patch(line._id, { data: { ...base, matchStatus: "unmatched" }, version: line.version + 1, updatedAt: Date.now() })
      }
    }
    await writeOfficeAudit(ctx, email, { action: "bank-statements.auto-match", summary: `Выписка ${header.accountIban}: предложено ${suggested} из ${lines.length}`, resourceType: MODULE.moduleId, resourceExternalId: header.externalId, restaurantExternalId: header.restaurantExternalId, capability: "office.bank-statements.edit" })
    return { checked: lines.length, suggested, unmatched: lines.length - suggested }
  },
})

/** The line's card: its counterparty and what it may be matched to. */
export const matchCandidates = query({
  args: { lineExternalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.bank-statements.view")
    const line = await bankLine(ctx, user, args.lineExternalId)
    const counterparty = line.counterpartyExternalId ? await financeRecord(ctx, line.counterpartyExternalId) : null
    return {
      counterparty: counterparty ? { externalId: counterparty.externalId, name: counterparty.name, bin: counterparty.bin ?? null } : null,
      candidates: await candidatesFor(ctx, line, user),
    }
  },
})

/** Matches a line to one of its candidates (a suggestion confirmed, or a manual pick). */
export const confirmMatch = mutation({
  args: { lineExternalId: v.string(), targetExternalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.bank-statements.edit")
    const line = await bankLine(ctx, user, args.lineExternalId)
    assertMatchable(line)
    const target = (await candidatesFor(ctx, line, user)).find((candidate) => candidate.externalId === args.targetExternalId)
    if (!target) throw new ConvexError("Платёж или обязательство не подходит к строке — другой контрагент, направление или уже сопоставлен")
    // A payment is the same money as the line; an obligation may be settled partly or with an advance.
    if (target.kind === "payment" && target.amount !== line.amount) throw new ConvexError(`Сумма платежа ${target.number} отличается от строки выписки`)
    await setMatch(ctx, line, target)
    const email = (await getOfficeAuthEmail(ctx))!
    await writeOfficeAudit(ctx, email, { action: "bank-statements.match", summary: `Строка выписки ${line.number} сопоставлена с ${target.number}`, resourceType: MODULE.moduleId, resourceExternalId: line.externalId, restaurantExternalId: line.restaurantExternalId, capability: "office.bank-statements.edit", details: { target: target.externalId, kind: target.kind } })
    return { matchStatus: "matched" as const, number: target.number }
  },
})

export const unmatch = mutation({
  args: { lineExternalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.bank-statements.edit")
    const line = await bankLine(ctx, user, args.lineExternalId)
    assertMatchable(line)
    await setMatch(ctx, line, null)
    const email = (await getOfficeAuthEmail(ctx))!
    await writeOfficeAudit(ctx, email, { action: "bank-statements.unmatch", summary: `Строка выписки ${line.number}: сопоставление снято`, resourceType: MODULE.moduleId, resourceExternalId: line.externalId, restaurantExternalId: line.restaurantExternalId, capability: "office.bank-statements.edit" })
    return { matchStatus: "unmatched" as const }
  },
})

/** Last imports of a restaurant, for «Сопоставить автоматически» after the import. */
export const recentImports = query({
  args: { restaurantExternalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.bank-statements.view")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const rows = await ctx.db.query("bankStatementImports").withIndex("by_restaurant_imported", (q) => q.eq("restaurantExternalId", args.restaurantExternalId)).order("desc").take(20)
    return rows.map(({ externalId, accountIban, bank, fileName, periodFrom, periodTo, importedCount, duplicateCount, importedAt }) => ({ externalId, accountIban, bank, fileName: fileName ?? null, periodFrom, periodTo, importedCount, duplicateCount, importedAt }))
  },
})

// ── Column mapping per bank account ──────────────────────────────────────────

const PROFILE_FIELDS = ["date", "number", "amount", "debit", "credit", "direction", "counterparty", "bin", "purpose"]

const profileArgs = {
  accountIban: v.string(),
  restaurantExternalId: v.string(),
  bank: v.string(),
  encoding: v.union(v.literal("auto"), v.literal("utf-8"), v.literal("windows-1251")),
  delimiter: v.union(v.literal("auto"), v.literal(";"), v.literal(",")),
  amountMode: v.union(v.literal("signed"), v.literal("direction"), v.literal("debit-credit")),
  columns: v.array(v.object({ field: v.string(), header: v.optional(v.string()), index: v.optional(v.number()) })),
  incomingValues: v.optional(v.string()),
  hasHeader: v.boolean(),
}

/** Saved mappings of the bank accounts in the user's restaurants. */
export const importProfiles = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireOfficeCapability(ctx, "office.bank-statements.view")
    const inScope = restaurantScopeFilter(user)
    const rows = await ctx.db.query("bankImportProfiles").withIndex("by_iban").take(200)
    return rows.filter((row) => inScope(row.restaurantExternalId)).map(({ _id, _creationTime, updatedByEmail: _by, ...row }) => row)
  },
})

/** Saves (or replaces) the mapping of one bank account; the next import of that account starts from it. */
export const saveImportProfile = mutation({
  args: profileArgs,
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.bank-statements.edit")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    const accountIban = normalizeIban(args.accountIban)
    if (!IBAN.test(accountIban)) throw new ConvexError("Счёт — IBAN: KZ и 18 символов")
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.restaurantExternalId)).unique()
    if (!restaurant) throw new ConvexError("Ресторан не найден")
    const fields = new Set<string>()
    for (const column of args.columns) {
      if (!PROFILE_FIELDS.includes(column.field) || fields.has(column.field)) throw new ConvexError("Колонки сопоставлены неверно")
      if (column.index !== undefined && !(Number.isInteger(column.index) && column.index >= 0 && column.index < 100)) throw new ConvexError("Номер колонки — от 1 до 100")
      if (!column.header?.trim() && column.index === undefined) throw new ConvexError("Укажите колонку по заголовку или номеру")
      fields.add(column.field)
    }
    const required = ["date", "counterparty", "purpose", ...(args.amountMode === "debit-credit" ? ["debit", "credit"] : ["amount"]), ...(args.amountMode === "direction" ? ["direction"] : [])]
    const missing = required.filter((field) => !fields.has(field))
    if (missing.length) throw new ConvexError(`Не выбраны колонки: ${missing.join(", ")}`)
    const existing = await ctx.db.query("bankImportProfiles").withIndex("by_iban", (q) => q.eq("accountIban", accountIban)).unique()
    if (existing && existing.organizationExternalId !== restaurant.organizationExternalId) throw new ConvexError("Счёт принадлежит другой организации")
    if (existing && !restaurantScopeFilter(user)(existing.restaurantExternalId)) throw new ConvexError("Нет доступа к ресторану")
    const { incomingValues, ...rest } = args
    const row = {
      ...rest,
      accountIban,
      bank: args.bank.trim().slice(0, 40) || "manual",
      columns: args.columns.map((column) => ({ field: column.field, ...(column.header?.trim() ? { header: column.header.trim().slice(0, 100) } : {}), ...(column.index !== undefined ? { index: column.index } : {}) })),
      ...(incomingValues?.trim() ? { incomingValues: incomingValues.trim().slice(0, 200) } : {}),
      organizationExternalId: restaurant.organizationExternalId,
      updatedAt: Date.now(),
      updatedByEmail: email,
    }
    if (existing) await ctx.db.replace(existing._id, row)
    else await ctx.db.insert("bankImportProfiles", row)
    await writeOfficeAudit(ctx, email, { action: "bank-statements.mapping", summary: `Сопоставление колонок для счёта ${accountIban} (${row.bank})`, resourceType: MODULE.moduleId, resourceExternalId: accountIban, restaurantExternalId: restaurant.externalId, capability: "office.bank-statements.edit" })
    return { accountIban }
  },
})
