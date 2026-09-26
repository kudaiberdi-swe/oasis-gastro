import { almatyBusinessDate } from "@/shared/lib/almaty-time"
import { formatPercent, formatTenge } from "@/shared/lib/format"

import type { MedicalRecord, MedicalStatus, MotivationProgram, MotivationStatus, SaveMedicalArgs, SaveMotivationArgs } from "../data/use-workforce-w3"
import { formatBusinessDate } from "./modules"

// «Мотивационные программы» (W3-HR-07) and «Медкнижки и анализы» (W3-HR-08): labels, lifecycle tabs,
// units and the client-side checks that mirror convex/domains/workforce/{motivation,medical}.ts.

export const todayAlmaty = () => almatyBusinessDate(Date.now())

/** YYYY-MM-DD shifted by whole days. */
export function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/** "12,5" or "12.5" → 12.5; empty or not a number → null. */
export function parseDecimal(text: string): number | null {
  const normalized = text.replace(/\s/g, "").replace(",", ".")
  if (!normalized) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

export const formatPeriod = (from: string, to: string) => `${formatBusinessDate(from)} — ${formatBusinessDate(to)}`

// ── Motivation ───────────────────────────────────────────────────────────────

export const METRICS = ["sales", "average-check", "kitchen-time", "attendance"] as const
export type Metric = (typeof METRICS)[number]
export const METRIC_LABEL: Record<Metric, string> = { sales: "Продажи", "average-check": "Средний чек", "kitchen-time": "Время кухни", attendance: "Дисциплина" }
export const METRIC_OPTIONS = METRICS.map((metric) => ({ value: metric, label: METRIC_LABEL[metric] }))

/** How the fact is measured and when the threshold is met — the hint under «Порог». */
export const METRIC_HINT: Record<Metric, string> = {
  sales: "Сумма оплаченных чеков сотрудника за период, ₸. Выполнено, если не меньше порога.",
  "average-check": "Средний оплаченный чек сотрудника, ₸. Выполнено, если не меньше порога.",
  "kitchen-time": "Среднее время кухни ресторана от отправки до готовности, мин. Выполнено, если не больше порога.",
  attendance: "Доля смен по опубликованному графику, начатых вовремя (до 5 мин опоздания), %. Выполнено, если не меньше порога.",
}

export const isMoneyMetric = (metric: Metric) => metric === "sales" || metric === "average-check"

export const REWARD_TYPES = ["fixed", "percent"] as const
export type RewardType = (typeof REWARD_TYPES)[number]
export const REWARD_TYPE_LABEL: Record<RewardType, string> = { fixed: "Фиксированное", percent: "Процент" }
export const REWARD_TYPE_OPTIONS = REWARD_TYPES.map((type) => ({ value: type, label: REWARD_TYPE_LABEL[type] }))

/** publish (OFFICE-DESIGN §3.5) plus «Завершённые» for the finished periods. */
export const MOTIVATION_TABS: { value: "all" | MotivationStatus; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "draft", label: "Черновики" },
  { value: "published", label: "Опубликованные" },
  { value: "inactive", label: "Неактивные" },
  { value: "expired", label: "Завершённые" },
]

export const isEditableProgram = (status: MotivationStatus) => status === "draft" || status === "inactive"

/** The fact or threshold in its unit: «1 250 000 ₸», «14,5 мин», «92,5 %». */
export function formatMetricValue(metric: Metric, value: number | null | undefined) {
  if (value === null || value === undefined) return null
  if (isMoneyMetric(metric)) return formatTenge(value)
  if (metric === "attendance") return formatPercent(value)
  return `${String(Math.round(value * 10) / 10).replace(".", ",")} мин`
}

/** «15 000 ₸» or «3 % от продаж». */
export function formatReward(program: Pick<MotivationProgram, "rewardType" | "rewardValue">) {
  return program.rewardType === "fixed" ? formatTenge(program.rewardValue) : `${formatPercent(program.rewardValue)} от продаж`
}

export interface MotivationDraft {
  restaurantExternalId: string
  name: string
  metric: Metric
  threshold: string
  rewardType: RewardType
  rewardValue: string
  startsAt: string
  endsAt: string
  requiresApproval: boolean
  positionExternalIds: string[]
  employeeCodes: string[]
}

export function motivationDraftOf(program: MotivationProgram | null, defaults: { restaurantExternalId?: string; today?: string } = {}): MotivationDraft {
  if (program) {
    return {
      restaurantExternalId: program.restaurantExternalId,
      name: program.name,
      metric: program.metric,
      threshold: String(program.threshold).replace(".", ","),
      rewardType: program.rewardType,
      rewardValue: String(program.rewardValue).replace(".", ","),
      startsAt: program.startsAt,
      endsAt: program.endsAt,
      requiresApproval: program.requiresApproval,
      positionExternalIds: program.participants.positionExternalIds ?? [],
      employeeCodes: program.participants.employeeCodes ?? [],
    }
  }
  const today = defaults.today ?? todayAlmaty()
  const monthStart = `${today.slice(0, 7)}-01`
  const nextMonth = `${addDays(monthStart, 32).slice(0, 7)}-01`
  return {
    restaurantExternalId: defaults.restaurantExternalId ?? "",
    name: "",
    metric: "sales",
    threshold: "",
    rewardType: "fixed",
    rewardValue: "",
    startsAt: monthStart,
    endsAt: addDays(nextMonth, -1),
    requiresApproval: false,
    positionExternalIds: [],
    employeeCodes: [],
  }
}

export type MotivationErrors = Partial<Record<"restaurant" | "name" | "threshold" | "rewardValue" | "startsAt" | "endsAt" | "rewardType", string>>

/** Same rules as checkProgram in convex/domains/workforce/motivation.ts. */
export function validateProgram(draft: MotivationDraft): MotivationErrors {
  const errors: MotivationErrors = {}
  if (!draft.restaurantExternalId) errors.restaurant = "Выберите ресторан"
  if (draft.name.trim().length < 2) errors.name = "Укажите название программы"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.startsAt)) errors.startsAt = "Укажите дату начала"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.endsAt)) errors.endsAt = "Укажите дату окончания"
  else if (draft.startsAt && draft.endsAt < draft.startsAt) errors.endsAt = "Окончание не может быть раньше начала"
  else if (draft.startsAt && daysBetween(draft.startsAt, draft.endsAt) >= 92) errors.endsAt = "Период программы — не больше 92 дней"
  const threshold = parseDecimal(draft.threshold)
  if (threshold === null || threshold < 0) errors.threshold = "Укажите порог"
  else if (draft.metric === "attendance" && threshold > 100) errors.threshold = "Порог дисциплины — от 0 до 100 %"
  else if (isMoneyMetric(draft.metric) && !Number.isInteger(threshold)) errors.threshold = "Порог — целое число тенге"
  const reward = parseDecimal(draft.rewardValue)
  if (draft.rewardType === "percent") {
    if (draft.metric !== "sales") errors.rewardType = "Процент считается только от продаж — выберите фиксированную сумму"
    else if (reward === null || reward <= 0 || reward > 100) errors.rewardValue = "Процент — больше 0 и не больше 100"
  } else if (reward === null || !Number.isInteger(reward) || reward <= 0) errors.rewardValue = "Сумма — целое число тенге больше нуля"
  return errors
}

export function motivationArgs(program: MotivationProgram | null, draft: MotivationDraft): SaveMotivationArgs {
  return {
    ...(program ? { externalId: program.externalId, expectedVersion: program.version } : {}),
    restaurantExternalId: draft.restaurantExternalId,
    name: draft.name.trim(),
    metric: draft.metric,
    threshold: parseDecimal(draft.threshold) ?? 0,
    rewardType: draft.rewardType,
    rewardValue: parseDecimal(draft.rewardValue) ?? 0,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    requiresApproval: draft.requiresApproval,
    participants: { positionExternalIds: draft.positionExternalIds, employeeCodes: draft.employeeCodes },
  }
}

// ── Medical records ──────────────────────────────────────────────────────────

export const DOCUMENT_TYPES = ["medical-book", "analysis", "certificate"] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]
export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = { "medical-book": "Медицинская книжка", analysis: "Анализ", certificate: "Допуск" }
export const DOCUMENT_TYPE_OPTIONS = DOCUMENT_TYPES.map((type) => ({ value: type, label: DOCUMENT_TYPE_LABEL[type] }))

/** approval (OFFICE-DESIGN §3.5); medical records are never posted, so the fifth tab is «Отменённые». */
export const MEDICAL_TABS: { value: "all" | MedicalStatus; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "draft", label: "Черновики" },
  { value: "pending-approval", label: "На согласовании" },
  { value: "approved", label: "Согласованные" },
  { value: "cancelled", label: "Отменённые" },
]

/** «истёк 3 дн. назад», «сегодня последний день», «осталось 12 дн.». */
export function expiryNote(expiresAt: string, today = todayAlmaty()) {
  const days = daysBetween(today, expiresAt)
  if (days < 0) return { text: `истёк ${-days} дн. назад`, tone: "danger" as const }
  if (days === 0) return { text: "сегодня последний день", tone: "warning" as const }
  return { text: `осталось ${days} дн.`, tone: days <= 30 ? ("warning" as const) : ("neutral" as const) }
}

export interface MedicalDraft {
  restaurantExternalId: string
  employeeId: string
  documentType: DocumentType
  issuedAt: string
  expiresAt: string
  issuer: string
  documentNumber: string
  fitForWork: boolean
  comment: string
}

export function medicalDraftOf(record: MedicalRecord | null, defaults: { restaurantExternalId?: string } = {}): MedicalDraft {
  if (record) {
    return {
      restaurantExternalId: record.restaurantExternalId,
      employeeId: record.employeeId,
      documentType: record.documentType,
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt,
      issuer: record.issuer,
      documentNumber: record.piiHidden ? "" : record.documentNumber,
      fitForWork: record.fitForWork,
      comment: record.piiHidden ? "" : (record.comment ?? ""),
    }
  }
  return { restaurantExternalId: defaults.restaurantExternalId ?? "", employeeId: "", documentType: "medical-book", issuedAt: "", expiresAt: "", issuer: "", documentNumber: "", fitForWork: true, comment: "" }
}

export type MedicalErrors = Partial<Record<"restaurant" | "employee" | "issuedAt" | "expiresAt" | "issuer" | "documentNumber", string>>

/** Same rules as checkMedical in convex/domains/workforce/medical.ts. */
export function validateMedical(record: MedicalRecord | null, draft: MedicalDraft, today = todayAlmaty()): MedicalErrors {
  const errors: MedicalErrors = {}
  if (!draft.restaurantExternalId) errors.restaurant = "Выберите ресторан"
  if (!draft.employeeId) errors.employee = "Выберите сотрудника"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.issuedAt)) errors.issuedAt = "Укажите дату выдачи"
  else if (draft.issuedAt > today) errors.issuedAt = "Дата выдачи не может быть в будущем"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.expiresAt)) errors.expiresAt = "Укажите срок действия"
  else if (draft.issuedAt && draft.expiresAt <= draft.issuedAt) errors.expiresAt = "Срок действия должен быть позже даты выдачи"
  if (draft.issuer.trim().length < 2) errors.issuer = "Укажите, кем выдан документ"
  if (!record?.piiHidden && !draft.documentNumber.trim()) errors.documentNumber = "Укажите номер документа"
  return errors
}

/** A record the user sees masked keeps its number and comment: they are not sent. */
export function medicalArgs(record: MedicalRecord | null, draft: MedicalDraft): SaveMedicalArgs {
  const hidden = record?.piiHidden ?? false
  return {
    ...(record ? { externalId: record.externalId, expectedVersion: record.version } : {}),
    employeeId: draft.employeeId as SaveMedicalArgs["employeeId"],
    restaurantExternalId: draft.restaurantExternalId,
    documentType: draft.documentType,
    issuedAt: draft.issuedAt,
    expiresAt: draft.expiresAt,
    issuer: draft.issuer.trim(),
    documentNumber: hidden ? undefined : draft.documentNumber.trim(),
    fitForWork: draft.fitForWork,
    comment: hidden ? undefined : draft.comment.trim(),
  }
}
