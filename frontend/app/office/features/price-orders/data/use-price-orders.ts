import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"

import type { StatusTone } from "@/shared/lib/status-dictionary"
import { formatAlmatyDate } from "@/shared/lib/almaty-time"

import { api } from "@convex/_generated/api"

// «Приказы об изменении цен» (W1-CAT-11) over convex/domains/pricing; the server checks rights,
// restaurant scope and that only a draft is edited.

export const PRICE_ORDERS_PAGE_SIZE = 50

const queries = api.domains.pricing.queries
const mutations = api.domains.pricing.mutations

export type PriceOrderRow = FunctionReturnType<typeof queries.list>["page"][number]
export type PriceOrder = NonNullable<FunctionReturnType<typeof queries.get>>
export type PriceOrderLine = PriceOrder["lines"][number]
export type PriceOrderStatus = PriceOrderRow["status"]
export type SavePriceOrderArgs = FunctionArgs<typeof mutations.save>
export type PriceOrderView = NonNullable<FunctionArgs<typeof queries.list>["view"]>
export type PriceOrderSort = NonNullable<FunctionArgs<typeof queries.list>["sort"]>

export const STATUS_LABELS: Record<PriceOrderStatus, { label: string; tone: StatusTone }> = {
  draft: { label: "Черновик", tone: "neutral" },
  scheduled: { label: "Запланирован", tone: "info" },
  active: { label: "Действует", tone: "success" },
  expired: { label: "Истёк", tone: "neutral" },
  cancelled: { label: "Отменён", tone: "warning" },
}

export const VIEW_TABS: { value: PriceOrderView; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "active", label: "Действующие" },
  { value: "scheduled", label: "Запланированные" },
  { value: "expired", label: "Истёкшие" },
  { value: "draft", label: "Черновики" },
]

export const SORT_OPTIONS: { value: PriceOrderSort; label: string }[] = [
  { value: "start-desc", label: "Дата начала · сначала новые" },
  { value: "start-asc", label: "Дата начала · сначала старые" },
  { value: "number", label: "По номеру" },
]

export function usePriceOrders(args: { view: PriceOrderView; search: string; sort: PriceOrderSort }) {
  return usePaginatedQuery(queries.list, { view: args.view, search: args.search.trim() || undefined, sort: args.sort }, { initialNumItems: PRICE_ORDERS_PAGE_SIZE })
}

/** undefined while loading, null when the order does not exist or is outside the user's scope. */
export function usePriceOrder(externalId: string) {
  return useQuery(queries.get, { externalId })
}

export function usePriceOrderMutations() {
  const createDraft = useMutation(mutations.createDraft)
  const save = useMutation(mutations.save)
  const publish = useMutation(mutations.publish)
  const cancel = useMutation(mutations.cancel)
  return { createDraft, save, publish, cancel }
}

/** «06.06.2026 — без окончания». */
export function formatPeriod(effectiveFrom: number, effectiveTo: number | null) {
  return `${formatAlmatyDate(effectiveFrom)} — ${effectiveTo === null ? "без окончания" : formatAlmatyDate(effectiveTo)}`
}

/** «Все филиалы» for an empty list, else names: «Абая, Достык +2». */
export function formatRestaurants(externalIds: readonly string[], nameOf: (externalId: string) => string, shown = 2) {
  if (externalIds.length === 0) return "Все филиалы"
  const names = externalIds.map(nameOf)
  return names.length > shown ? `${names.slice(0, shown).join(", ")} +${names.length - shown}` : names.join(", ")
}
