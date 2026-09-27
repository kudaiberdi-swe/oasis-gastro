import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"
import { useMemo } from "react"

import { useCan } from "@/office/components/can"
import { formatAlmatyDate } from "@/shared/lib/almaty-time"

import { api } from "@convex/_generated/api"

// Retail reference data with published versions (W1-RTL-03/04): payment types, order types,
// discounts, deletion reasons and cash operation types over convex/domains/retail. The server checks
// rights, restaurant scope and the business rules of each kind again.

export const RETAIL_SETTINGS_PAGE_SIZE = 50

const queries = api.domains.retail.queries
const mutations = api.domains.retail.mutations

export type RetailSetting = NonNullable<FunctionReturnType<typeof queries.getSetting>>
export type RetailSettingRow = FunctionReturnType<typeof queries.listSettings>["page"][number]
export type RetailSettingKind = RetailSetting["kind"]
export type RetailSettingStatus = RetailSetting["status"]
export type RetailSettingData = RetailSetting["data"]
export type SaveRetailSettingArgs = FunctionArgs<typeof mutations.saveSetting>
export type AccountOption = FunctionReturnType<typeof queries.accountOptions>[number]
export type DataOf<K extends RetailSettingKind> = Extract<RetailSettingData, { kind: K }>

export interface KindMeta {
  /** Office section id = capability module (`office.<module>.view|edit|approve`). */
  section: string
  /** Register caption and «Новая настройка · …». */
  title: string
  searchPlaceholder: string
  emptyTitle: string
  emptyDescription: string
}

export const KIND_META: Record<RetailSettingKind, KindMeta> = {
  "payment-type": {
    section: "payment-types",
    title: "Типы оплат",
    searchPlaceholder: "Код или название типа оплаты",
    emptyTitle: "Типов оплат пока нет",
    emptyDescription: "Создайте тип оплаты — например «Наличные» или «Kaspi QR» — и опубликуйте его для касс.",
  },
  "order-type": {
    section: "order-types",
    title: "Типы заказов",
    searchPlaceholder: "Код или название типа заказа",
    emptyTitle: "Типов заказов пока нет",
    emptyDescription: "Создайте тип заказа — «В зале», «С собой» или «Доставка».",
  },
  "discount-type": {
    section: "discount-types",
    title: "Скидки и надбавки",
    searchPlaceholder: "Код или название скидки",
    emptyTitle: "Скидок и надбавок пока нет",
    emptyDescription: "Создайте скидку или надбавку и опубликуйте её для касс.",
  },
  "deletion-reason": {
    section: "deletion-reasons",
    title: "Причины удалений",
    searchPlaceholder: "Код или название причины",
    emptyTitle: "Причин удалений пока нет",
    emptyDescription: "Создайте причину — например «Отказ гостя» или «Порча».",
  },
  "cash-operation-type": {
    section: "cash-operations",
    title: "Типы внесений и изъятий",
    searchPlaceholder: "Код или название операции",
    emptyTitle: "Типов операций пока нет",
    emptyDescription: "Создайте основание — например «Внесение размена» или «Инкассация».",
  },
}

export type StatusView = "all" | RetailSettingStatus

export const STATUS_TABS: { value: StatusView; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "draft", label: "Черновики" },
  { value: "published", label: "Опубликованные" },
  { value: "expired", label: "Истёкшие" },
]

export const PROCESSOR_LABELS: Record<DataOf<"payment-type">["processorKind"], string> = { cash: "Наличные", card: "Банковская карта", qr: "QR-оплата" }
export const SERVICE_MODE_LABELS: Record<DataOf<"order-type">["serviceMode"], string> = { "dine-in": "В зале", takeaway: "С собой", delivery: "Доставка" }
export const PROMPT_STAGE_LABELS: Record<DataOf<"order-type">["promptStage"], string> = { start: "При создании заказа", payment: "При оплате", never: "Не запрашивать" }
export const DISCOUNT_MODE_LABELS: Record<DataOf<"discount-type">["mode"], string> = { percent: "Процентная скидка", fixed: "Фиксированная скидка", markup: "Надбавка", service: "Сервисный сбор" }
export const DIRECTION_LABELS: Record<DataOf<"cash-operation-type">["direction"], string> = { "cash-in": "Внесение", "cash-out": "Изъятие" }

/** Rights of the current user on one kind; buttons without the right are hidden (OFFICE-DESIGN §7). */
export function useRetailRights(kind: RetailSettingKind) {
  const section = KIND_META[kind].section
  return { canEdit: useCan(`office.${section}.edit`), canApprove: useCan(`office.${section}.approve`) }
}

export function useRetailSettings(kind: RetailSettingKind, args: { view: StatusView; search: string }) {
  return usePaginatedQuery(
    queries.listSettings,
    { kind, ...(args.view === "all" ? {} : { status: args.view }), ...(args.search.trim() ? { search: args.search.trim() } : {}) },
    { initialNumItems: RETAIL_SETTINGS_PAGE_SIZE },
  )
}

/** undefined while loading, null when the record is missing, of another kind or outside the scope. */
export function useRetailSetting(kind: RetailSettingKind, externalId: string | null) {
  return useQuery(queries.getSetting, externalId ? { kind, externalId } : "skip")
}

/** Chart-of-accounts choices; `value` is what `data.account` and the other account fields store. */
export function useAccountOptions(kind: RetailSettingKind) {
  const accounts = useQuery(queries.accountOptions, { kind })
  return useMemo(() => {
    const list = accounts ?? []
    return {
      loading: accounts === undefined,
      options: list.map((account) => ({ value: account.value, label: `${account.code} · ${account.name}` })),
      labelOf: (value: string | undefined) => {
        if (!value) return undefined
        const account = list.find((candidate) => candidate.value === value)
        return account ? `${account.code} · ${account.name}` : value
      },
    }
  }, [accounts])
}

/** «Статьи ДДС» for cash operation types — only when the user may read them; otherwise free text. */
export function useCashflowCategories(enabled: boolean) {
  const references = useQuery(api.domains.finance.records.references, enabled ? { moduleId: "cashflow-categories" } : "skip")
  return useMemo(() => (references?.cashflowCategories ?? []).map((category) => ({ value: category.externalId, label: category.name })), [references])
}

export function useRetailSettingMutations() {
  const save = useMutation(mutations.saveSetting)
  const publish = useMutation(mutations.publishSetting)
  return { save, publish }
}

/** «06.06.2026 — без окончания». */
export function formatPeriod(effectiveFrom: number, effectiveTo: number | undefined) {
  return `${formatAlmatyDate(effectiveFrom)} — ${effectiveTo === undefined ? "без окончания" : formatAlmatyDate(effectiveTo)}`
}

/** «Все рестораны» for an empty list, else names: «Абая, Достык +2». */
export function formatRestaurants(externalIds: readonly string[], nameOf: (externalId: string) => string, shown = 2) {
  if (externalIds.length === 0) return "Все рестораны"
  const names = externalIds.map(nameOf)
  return names.length > shown ? `${names.slice(0, shown).join(", ")} +${names.length - shown}` : names.join(", ")
}
