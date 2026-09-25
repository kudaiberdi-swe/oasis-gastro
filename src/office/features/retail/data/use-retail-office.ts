import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"

import { api } from "../../../../../convex/_generated/api"
import type { Id } from "../../../../../convex/_generated/dataModel"

// Office views of the POS (W1-RTL-04/05/06): typed hooks over convex/domains/retail/office.ts.
// The server checks rights and restaurant scope; these hooks only shape the arguments.

export const RETAIL_OFFICE_PAGE_SIZE = 50

const office = api.domains.retail.office

export type CashOperationRow = FunctionReturnType<typeof office.listCashOperations>["page"][number]
export type CashDirection = NonNullable<FunctionArgs<typeof office.listCashOperations>["direction"]>
export type OrderRow = FunctionReturnType<typeof office.listOrders>["page"][number]
export type OrderStatusTab = NonNullable<FunctionArgs<typeof office.listOrders>["status"]>
export type OrderDetail = NonNullable<FunctionReturnType<typeof office.getOrderDetail>>
export type ShiftCard = FunctionReturnType<typeof office.listShifts>["page"][number]
export type ShiftStatusTab = NonNullable<FunctionArgs<typeof office.listShifts>["status"]>

const withRestaurant = (restaurantExternalId: string | undefined) => (restaurantExternalId ? { restaurantExternalId } : {})

/** Cash in / out; without a direction the server returns the latest of both kinds in one page. */
export function useCashOperations(args: { restaurantExternalId?: string; direction?: CashDirection; from?: number; to?: number }, enabled = true) {
  return usePaginatedQuery(
    office.listCashOperations,
    enabled
      ? {
          ...withRestaurant(args.restaurantExternalId),
          ...(args.direction ? { direction: args.direction } : {}),
          ...(args.from !== undefined ? { from: args.from } : {}),
          ...(args.to !== undefined ? { to: args.to } : {}),
        }
      : "skip",
    { initialNumItems: RETAIL_OFFICE_PAGE_SIZE },
  )
}

export function useOfficeOrders(args: { status: OrderStatusTab; search?: string; restaurantExternalId?: string }, enabled = true) {
  const search = args.search?.trim()
  return usePaginatedQuery(
    office.listOrders,
    enabled ? { status: args.status, ...(search ? { search } : {}), ...withRestaurant(args.restaurantExternalId) } : "skip",
    { initialNumItems: RETAIL_OFFICE_PAGE_SIZE },
  )
}

/** undefined while loading, null when missing or outside the scope. */
export function useOrderDetail(orderId: string | null) {
  return useQuery(office.getOrderDetail, orderId ? { orderId: orderId as Id<"orders"> } : "skip")
}

export function useOfficeShifts(args: { status: ShiftStatusTab; restaurantExternalId?: string }, enabled = true) {
  return usePaginatedQuery(office.listShifts, enabled ? { status: args.status, ...withRestaurant(args.restaurantExternalId) } : "skip", {
    initialNumItems: RETAIL_OFFICE_PAGE_SIZE,
  })
}

/** Chart of accounts for the variance posting preview; needs `office.shift-acceptance.view`. */
export function useShiftAcceptanceAccounts(enabled: boolean) {
  return useQuery(api.domains.finance.records.references, enabled ? { moduleId: "shift-acceptance" } : "skip")?.accounts
}

/** The one acceptShift (finance, B-21) — the card only calls it. */
export function useAcceptShift() {
  return useMutation(api.domains.finance.shiftAcceptance.acceptShift)
}
