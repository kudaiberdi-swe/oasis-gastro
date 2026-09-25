import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"

import { useDebounced } from "@/office/features/stock/data/use-stock-master"

import { api } from "../../../../../convex/_generated/api"

// «Доставка и колл-центр» (W2-DLV-02…08) over convex/domains/delivery. Prices, totals and order numbers
// come only from the server; the office shows them and never computes them.

export const DELIVERY_PAGE_SIZE = 50

const queries = api.domains.delivery.queries
const mutations = api.domains.delivery.mutations

export type DeliveryChannel = "delivery" | "call-center"
export type DeliveryRow = FunctionReturnType<typeof queries.overview>["page"][number]
export type DeliveryKpis = FunctionReturnType<typeof queries.kpis>
export type DeliveryOrder = NonNullable<FunctionReturnType<typeof queries.order>>
export type DeliveryOrderLine = DeliveryOrder["lines"][number]
export type DeliveryStatus = DeliveryOrder["status"]
export type DeliveryReferences = FunctionReturnType<typeof queries.references>
export type DeliveryReferenceSource = DeliveryReferences["sources"][number]
export type DeliveryReferenceCourier = DeliveryReferences["couriers"][number]
export type DeliveryProduct = FunctionReturnType<typeof queries.products>[number]
export type DeliveryZone = FunctionReturnType<typeof queries.zones>[number]
export type Courier = FunctionReturnType<typeof queries.couriers>[number]
export type CourierStatus = Courier["status"]
export type CourierTransport = Courier["transport"]
export type DeliverySource = FunctionReturnType<typeof queries.sources>[number]
export type DeliverySourceKind = DeliverySource["kind"]
export type SaveOrderArgs = FunctionArgs<typeof mutations.saveOrder>
export type SaveZoneArgs = FunctionArgs<typeof mutations.saveZone>
export type SaveCourierArgs = FunctionArgs<typeof mutations.saveCourier>
export type SaveSourceArgs = FunctionArgs<typeof mutations.saveSource>

export function useDeliveryOverview(args: { tab: string; search: string; restaurantExternalId?: string; channel: DeliveryChannel; enabled: boolean }) {
  return usePaginatedQuery(
    queries.overview,
    args.enabled ? { tab: args.tab, search: args.search.trim() || undefined, restaurantExternalId: args.restaurantExternalId, channel: args.channel } : "skip",
    { initialNumItems: DELIVERY_PAGE_SIZE },
  )
}

export function useDeliveryKpis(args: { restaurantExternalId?: string; channel: DeliveryChannel; enabled: boolean }) {
  return useQuery(queries.kpis, args.enabled ? { restaurantExternalId: args.restaurantExternalId, channel: args.channel } : "skip")
}

/** undefined while loading, null when missing or outside the scope; skipped for a new order. */
export function useDeliveryOrder(externalId: string | null) {
  return useQuery(queries.order, externalId ? { externalId } : "skip")
}

/** Restaurants in scope always; sources, couriers and payment types once a restaurant is chosen. */
export function useDeliveryReferences(restaurantExternalId: string | undefined, enabled = true) {
  return useQuery(queries.references, enabled ? { restaurantExternalId } : "skip")
}

/** Dishes at the restaurant's price in force (resolvePrice); searched on the server as the user types. */
export function useDeliveryProducts(restaurantExternalId: string | undefined, search: string) {
  const debounced = useDebounced(search)
  return useQuery(queries.products, restaurantExternalId ? { restaurantExternalId, search: debounced } : "skip")
}

export function useDeliveryZones(enabled = true) {
  return useQuery(queries.zones, enabled ? {} : "skip")
}

export function useCouriers(enabled = true) {
  return useQuery(queries.couriers, enabled ? {} : "skip")
}

export function useDeliverySources(enabled = true) {
  return useQuery(queries.sources, enabled ? {} : "skip")
}

export function useDeliveryMutations() {
  return {
    saveOrder: useMutation(mutations.saveOrder),
    transitionOrder: useMutation(mutations.transitionOrder),
    assignCourier: useMutation(mutations.assignCourier),
  }
}

export function useZoneMutations() {
  return { saveZone: useMutation(mutations.saveZone) }
}

export function useCourierMutations() {
  return { saveCourier: useMutation(mutations.saveCourier), setCourierStatus: useMutation(mutations.setCourierStatus) }
}

export function useSourceMutations() {
  return { saveSource: useMutation(mutations.saveSource) }
}

/** Guests by phone for «Телефон (с поиском гостя)»: office.guests.view only, masked without the PII right. */
export function useGuestLookup(phone: string, enabled: boolean) {
  const digits = useDebounced(phone.replace(/\D/g, ""))
  const page = useQuery(api.domains.loyalty.office.listGuests, enabled && digits.length >= 4 ? { search: digits, status: "active", paginationOpts: { numItems: 5, cursor: null } } : "skip")
  return page?.page
}

/** Active employees of a restaurant for «Код сотрудника» of the courier card. */
export function useRestaurantEmployees(restaurantExternalId: string | undefined, search: string, enabled: boolean) {
  const debounced = useDebounced(search)
  return usePaginatedQuery(
    api.domains.workforce.queries.listEmployees,
    enabled && restaurantExternalId ? { restaurantExternalId, status: "active", search: debounced.trim() || undefined } : "skip",
    { initialNumItems: 50 },
  )
}
