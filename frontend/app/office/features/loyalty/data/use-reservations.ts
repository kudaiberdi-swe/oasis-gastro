import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"

import { useCan } from "@/office/components/can"

import { api } from "@convex/_generated/api"
import type { Id } from "@convex/_generated/dataModel"
import type { ReservationStatus } from "../model/reservations"

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
export type SaveTablesArgs = FunctionArgs<typeof reservations.saveTables>
export type ReservationReferences = FunctionReturnType<typeof reservations.references>
export type PaidOrder = ReservationReferences["paidOrders"][number]
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
    saveTables: useMutation(reservations.saveTables),
    saveReservation: useMutation(reservations.saveReservation),
    transitionReservation: useMutation(reservations.transitionReservation),
  }
}

/**
 * Pickers of the card under office.reservations.view: payment types in force for the restaurant
 * (the advance) and, with `date`, the paid checks of that business day (closing a banquet).
 */
export function useReservationReferences(restaurantExternalId: string | undefined, date?: string) {
  return useQuery(reservations.references, restaurantExternalId ? { restaurantExternalId, ...(date ? { date } : {}) } : "skip")
}

/** Guests for the card's Combobox: the office guest search (listGuests), first page only. */
export function useGuestOptions(search: string, enabled: boolean) {
  const canView = useCan("office.guests.view")
  const list = usePaginatedQuery(api.domains.loyalty.office.listGuests, canView && enabled ? (search.trim() ? { search: search.trim(), status: "active" as const } : { status: "active" as const }) : "skip", { initialNumItems: GUEST_OPTIONS })
  return { canView, guests: list.results, loading: list.status === "LoadingFirstPage" }
}

export const asGuestId = (value: string) => value as Id<"guests">
