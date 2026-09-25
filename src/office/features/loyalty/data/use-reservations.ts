import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"
import { useMemo } from "react"

import { useCan } from "@/office/components/can"

import { api } from "../../../../../convex/_generated/api"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { paymentTypeServes, type ReservationStatus } from "../model/reservations"

// «Банкеты и резервы» (W2-LOY-07) over convex/domains/loyalty/reservations.ts: the floor plan of a day,
// the approval register and the booking card. The server checks rights and restaurant scope again.

const reservations = api.domains.loyalty.reservations

export const RESERVATIONS_PAGE_SIZE = 50
const GUEST_OPTIONS = 20

export type DiningTable = FunctionReturnType<typeof reservations.listTables>[number]
export type FloorPlan = FunctionReturnType<typeof reservations.floorPlan>
export type FloorTable = FloorPlan["tables"][number]
export type TableBooking = FloorTable["reservations"][number]
export type ReservationRow = FunctionReturnType<typeof reservations.listReservations>["page"][number]
export type ReservationCard = NonNullable<FunctionReturnType<typeof reservations.getReservation>>
export type SaveTableArgs = FunctionArgs<typeof reservations.saveTable>
export type SaveReservationArgs = FunctionArgs<typeof reservations.saveReservation>

export function useFloorPlan(restaurantExternalId: string | undefined, date: string) {
  return useQuery(reservations.floorPlan, restaurantExternalId ? { restaurantExternalId, date } : "skip")
}

/** Every table of the restaurant (the card's «Зал» and «Стол(ы)» pickers). */
export function useTables(restaurantExternalId: string | undefined) {
  return useQuery(reservations.listTables, restaurantExternalId ? { restaurantExternalId } : "skip")
}

export function useReservations(args: { restaurantExternalId?: string; status?: ReservationStatus; search?: string }) {
  return usePaginatedQuery(reservations.listReservations, args, { initialNumItems: RESERVATIONS_PAGE_SIZE })
}

export function useReservation(externalId: string | null) {
  return useQuery(reservations.getReservation, externalId ? { externalId } : "skip")
}

export function useReservationSummary(restaurantExternalId: string | undefined, enabled = true) {
  return useQuery(reservations.reservationSummary, enabled ? (restaurantExternalId ? { restaurantExternalId } : {}) : "skip")
}

export function useReservationMutations() {
  return {
    saveTable: useMutation(reservations.saveTable),
    saveReservation: useMutation(reservations.saveReservation),
    transitionReservation: useMutation(reservations.transitionReservation),
  }
}

/**
 * Payment types for the advance: the published retail settings in force for the restaurant
 * (convex/domains/retail/queries.ts listSettings). Needs office.payment-types.view; without it the
 * delivery references are used when the role has those, otherwise the list is empty and `canView` false.
 */
export function useAdvancePaymentTypes(restaurantExternalId: string | undefined) {
  const canSettings = useCan("office.payment-types.view")
  const canDelivery = useCan("office.delivery-orders.view")
  const settings = useQuery(api.domains.retail.queries.listSettings, canSettings ? { kind: "payment-type", status: "published", paginationOpts: { numItems: 100, cursor: null } } : "skip")
  const delivery = useQuery(api.domains.delivery.queries.references, !canSettings && canDelivery && restaurantExternalId ? { restaurantExternalId } : "skip")
  return useMemo(() => {
    if (canSettings) {
      const rows = settings?.page ?? []
      return {
        canView: true,
        loading: settings === undefined,
        options: rows.filter((row) => !restaurantExternalId || paymentTypeServes(row, restaurantExternalId)).map((row) => ({ value: row.externalId, label: row.name })),
      }
    }
    if (canDelivery) return { canView: true, loading: restaurantExternalId !== undefined && delivery === undefined, options: (delivery?.paymentTypes ?? []).map((row) => ({ value: row.externalId, label: row.name })) }
    return { canView: false, loading: false, options: [] as { value: string; label: string }[] }
  }, [canSettings, canDelivery, settings, delivery, restaurantExternalId])
}

/** Guests for the card's Combobox: the office guest search (listGuests), first page only. */
export function useGuestOptions(search: string, enabled: boolean) {
  const canView = useCan("office.guests.view")
  const list = usePaginatedQuery(api.domains.loyalty.office.listGuests, canView && enabled ? (search.trim() ? { search: search.trim(), status: "active" as const } : { status: "active" as const }) : "skip", { initialNumItems: GUEST_OPTIONS })
  return { canView, guests: list.results, loading: list.status === "LoadingFirstPage" }
}

export const asGuestId = (value: string) => value as Id<"guests">
