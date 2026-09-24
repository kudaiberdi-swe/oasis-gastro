import { useMemo, useState } from "react"

import { almatyBusinessDate } from "@/shared/lib/almaty-time"

import type { DataOf, RetailSetting, RetailSettingData, RetailSettingKind, SaveRetailSettingArgs } from "../data/use-retail-settings"

// Form draft of a retail setting (W1-RTL-03/04). Numbers are edited as text and checked here with the
// same business rules as convex/lib/retailSettings.ts validateSettingData, so most mistakes never
// reach the server; the server message is still shown when it rejects the save.

type Numeric<T, Keys extends keyof T> = Omit<T, Keys> & { [K in Keys]: string }

export type PaymentDraft = DataOf<"payment-type">
export type OrderDraft = Numeric<DataOf<"order-type">, "serviceChargePercent">
export type DiscountDraft = Numeric<DataOf<"discount-type">, "value" | "minimumOrder" | "priority" | "managerApprovalAbove">
export type DeletionDraft = Omit<DataOf<"deletion-reason">, "expenseAccount"> & { expenseAccount: string }
export type CashOperationDraft = Omit<DataOf<"cash-operation-type">, "cashflowCategory" | "maximumAmount"> & { cashflowCategory: string; maximumAmount: number | null }
export type DataDraft = PaymentDraft | OrderDraft | DiscountDraft | DeletionDraft | CashOperationDraft

export interface SettingDraft {
  code: string
  name: string
  receiptName: string
  /** YYYY-MM-DD, the start of that Almaty day. */
  effectiveFrom: string
  /** YYYY-MM-DD or empty — without an end. */
  effectiveTo: string
  sortOrder: string
  /** Empty — every restaurant (network users only). */
  restaurantExternalIds: string[]
  data: DataDraft
}

/** Field → message; data fields are keyed by their own name (`account`, `value`, …). */
export type SettingErrors = Partial<Record<string, string>>

const ALMATY_OFFSET = "+05:00"

export function todayInAlmaty(now = Date.now()) {
  return almatyBusinessDate(now)
}

/** "2026-09-24" → the start of that day in Almaty; junk → null. */
export function fromDateInput(text: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const value = Date.parse(`${text}T00:00:00${ALMATY_OFFSET}`)
  return Number.isNaN(value) ? null : value
}

/** "1,5" or "1.5" → 1.5; empty or junk → null. */
export function parseNumber(text: string): number | null {
  const clean = text.trim().replace(/\s/g, "").replace(",", ".")
  if (!clean || !/^-?\d*\.?\d+$/.test(clean)) return null
  return Number(clean)
}

const numberText = (value: number) => String(value).replace(".", ",")

export function emptyData(kind: RetailSettingKind): DataDraft {
  switch (kind) {
    case "payment-type":
      return { kind, processorKind: "cash", account: "", fiscal: true, revenue: true, manualEntry: false, externalAcceptance: false, combinable: true, allowsChange: true, opensCashDrawer: true }
    case "order-type":
      return { kind, serviceMode: "dine-in", promptStage: "start", isDefault: false, serviceChargePercent: "0" }
    case "discount-type":
      return { kind, mode: "percent", value: "", minimumOrder: "0", priority: "0", managerApprovalAbove: "0", manual: true, automatic: false, combinable: false }
    case "deletion-reason":
      return { kind, expenseAccount: "", writeOff: false, requireComment: false, requireManager: true }
    case "cash-operation-type":
      return { kind, direction: "cash-in", cashAccount: "", correspondingAccount: "", cashflowCategory: "", maximumAmount: null, requireManager: false }
  }
}

export function dataDraftOf(data: RetailSettingData): DataDraft {
  switch (data.kind) {
    case "payment-type":
      return { ...data }
    case "order-type":
      return { ...data, serviceChargePercent: numberText(data.serviceChargePercent) }
    case "discount-type":
      return { ...data, value: numberText(data.value), minimumOrder: numberText(data.minimumOrder), priority: numberText(data.priority), managerApprovalAbove: numberText(data.managerApprovalAbove) }
    case "deletion-reason":
      return { ...data, expenseAccount: data.expenseAccount ?? "" }
    case "cash-operation-type":
      return { ...data, cashflowCategory: data.cashflowCategory ?? "" }
  }
}

/**
 * A new record starts today; a published one becomes the start of the next version, so its date
 * moves to today when it started earlier (publishing expires the old version from that date).
 */
export function draftFromSetting(kind: RetailSettingKind, setting: RetailSetting | null, now = Date.now()): SettingDraft {
  const today = todayInAlmaty(now)
  if (!setting) return { code: "", name: "", receiptName: "", effectiveFrom: today, effectiveTo: "", sortOrder: "0", restaurantExternalIds: [], data: emptyData(kind) }
  const start = almatyBusinessDate(setting.effectiveFrom)
  return {
    code: setting.code,
    name: setting.name,
    receiptName: setting.receiptName ?? "",
    effectiveFrom: setting.status === "published" && start < today ? today : start,
    effectiveTo: setting.effectiveTo === undefined ? "" : almatyBusinessDate(setting.effectiveTo),
    sortOrder: String(setting.sortOrder),
    restaurantExternalIds: [...setting.restaurantExternalIds],
    data: dataDraftOf(setting.data),
  }
}

function checkData(data: DataDraft, errors: SettingErrors) {
  switch (data.kind) {
    case "payment-type":
      if (!data.account) errors.account = "Выберите денежный счёт"
      if (data.allowsChange && data.processorKind !== "cash") errors.allowsChange = "Сдача возможна только у наличных"
      return
    case "order-type": {
      const percent = parseNumber(data.serviceChargePercent)
      if (percent === null || percent < 0 || percent > 30) errors.serviceChargePercent = "От 0 до 30 %"
      return
    }
    case "discount-type": {
      const value = parseNumber(data.value)
      if (data.mode === "fixed") {
        if (value === null || !(value > 0)) errors.value = "Сумма скидки должна быть больше нуля"
      } else if (value === null || !(value > 0) || value > 100) errors.value = "От 0 до 100 %"
      const minimumOrder = parseNumber(data.minimumOrder)
      if (minimumOrder === null || minimumOrder < 0) errors.minimumOrder = "Не может быть отрицательной"
      const priority = parseNumber(data.priority)
      if (priority === null || !Number.isInteger(priority)) errors.priority = "Целое число"
      const approval = parseNumber(data.managerApprovalAbove)
      if (approval === null || approval < 0) errors.managerApprovalAbove = "Не может быть отрицательным"
      if (data.manual === data.automatic) errors.manual = "Скидка либо ручная, либо автоматическая"
      return
    }
    case "deletion-reason":
      if (data.writeOff && !data.expenseAccount) errors.expenseAccount = "Для списания укажите счёт расходов"
      return
    case "cash-operation-type":
      if (!data.cashAccount) errors.cashAccount = "Выберите денежный счёт"
      if (!data.correspondingAccount) errors.correspondingAccount = "Выберите корреспондирующий счёт"
      else if (data.cashAccount && data.cashAccount === data.correspondingAccount) errors.correspondingAccount = "Счета операции должны различаться"
      if (data.maximumAmount === null || !(data.maximumAmount > 0)) errors.maximumAmount = "Больше нуля"
      return
  }
}

export function validateSettingDraft(draft: SettingDraft, options: { network: boolean; isNew: boolean }): SettingErrors {
  const errors: SettingErrors = {}
  if (options.isNew) {
    if (!draft.code.trim()) errors.code = "Укажите код"
    else if (!/^[a-z0-9][a-z0-9-]*$/i.test(draft.code.trim())) errors.code = "Латиница, цифры и дефис"
  }
  if (!draft.name.trim()) errors.name = "Укажите название"
  const from = fromDateInput(draft.effectiveFrom)
  if (from === null) errors.effectiveFrom = "Укажите дату начала"
  if (draft.effectiveTo.trim()) {
    const to = fromDateInput(draft.effectiveTo)
    if (to === null) errors.effectiveTo = "Дата заполнена не полностью"
    else if (from !== null && to <= from) errors.effectiveTo = "Окончание должно быть позже начала"
  }
  const sortOrder = parseNumber(draft.sortOrder)
  if (sortOrder === null || !Number.isInteger(sortOrder) || sortOrder < 0) errors.sortOrder = "Целое число от 0"
  if (!options.network && draft.restaurantExternalIds.length === 0) errors.restaurants = "Выберите хотя бы один ресторан"
  checkData(draft.data, errors)
  return errors
}

export function hasErrors(errors: SettingErrors) {
  return Object.values(errors).some(Boolean)
}

function dataArgs(data: DataDraft): RetailSettingData {
  switch (data.kind) {
    case "payment-type":
      return { ...data }
    case "order-type":
      return { ...data, serviceChargePercent: parseNumber(data.serviceChargePercent) ?? 0 }
    case "discount-type":
      return {
        ...data,
        value: parseNumber(data.value) ?? 0,
        minimumOrder: parseNumber(data.minimumOrder) ?? 0,
        priority: parseNumber(data.priority) ?? 0,
        managerApprovalAbove: parseNumber(data.managerApprovalAbove) ?? 0,
      }
    case "deletion-reason": {
      const { expenseAccount, ...rest } = data
      return { ...rest, ...(expenseAccount ? { expenseAccount } : {}) }
    }
    case "cash-operation-type": {
      const { cashflowCategory, maximumAmount, ...rest } = data
      return { ...rest, maximumAmount: maximumAmount ?? 0, ...(cashflowCategory.trim() ? { cashflowCategory: cashflowCategory.trim() } : {}) }
    }
  }
}

export function saveSettingArgs(kind: RetailSettingKind, externalId: string | undefined, draft: SettingDraft): SaveRetailSettingArgs {
  const effectiveTo = draft.effectiveTo.trim() ? fromDateInput(draft.effectiveTo) : null
  const receiptName = draft.receiptName.trim()
  return {
    ...(externalId ? { externalId } : {}),
    kind,
    code: draft.code.trim().toLocaleLowerCase("en-US"),
    name: draft.name.trim(),
    ...(receiptName ? { receiptName } : {}),
    effectiveFrom: fromDateInput(draft.effectiveFrom) ?? Date.now(),
    ...(effectiveTo !== null ? { effectiveTo } : {}),
    sortOrder: parseNumber(draft.sortOrder) ?? 0,
    restaurantExternalIds: draft.restaurantExternalIds,
    data: dataArgs(draft.data),
  }
}

export function useSettingDraft(kind: RetailSettingKind, setting: RetailSetting | null) {
  const [baseline, setBaseline] = useState(() => draftFromSetting(kind, setting))
  const [draft, setDraft] = useState(baseline)
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline])
  return {
    draft,
    dirty,
    set: (patch: Partial<Omit<SettingDraft, "data">>) => setDraft((current) => ({ ...current, ...patch })),
    setData: (patch: Partial<DataDraft>) => setDraft((current) => ({ ...current, data: { ...current.data, ...patch } as DataDraft })),
    markSaved: () => setBaseline(draft),
  }
}
