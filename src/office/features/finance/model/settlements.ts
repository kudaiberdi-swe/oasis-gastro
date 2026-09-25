import type { FinanceRecord, SaveFinanceRecordArgs } from "../data/use-finance-records"
import { JOURNAL_SOURCES, todayBusinessDate, type DraftErrors } from "./modules"

// Services, obligations and payments (W2-FIN-08…10): the same rules as convex/domains/finance/modules.ts
// and obligations.ts, checked before a call so a typo never reaches the server; the server checks again.

const text = (value: unknown) => (typeof value === "string" ? value : "")
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0)
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** convex/lib/obligations obligationExternalId: the obligation a document creates when posted. */
export const obligationExternalId = (sourceModuleId: string, sourceExternalId: string, part = "main") => `obligation:${sourceModuleId}:${sourceExternalId}:${part}`

/** Amount includes VAT; the VAT part — as the server computes it. */
export const vatOf = (amount: number, vatRate: number) => (vatRate ? Math.round((amount * vatRate) / (100 + vatRate)) : 0)

// ── Акты услуг (W2-FIN-08) ──────────────────────────────────────────────────

export type ServiceDirection = "received" | "provided"
export const SERVICE_DIRECTION_LABELS: Record<ServiceDirection, string> = { received: "Полученная услуга", provided: "Оказанная услуга" }
export const VAT_RATES = [0, 12] as const

/** Accounts the server puts when the card leaves Дебет / Кредит empty. */
export const SERVICE_DEFAULT_ACCOUNTS: Record<ServiceDirection, { debit: string; credit: string }> = {
  received: { debit: "acc-7210", credit: "acc-3310" },
  provided: { debit: "acc-1210", credit: "acc-6030" },
}

export interface ServiceDraft {
  name: string
  restaurantExternalId: string
  businessDate: string
  amount: number | null
  serviceDirection: ServiceDirection
  counterpartyExternalId: string
  /** "" — the direction's default account. */
  debitAccountExternalId: string
  creditAccountExternalId: string
  vatRate: number
  contract: string
  dueDate: string
  description: string
}

export function serviceDraftOf(record: FinanceRecord | null, restaurantExternalId: string): ServiceDraft {
  const direction: ServiceDirection = record?.data.serviceDirection === "provided" ? "provided" : "received"
  const defaults = SERVICE_DEFAULT_ACCOUNTS[direction]
  const vatRate = num(record?.data.vatRate)
  return {
    name: record?.name ?? "",
    restaurantExternalId: record?.restaurantExternalId ?? restaurantExternalId,
    businessDate: record?.businessDate ?? todayBusinessDate(),
    amount: record ? record.amount : null,
    serviceDirection: direction,
    counterpartyExternalId: record?.counterpartyExternalId ?? "",
    // The server stores the default accounts on save: shown as «по умолчанию», so a direction change moves them.
    debitAccountExternalId: record?.debitAccountExternalId && record.debitAccountExternalId !== defaults.debit ? record.debitAccountExternalId : "",
    creditAccountExternalId: record?.creditAccountExternalId && record.creditAccountExternalId !== defaults.credit ? record.creditAccountExternalId : "",
    vatRate: vatRate === 12 ? 12 : 0,
    contract: text(record?.data.contract),
    dueDate: text(record?.data.dueDate),
    description: text(record?.data.description),
  }
}

export function validateService(draft: ServiceDraft): DraftErrors<keyof ServiceDraft> {
  const errors: DraftErrors<keyof ServiceDraft> = {}
  if (!draft.name.trim()) errors.name = "Укажите название акта"
  if (!draft.restaurantExternalId) errors.restaurantExternalId = "Выберите ресторан"
  if (!DATE.test(draft.businessDate)) errors.businessDate = "Укажите дату"
  if (!draft.amount || draft.amount <= 0) errors.amount = "Сумма акта должна быть больше нуля"
  if (!draft.counterpartyExternalId) errors.counterpartyExternalId = "Выберите контрагента"
  if (draft.dueDate && !DATE.test(draft.dueDate)) errors.dueDate = "Укажите дату"
  else if (draft.dueDate && draft.dueDate < draft.businessDate) errors.dueDate = "Срок оплаты раньше даты акта"
  const debit = draft.debitAccountExternalId || SERVICE_DEFAULT_ACCOUNTS[draft.serviceDirection].debit
  const credit = draft.creditAccountExternalId || SERVICE_DEFAULT_ACCOUNTS[draft.serviceDirection].credit
  if (debit === credit) errors.creditAccountExternalId = "Дебет и кредит должны отличаться"
  return errors
}

export function serviceSaveArgs(draft: ServiceDraft, record: FinanceRecord | null): SaveFinanceRecordArgs {
  const optional = (key: string, value: string) => (value.trim() ? { [key]: value.trim() } : {})
  return {
    moduleId: "services",
    ...(record ? { externalId: record.externalId, expectedVersion: record.version } : {}),
    name: draft.name.trim(),
    restaurantExternalId: draft.restaurantExternalId,
    businessDate: draft.businessDate,
    amount: draft.amount ?? 0,
    counterpartyExternalId: draft.counterpartyExternalId,
    ...(draft.debitAccountExternalId ? { debitAccountExternalId: draft.debitAccountExternalId } : {}),
    ...(draft.creditAccountExternalId ? { creditAccountExternalId: draft.creditAccountExternalId } : {}),
    data: {
      serviceDirection: draft.serviceDirection,
      vatRate: draft.vatRate,
      ...optional("dueDate", draft.dueDate),
      ...optional("contract", draft.contract),
      ...optional("description", draft.description),
    },
  }
}

// ── Задолженность (W2-FIN-09) ───────────────────────────────────────────────

export type ObligationDirection = "payable" | "receivable"
export type ObligationKind = "supplier" | "service" | "tax" | "payroll" | "other"
export const OBLIGATION_DIRECTION_LABELS: Record<ObligationDirection, string> = { payable: "Кредиторская", receivable: "Дебиторская" }
export const OBLIGATION_KIND_LABELS: Record<ObligationKind, string> = { supplier: "Поставщику", service: "По услугам", tax: "Налоги и взносы", payroll: "Зарплата", other: "Прочее" }
export const OBLIGATION_KINDS = Object.keys(OBLIGATION_KIND_LABELS) as ObligationKind[]

/** Manual obligations have no source document of their own. */
export const MANUAL_SOURCE = "accounts-payable"

/** The fields of an obligation row, read from its data (convex/lib/obligations createObligation). */
export function obligationOf(record: FinanceRecord) {
  const original = num(record.data.originalAmount) || record.amount
  const sourceModuleId = text(record.data.sourceModuleId)
  const kind = text(record.data.obligationKind)
  return {
    direction: (record.data.direction === "receivable" ? "receivable" : "payable") as ObligationDirection,
    original,
    allocated: num(record.data.allocatedAmount),
    open: record.amount,
    dueDate: text(record.data.dueDate),
    kind: (OBLIGATION_KINDS.includes(kind as ObligationKind) ? kind : "other") as ObligationKind,
    comment: text(record.data.comment),
    sourceModuleId,
    sourceExternalId: text(record.data.sourceExternalId),
    sourceNumber: text(record.data.sourceNumber),
    manual: !sourceModuleId || sourceModuleId === MANUAL_SOURCE,
  }
}

/** Past its due date (a business date, Almaty) with something still open. */
export const isOverdue = (dueDate: string, open: number, today = todayBusinessDate()) => Boolean(dueDate) && dueDate < today && open > 0

/** Where an obligation leads: its source document's page, or null when the office has none. */
export function obligationSourceHref(sourceModuleId: string, sourceExternalId: string) {
  if (!sourceExternalId || sourceModuleId === MANUAL_SOURCE) return null
  const section = JOURNAL_SOURCES[sourceModuleId]?.section
  return section ? `/office/${section}/${encodeURIComponent(sourceExternalId)}` : null
}

export const obligationSourceLabel = (sourceModuleId: string) => (sourceModuleId && sourceModuleId !== MANUAL_SOURCE ? (JOURNAL_SOURCES[sourceModuleId]?.label ?? sourceModuleId) : "Ручная запись")

export interface ObligationDraft {
  name: string
  restaurantExternalId: string
  businessDate: string
  amount: number | null
  direction: ObligationDirection
  counterpartyExternalId: string
  kind: ObligationKind
  dueDate: string
  comment: string
}

export function obligationDraftOf(record: FinanceRecord | null, restaurantExternalId: string): ObligationDraft {
  const parsed = record ? obligationOf(record) : null
  return {
    name: record?.name ?? "",
    restaurantExternalId: record?.restaurantExternalId ?? restaurantExternalId,
    businessDate: record?.businessDate ?? todayBusinessDate(),
    amount: parsed ? parsed.original : null,
    direction: parsed?.direction ?? "payable",
    counterpartyExternalId: record?.counterpartyExternalId ?? "",
    kind: parsed?.kind ?? "other",
    dueDate: parsed?.dueDate ?? "",
    comment: parsed?.comment ?? "",
  }
}

export function validateObligation(draft: ObligationDraft): DraftErrors<keyof ObligationDraft> {
  const errors: DraftErrors<keyof ObligationDraft> = {}
  if (!draft.name.trim()) errors.name = "Укажите содержание обязательства"
  if (!draft.restaurantExternalId) errors.restaurantExternalId = "Выберите ресторан"
  if (!DATE.test(draft.businessDate)) errors.businessDate = "Укажите дату"
  if (!draft.amount || draft.amount <= 0 || !Number.isInteger(draft.amount)) errors.amount = "Сумма — целое число тенге больше нуля"
  if (!draft.counterpartyExternalId) errors.counterpartyExternalId = "Выберите контрагента — по нему подбираются платежи"
  if (draft.dueDate && !DATE.test(draft.dueDate)) errors.dueDate = "Укажите дату"
  else if (draft.dueDate && draft.dueDate < draft.businessDate) errors.dueDate = "Срок оплаты раньше даты записи"
  return errors
}

/** A manual obligation: `amount` is the open remainder, equal to the original until payments settle it. */
export function obligationSaveArgs(draft: ObligationDraft, record: FinanceRecord | null): SaveFinanceRecordArgs {
  const amount = draft.amount ?? 0
  return {
    moduleId: "accounts-payable",
    ...(record ? { externalId: record.externalId, expectedVersion: record.version } : {}),
    name: draft.name.trim(),
    restaurantExternalId: draft.restaurantExternalId,
    businessDate: draft.businessDate,
    amount,
    counterpartyExternalId: draft.counterpartyExternalId,
    data: {
      direction: draft.direction,
      originalAmount: amount,
      allocatedAmount: 0,
      dueDate: draft.dueDate || null,
      sourceModuleId: MANUAL_SOURCE,
      sourceExternalId: "",
      sourceNumber: "",
      obligationKind: draft.kind,
      ...(draft.comment.trim() ? { comment: draft.comment.trim() } : {}),
    },
  }
}

// ── Платежи (W2-FIN-10) ─────────────────────────────────────────────────────

export type PaymentDirection = "incoming" | "outgoing"
export type PaymentMethod = "cash" | "bank"
export const PAYMENT_DIRECTION_LABELS: Record<PaymentDirection, string> = { incoming: "Входящий", outgoing: "Исходящий" }
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = { cash: "Касса", bank: "Банк" }

/** An outgoing payment settles what we owe, an incoming one what we are owed. */
export const obligationDirectionFor = (direction: PaymentDirection): ObligationDirection => (direction === "outgoing" ? "payable" : "receivable")
export const paymentDirectionFor = (direction: ObligationDirection): PaymentDirection => (direction === "payable" ? "outgoing" : "incoming")

export type Allocation = { obligationExternalId: string; amount: number }

/** Sets one allocation line; zero or empty removes it. Kept sorted so a draft compares by value. */
export function withAllocation(allocations: Allocation[], obligationExternalId: string, amount: number | null) {
  const rest = allocations.filter((row) => row.obligationExternalId !== obligationExternalId)
  const next = amount && amount > 0 ? [...rest, { obligationExternalId, amount }] : rest
  return next.sort((a, b) => a.obligationExternalId.localeCompare(b.obligationExternalId))
}

export const allocatedTotal = (allocations: Allocation[]) => allocations.reduce((sum, row) => sum + row.amount, 0)

/** «Распределить»: the payment covers the oldest due obligations first (no due date — last). */
export function autoAllocate(amount: number, obligations: { externalId: string; open: number; dueDate: unknown }[]): Allocation[] {
  let left = Math.max(0, Math.floor(amount))
  const due = (value: unknown) => (typeof value === "string" && value ? value : "9999-12-31")
  const ordered = [...obligations].sort((a, b) => due(a.dueDate).localeCompare(due(b.dueDate)))
  let result: Allocation[] = []
  for (const row of ordered) {
    if (left <= 0) break
    const take = Math.min(left, row.open)
    if (take > 0) result = withAllocation(result, row.externalId, take)
    left -= take
  }
  return result
}

export interface PaymentDraft {
  name: string
  restaurantExternalId: string
  businessDate: string
  amount: number | null
  direction: PaymentDirection
  method: PaymentMethod
  counterpartyExternalId: string
  cashflowCategoryExternalId: string
  comment: string
  allocations: Allocation[]
}

export function paymentDraftOf(record: FinanceRecord | null, restaurantExternalId: string, allocations: Allocation[] = []): PaymentDraft {
  return {
    name: record?.name ?? "",
    restaurantExternalId: record?.restaurantExternalId ?? restaurantExternalId,
    businessDate: record?.businessDate ?? todayBusinessDate(),
    amount: record ? record.amount : null,
    direction: record?.data.direction === "incoming" ? "incoming" : "outgoing",
    method: record?.data.method === "cash" ? "cash" : "bank",
    counterpartyExternalId: record?.counterpartyExternalId ?? "",
    cashflowCategoryExternalId: record?.cashflowCategoryExternalId ?? "",
    comment: text(record?.data.comment),
    allocations: [...allocations].map(({ obligationExternalId, amount }) => ({ obligationExternalId, amount })).sort((a, b) => a.obligationExternalId.localeCompare(b.obligationExternalId)),
  }
}

/** `open` — the open remainder of each obligation the table knows about. */
export function validatePayment(draft: PaymentDraft, open: Record<string, number> = {}): DraftErrors<keyof PaymentDraft> {
  const errors: DraftErrors<keyof PaymentDraft> = {}
  if (!draft.name.trim()) errors.name = "Укажите назначение платежа"
  if (!draft.restaurantExternalId) errors.restaurantExternalId = "Выберите ресторан"
  if (!DATE.test(draft.businessDate)) errors.businessDate = "Укажите дату платежа"
  if (!draft.amount || draft.amount <= 0) errors.amount = "Сумма платежа должна быть больше нуля"
  if (!draft.counterpartyExternalId) errors.counterpartyExternalId = "Выберите контрагента"
  if (!draft.cashflowCategoryExternalId) errors.cashflowCategoryExternalId = "Выберите статью ДДС"
  const overOpen = draft.allocations.some((row) => open[row.obligationExternalId] !== undefined && row.amount > open[row.obligationExternalId])
  if (overOpen) errors.allocations = "Сумма платежа превышает открытый остаток обязательства"
  else if (draft.amount && allocatedTotal(draft.allocations) > draft.amount) errors.allocations = "Распределено больше суммы платежа"
  return errors
}

export function paymentSaveArgs(draft: PaymentDraft, record: FinanceRecord | null): SaveFinanceRecordArgs {
  return {
    moduleId: "payments",
    ...(record ? { externalId: record.externalId, expectedVersion: record.version } : {}),
    name: draft.name.trim(),
    restaurantExternalId: draft.restaurantExternalId,
    businessDate: draft.businessDate,
    amount: draft.amount ?? 0,
    counterpartyExternalId: draft.counterpartyExternalId,
    cashflowCategoryExternalId: draft.cashflowCategoryExternalId,
    data: { direction: draft.direction, method: draft.method, ...(draft.comment.trim() ? { comment: draft.comment.trim() } : {}) },
  }
}

/** «Оплатить» from a register row: /office/payments/new with the obligation to settle. */
export function payObligationHref(row: { externalId: string; counterpartyExternalId?: string; restaurantExternalId: string; direction: ObligationDirection }) {
  const params = new URLSearchParams({ obligation: row.externalId, counterparty: row.counterpartyExternalId ?? "", restaurant: row.restaurantExternalId, direction: row.direction })
  return `/office/payments/new?${params.toString()}`
}
