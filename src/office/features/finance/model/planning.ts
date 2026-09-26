import { almatyBusinessDate } from "@/shared/lib/almaty-time"
import { formatPercent } from "@/shared/lib/format"

import type { FinanceRecord, SaveFinanceRecordArgs } from "../data/use-finance-records"
import { todayBusinessDate, type DraftErrors } from "./modules"

// «Платёжный календарь» and «Бюджеты» (W3-FIN-12/13): the same rules as convex/domains/finance/modules.ts,
// checked before a call; the server checks again.

const text = (value: unknown) => (typeof value === "string" ? value : "")
const DATE = /^\d{4}-\d{2}-\d{2}$/

// ── Month grid (Almaty) ─────────────────────────────────────────────────────

/** The Almaty month (YYYY-MM) of a moment: 30.09 21:00 UTC is already October in Almaty. */
export const almatyMonth = (now = Date.now()) => almatyBusinessDate(now).slice(0, 7)

export function shiftMonth(month: string, delta: number) {
  const [year, value] = month.split("-").map(Number)
  const date = new Date(Date.UTC(year, value - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
}

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]
export const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

/** 2026-09 → «Сентябрь 2026». */
export const formatMonth = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`

/** Weeks of the month, Monday first; null pads the days of the neighbouring months. */
export function monthGrid(month: string): (string | null)[][] {
  const [year, value] = month.split("-").map(Number)
  const days = new Date(Date.UTC(year, value, 0)).getUTCDate()
  const offset = (new Date(Date.UTC(year, value - 1, 1)).getUTCDay() + 6) % 7
  const cells: (string | null)[] = [...Array<null>(offset).fill(null), ...Array.from({ length: days }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`)]
  while (cells.length % 7) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7))
}

// ── Платёжный календарь (W3-FIN-12) ─────────────────────────────────────────

export type Flow = "incoming" | "outgoing"
export type Priority = "required" | "normal" | "optional"
export const FLOW_LABELS: Record<Flow, string> = { incoming: "Поступление", outgoing: "Платёж" }
export const PRIORITY_LABELS: Record<Priority, string> = { required: "Обязательный", normal: "Обычный", optional: "Можно перенести" }

export interface CalendarDraft {
  name: string
  restaurantExternalId: string
  direction: Flow
  plannedAt: string
  amount: number | null
  priority: Priority
  counterpartyExternalId: string
  cashflowCategoryExternalId: string
  obligationExternalId: string
  sourceDocument: string
  comment: string
}

export function calendarDraftOf(record: FinanceRecord | null, restaurantExternalId: string): CalendarDraft {
  const priority = text(record?.data.priority)
  return {
    name: record?.name ?? "",
    restaurantExternalId: record?.restaurantExternalId ?? restaurantExternalId,
    direction: record?.data.direction === "incoming" ? "incoming" : "outgoing",
    plannedAt: text(record?.data.plannedAt) || (record ? record.businessDate : todayBusinessDate()),
    amount: record ? record.amount : null,
    priority: priority === "required" || priority === "optional" ? priority : "normal",
    counterpartyExternalId: record?.counterpartyExternalId ?? "",
    cashflowCategoryExternalId: record?.cashflowCategoryExternalId ?? "",
    obligationExternalId: text(record?.data.obligationExternalId),
    sourceDocument: text(record?.data.sourceDocument),
    comment: text(record?.data.comment),
  }
}

export function validateCalendar(draft: CalendarDraft): DraftErrors<keyof CalendarDraft> {
  const errors: DraftErrors<keyof CalendarDraft> = {}
  if (!draft.name.trim()) errors.name = "Укажите, что планируется"
  if (!draft.restaurantExternalId) errors.restaurantExternalId = "Выберите ресторан"
  if (!DATE.test(draft.plannedAt)) errors.plannedAt = "Укажите плановую дату"
  if (!draft.amount || draft.amount <= 0) errors.amount = "Сумма должна быть больше нуля"
  return errors
}

export function calendarSaveArgs(draft: CalendarDraft, record: FinanceRecord | null): SaveFinanceRecordArgs {
  const optional = (key: string, value: string) => (value.trim() ? { [key]: value.trim() } : {})
  return {
    moduleId: "payment-calendar",
    ...(record ? { externalId: record.externalId, expectedVersion: record.version } : {}),
    name: draft.name.trim(),
    restaurantExternalId: draft.restaurantExternalId,
    businessDate: record?.businessDate ?? todayBusinessDate(),
    amount: draft.amount ?? 0,
    ...(draft.counterpartyExternalId ? { counterpartyExternalId: draft.counterpartyExternalId } : {}),
    ...(draft.cashflowCategoryExternalId ? { cashflowCategoryExternalId: draft.cashflowCategoryExternalId } : {}),
    data: {
      direction: draft.direction,
      plannedAt: draft.plannedAt,
      priority: draft.priority,
      ...optional("obligationExternalId", draft.obligationExternalId),
      ...optional("sourceDocument", draft.sourceDocument),
      ...optional("comment", draft.comment),
    },
  }
}

// ── Бюджеты (W3-FIN-13) ─────────────────────────────────────────────────────

export type BudgetLineDraft = { key: string; kind: "account" | "category"; articleExternalId: string; planAmount: number | null }

export interface BudgetDraft {
  name: string
  restaurantExternalId: string
  periodStart: string
  periodEnd: string
  comment: string
  lines: BudgetLineDraft[]
}

const monthEnd = (month: string) => {
  const [year, value] = month.split("-").map(Number)
  return new Date(Date.UTC(year, value, 0)).toISOString().slice(0, 10)
}

export function budgetPeriodOf(record: Pick<FinanceRecord, "businessDate" | "data">) {
  const month = record.businessDate.slice(0, 7)
  const start = text(record.data.periodStart)
  const end = text(record.data.periodEnd)
  return { start: DATE.test(start) ? start : `${month}-01`, end: DATE.test(end) ? end : monthEnd(month) }
}

export const budgetVersionOf = (record: FinanceRecord) => (typeof record.data.budgetVersion === "number" ? record.data.budgetVersion : 1)

export function budgetDraftOf(record: FinanceRecord | null, restaurantExternalId: string, lines: { lineNo: number; accountExternalId?: string; cashflowCategoryExternalId?: string; planAmount: number }[] = []): BudgetDraft {
  const month = todayBusinessDate().slice(0, 7)
  const period = record ? budgetPeriodOf(record) : { start: `${month}-01`, end: monthEnd(month) }
  return {
    name: record?.name ?? "",
    restaurantExternalId: record?.restaurantExternalId ?? restaurantExternalId,
    periodStart: period.start,
    periodEnd: period.end,
    comment: text(record?.data.comment),
    lines: lines
      .filter((line) => line.accountExternalId || line.cashflowCategoryExternalId)
      .map((line) => ({ key: `line-${line.lineNo}`, kind: line.accountExternalId ? "account" : "category", articleExternalId: line.accountExternalId ?? line.cashflowCategoryExternalId ?? "", planAmount: line.planAmount })),
  }
}

export const budgetPlanTotal = (lines: BudgetLineDraft[]) => lines.reduce((sum, line) => sum + (line.planAmount ?? 0), 0)

export function validateBudget(draft: BudgetDraft): DraftErrors<keyof BudgetDraft> {
  const errors: DraftErrors<keyof BudgetDraft> = {}
  if (!draft.name.trim()) errors.name = "Укажите название бюджета"
  if (!draft.restaurantExternalId) errors.restaurantExternalId = "Выберите ресторан"
  if (!DATE.test(draft.periodStart)) errors.periodStart = "Укажите начало периода"
  if (!DATE.test(draft.periodEnd)) errors.periodEnd = "Укажите конец периода"
  else if (DATE.test(draft.periodStart) && draft.periodEnd < draft.periodStart) errors.periodEnd = "Конец периода раньше начала"
  const articles = draft.lines.map((line) => line.articleExternalId)
  if (!draft.lines.length) errors.lines = "Добавьте хотя бы одну строку"
  else if (draft.lines.some((line) => !line.articleExternalId)) errors.lines = "В каждой строке выберите счёт или статью"
  else if (new Set(articles).size !== articles.length) errors.lines = "Статья повторяется в бюджете"
  else if (draft.lines.some((line) => line.planAmount === null || line.planAmount < 0)) errors.lines = "Укажите план в каждой строке"
  return errors
}

/** The record: its date is the period start, its amount the lines' sum (the server recomputes it). */
export function budgetSaveArgs(draft: BudgetDraft, record: FinanceRecord | null): SaveFinanceRecordArgs {
  return {
    moduleId: "budgets",
    ...(record ? { externalId: record.externalId, expectedVersion: record.version } : {}),
    name: draft.name.trim(),
    restaurantExternalId: draft.restaurantExternalId,
    businessDate: draft.periodStart,
    amount: budgetPlanTotal(draft.lines),
    data: { periodStart: draft.periodStart, periodEnd: draft.periodEnd, ...(draft.comment.trim() ? { comment: draft.comment.trim() } : {}) },
  }
}

export const budgetLinesArgs = (draft: BudgetDraft) =>
  draft.lines.map((line) => (line.kind === "account" ? { accountExternalId: line.articleExternalId, planAmount: line.planAmount ?? 0 } : { cashflowCategoryExternalId: line.articleExternalId, planAmount: line.planAmount ?? 0 }))

/** 111,7 % — or «—» without a plan. */
export const formatExecution = (percent: number | null | undefined) => (percent === null || percent === undefined ? "—" : formatPercent(percent))
