import { almatyBusinessDate } from "@/shared/lib/almaty-time"

import type { FinanceRecord, JournalRow, SaveFinanceRecordArgs } from "../data/use-finance-records"

// Module rules the office checks before a call (W1-FIN-03…06): the same as convex/domains/finance/modules.ts,
// so a typo never reaches the server; the server checks everything again.

export type StatusTab = { value: string; label: string; status?: "active" | "inactive" | "draft" | "posted" | "reversed" }

/** master: «Все / Активные / Неактивные» (OFFICE-DESIGN §3.5). */
export const MASTER_TABS: StatusTab[] = [
  { value: "all", label: "Все" },
  { value: "active", label: "Активные", status: "active" },
  { value: "inactive", label: "Неактивные", status: "inactive" },
]

/** document: «Все / Черновики / Проведённые / Сторно». */
export const DOCUMENT_TABS: StatusTab[] = [
  { value: "all", label: "Все" },
  { value: "draft", label: "Черновики", status: "draft" },
  { value: "posted", label: "Проведённые", status: "posted" },
  { value: "reversed", label: "Сторно", status: "reversed" },
]

export const todayBusinessDate = () => almatyBusinessDate(Date.now())

/** YYYY-MM-DD shifted by whole days. */
export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

/** The last 30 days including today — the default journal period («Проводок за 30 дней»). */
export function last30Days(today = todayBusinessDate()) {
  return { from: shiftDate(today, -29), to: today }
}

/** 2026-09-24 → 24.09.2026. */
export function formatBusinessDate(date: string) {
  return date.split("-").reverse().join(".")
}

const text = (value: unknown) => (typeof value === "string" ? value : "")

// ── Статьи ДДС (W1-FIN-03) ──────────────────────────────────────────────────

export type CashflowDirection = "incoming" | "outgoing" | "both"
export type CashflowActivity = "operating" | "investing" | "financing"

export const DIRECTION_LABELS: Record<CashflowDirection, string> = { incoming: "Приход", outgoing: "Расход", both: "Приход и расход" }
export const ACTIVITY_LABELS: Record<CashflowActivity, string> = { operating: "Операционная", investing: "Инвестиционная", financing: "Финансовая" }

export interface CashflowDraft {
  name: string
  code: string
  direction: CashflowDirection | ""
  activity: CashflowActivity | ""
  parentExternalId: string
  restaurantExternalId: string
}

export function cashflowDraftOf(record: FinanceRecord | null, restaurantExternalId: string): CashflowDraft {
  return {
    name: record?.name ?? "",
    code: text(record?.data.code),
    direction: (text(record?.data.direction) as CashflowDirection) || "",
    activity: (text(record?.data.activity) as CashflowActivity) || (record ? "" : "operating"),
    parentExternalId: text(record?.data.parentExternalId),
    restaurantExternalId: record?.restaurantExternalId ?? restaurantExternalId,
  }
}

export type DraftErrors<K extends string> = Partial<Record<K, string>>

export function validateCashflow(draft: CashflowDraft, parentDirection?: string): DraftErrors<keyof CashflowDraft> {
  const errors: DraftErrors<keyof CashflowDraft> = {}
  if (!draft.name.trim()) errors.name = "Укажите название статьи"
  if (!draft.code.trim()) errors.code = "Укажите код статьи"
  if (!draft.direction) errors.direction = "Выберите направление"
  if (!draft.activity) errors.activity = "Выберите вид деятельности"
  if (!draft.restaurantExternalId) errors.restaurantExternalId = "Выберите ресторан"
  if (draft.parentExternalId && parentDirection && draft.direction && parentDirection !== "both" && parentDirection !== draft.direction) errors.parentExternalId = "Родительская статья другого направления"
  return errors
}

export function cashflowSaveArgs(draft: CashflowDraft, record: FinanceRecord | null): SaveFinanceRecordArgs {
  return {
    moduleId: "cashflow-categories",
    ...(record ? { externalId: record.externalId, expectedVersion: record.version } : {}),
    name: draft.name.trim(),
    restaurantExternalId: draft.restaurantExternalId,
    businessDate: record?.businessDate ?? todayBusinessDate(),
    amount: 0,
    data: {
      code: draft.code.trim(),
      direction: draft.direction,
      activity: draft.activity,
      ...(draft.parentExternalId ? { parentExternalId: draft.parentExternalId } : {}),
    },
  }
}

// ── Контрагенты (W1-FIN-04) ─────────────────────────────────────────────────

export type CounterpartyRole = "supplier" | "customer" | "aggregator"
export const ROLE_LABELS: Record<CounterpartyRole, string> = { supplier: "Поставщик", customer: "Покупатель", aggregator: "Агрегатор" }
export const ROLES = Object.keys(ROLE_LABELS) as CounterpartyRole[]

/** "supplier, customer" → ["supplier", "customer"] (unknown values are dropped). */
export function parseRoles(value: unknown): CounterpartyRole[] {
  return text(value)
    .split(",")
    .map((role) => role.trim())
    .filter((role): role is CounterpartyRole => ROLES.includes(role as CounterpartyRole))
}

export interface CounterpartyDraft {
  name: string
  roles: CounterpartyRole[]
  bin: string
  legalAddress: string
  bankAccount: string
  bankBic: string
  contract: string
  paymentDelayDays: string
  contact: string
  vatPayer: boolean
  restaurantExternalId: string
}

export function counterpartyDraftOf(record: FinanceRecord | null, restaurantExternalId: string): CounterpartyDraft {
  const delay = record?.data.paymentDelayDays
  return {
    name: record?.name ?? "",
    roles: record ? parseRoles(record.data.roles) : ["supplier"],
    bin: text(record?.data.bin),
    legalAddress: text(record?.data.legalAddress),
    bankAccount: text(record?.data.bankAccount),
    bankBic: text(record?.data.bankBic),
    contract: text(record?.data.contract),
    paymentDelayDays: typeof delay === "number" ? String(delay) : "",
    contact: text(record?.data.contact),
    vatPayer: record?.data.vatPayer === true,
    restaurantExternalId: record?.restaurantExternalId ?? restaurantExternalId,
  }
}

export const normalizeIban = (value: string) => value.replace(/\s+/g, "").toUpperCase()

export function validateCounterparty(draft: CounterpartyDraft): DraftErrors<keyof CounterpartyDraft> {
  const errors: DraftErrors<keyof CounterpartyDraft> = {}
  if (!draft.name.trim()) errors.name = "Укажите название"
  if (!draft.roles.length) errors.roles = "Выберите хотя бы одну роль"
  if (!/^\d{12}$/.test(draft.bin.trim())) errors.bin = "БИН / ИИН — 12 цифр"
  const iban = normalizeIban(draft.bankAccount)
  if (iban && !/^KZ\d{2}[A-Z0-9]{16}$/.test(iban)) errors.bankAccount = "IBAN — KZ и 18 символов"
  if (draft.bankBic.trim() && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(draft.bankBic.trim().toUpperCase())) errors.bankBic = "БИК — 8 или 11 символов"
  const delay = draft.paymentDelayDays.trim()
  if (delay && (!/^\d+$/.test(delay) || Number(delay) > 365)) errors.paymentDelayDays = "От 0 до 365 дней"
  if (!draft.restaurantExternalId) errors.restaurantExternalId = "Выберите ресторан"
  return errors
}

export function counterpartySaveArgs(draft: CounterpartyDraft, record: FinanceRecord | null): SaveFinanceRecordArgs {
  const optional = (key: string, value: string) => (value.trim() ? { [key]: value.trim() } : {})
  return {
    moduleId: "counterparties",
    ...(record ? { externalId: record.externalId, expectedVersion: record.version } : {}),
    name: draft.name.trim(),
    restaurantExternalId: draft.restaurantExternalId,
    businessDate: record?.businessDate ?? todayBusinessDate(),
    amount: 0,
    data: {
      roles: ROLES.filter((role) => draft.roles.includes(role)).join(","),
      bin: draft.bin.trim(),
      bankAccount: normalizeIban(draft.bankAccount),
      vatPayer: draft.vatPayer,
      ...optional("bankBic", draft.bankBic.toUpperCase()),
      ...optional("legalAddress", draft.legalAddress),
      ...optional("contract", draft.contract),
      ...optional("contact", draft.contact),
      ...(draft.paymentDelayDays.trim() ? { paymentDelayDays: Number(draft.paymentDelayDays.trim()) } : {}),
    },
  }
}

// ── Проводки (W1-FIN-05) ────────────────────────────────────────────────────

export interface TransactionDraft {
  name: string
  restaurantExternalId: string
  businessDate: string
  amount: number | null
  debitAccountExternalId: string
  creditAccountExternalId: string
  cashflowCategoryExternalId: string
  counterpartyExternalId: string
  documentReference: string
  comment: string
}

export function transactionDraftOf(record: FinanceRecord | null, restaurantExternalId: string): TransactionDraft {
  return {
    name: record?.name ?? "",
    restaurantExternalId: record?.restaurantExternalId ?? restaurantExternalId,
    businessDate: record?.businessDate ?? todayBusinessDate(),
    amount: record ? record.amount : null,
    debitAccountExternalId: record?.debitAccountExternalId ?? "",
    creditAccountExternalId: record?.creditAccountExternalId ?? "",
    cashflowCategoryExternalId: record?.cashflowCategoryExternalId ?? "",
    counterpartyExternalId: record?.counterpartyExternalId ?? "",
    documentReference: text(record?.data.documentReference),
    comment: text(record?.data.comment),
  }
}

export function validateTransaction(draft: TransactionDraft): DraftErrors<keyof TransactionDraft> {
  const errors: DraftErrors<keyof TransactionDraft> = {}
  if (!draft.name.trim()) errors.name = "Укажите содержание операции"
  if (!draft.restaurantExternalId) errors.restaurantExternalId = "Выберите ресторан"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.businessDate)) errors.businessDate = "Укажите дату"
  if (!draft.amount || draft.amount <= 0) errors.amount = "Сумма должна быть больше нуля"
  if (!draft.debitAccountExternalId) errors.debitAccountExternalId = "Выберите счёт дебета"
  if (!draft.creditAccountExternalId) errors.creditAccountExternalId = "Выберите счёт кредита"
  else if (draft.creditAccountExternalId === draft.debitAccountExternalId) errors.creditAccountExternalId = "Дебет и кредит должны отличаться"
  return errors
}

export function transactionSaveArgs(draft: TransactionDraft, record: FinanceRecord | null): SaveFinanceRecordArgs {
  return {
    moduleId: "transactions",
    ...(record ? { externalId: record.externalId, expectedVersion: record.version } : {}),
    name: draft.name.trim(),
    restaurantExternalId: draft.restaurantExternalId,
    businessDate: draft.businessDate,
    amount: draft.amount ?? 0,
    debitAccountExternalId: draft.debitAccountExternalId,
    creditAccountExternalId: draft.creditAccountExternalId,
    ...(draft.cashflowCategoryExternalId ? { cashflowCategoryExternalId: draft.cashflowCategoryExternalId } : {}),
    ...(draft.counterpartyExternalId ? { counterpartyExternalId: draft.counterpartyExternalId } : {}),
    data: { comment: draft.comment.trim(), ...(draft.documentReference.trim() ? { documentReference: draft.documentReference.trim() } : {}) },
  }
}

/** Journal sources: the Russian name and, when the office has the document's page, its section. */
export const JOURNAL_SOURCES: Record<string, { label: string; section?: string }> = {
  orders: { label: "Касса · заказ" },
  receipts: { label: "Приходная накладная", section: "receipts" },
  "outgoing-invoices": { label: "Расходная накладная", section: "outgoing-invoices" },
  "supplier-returns": { label: "Возврат поставщику", section: "supplier-returns" },
  inventories: { label: "Инвентаризация", section: "inventories" },
  transfers: { label: "Перемещение", section: "transfers" },
  writeoffs: { label: "Акт списания", section: "writeoffs" },
  transactions: { label: "Ручная операция", section: "transactions" },
  "shift-acceptance": { label: "Принятие смены" },
  "cash-operations": { label: "Внесение / изъятие" },
  stock: { label: "Склад" },
  "manual-expense": { label: "Ручной расход" },
}

export const sourceLabel = (sourceModuleId: string) => JOURNAL_SOURCES[sourceModuleId]?.label ?? sourceModuleId

/** Where a journal line leads: its source document, or null when the office has no page for it. */
export function sourceHref(row: Pick<JournalRow, "sourceModuleId" | "sourceExternalId">) {
  const section = JOURNAL_SOURCES[row.sourceModuleId]?.section
  return section ? `/office/${section}/${encodeURIComponent(row.sourceExternalId)}` : null
}

export const accountLabel = (account: { code: string; name: string } | null | undefined) => (account ? `${account.code} · ${account.name}` : "—")

// ── Принятие смен (W1-FIN-06) ───────────────────────────────────────────────

/** Accounts the variance posting uses (convex/lib/accounts SYSTEM_ACCOUNTS). */
export const SHIFT_VARIANCE_ACCOUNTS = {
  cash: { externalId: "acc-1010", code: "1010", name: "Касса" },
  otherIncome: { externalId: "acc-6280", code: "6280", name: "Прочие доходы" },
  cashShortage: { externalId: "acc-7480", code: "7480", name: "Недостачи" },
} as const

type AccountName = { externalId: string; code: string; name: string }

/** What «Принять» will post: surplus Dr cash / Cr other income, shortage Dr shortages / Cr cash, none when equal. */
export function variancePosting(expectedCash: number, recountedCash: number | null, accounts: readonly AccountName[] = []) {
  if (recountedCash === null) return null
  const variance = recountedCash - expectedCash
  const pick = (key: keyof typeof SHIFT_VARIANCE_ACCOUNTS) => accounts.find((account) => account.externalId === SHIFT_VARIANCE_ACCOUNTS[key].externalId) ?? SHIFT_VARIANCE_ACCOUNTS[key]
  if (variance === 0) return { variance, kind: "none" as const, debit: null, credit: null }
  return variance > 0 ? { variance, kind: "surplus" as const, debit: pick("cash"), credit: pick("otherIncome") } : { variance, kind: "shortage" as const, debit: pick("cashShortage"), credit: pick("cash") }
}

/** The comment is required when the recount differs from the expected cash. */
export function validateAcceptance(expectedCash: number, recountedCash: number | null, note: string) {
  const errors: { recountedCash?: string; note?: string } = {}
  if (recountedCash === null) errors.recountedCash = "Введите пересчитанную наличность"
  else if (recountedCash !== expectedCash && note.trim().length < 3) errors.note = "При расхождении укажите комментарий"
  return errors
}
