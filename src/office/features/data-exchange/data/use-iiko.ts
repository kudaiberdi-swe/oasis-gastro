import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"

import { api } from "../../../../../convex/_generated/api"

// «Обмен между точками» (W1-IIKO-07): office hooks over convex/domains/iiko/office. Read-only towards iiko —
// nothing here reaches iiko; the import runs from scripts/iiko on a trusted machine. The server checks
// office.data-exchange.view / .edit and the restaurant scope again.

const office = api.domains.iiko.office

export const ENDPOINT_PAGE_SIZE = 40

/** The command that refreshes the mirror (docs/iiko-connection-runbook.md); shown, never executed. */
export const IIKO_SEED_COMMAND = "npm run iiko:seed -- --master-only"

export function useIntegrationOverview() {
  return useQuery(office.integrationOverview, {})
}

export function useEndpointStates(domain: string | undefined) {
  return usePaginatedQuery(office.listEndpointStates, { domain }, { initialNumItems: ENDPOINT_PAGE_SIZE })
}

export function useRestaurantLinkOptions() {
  return useQuery(office.restaurantLinkOptions, {})
}

export function useLinkRestaurant() {
  return useMutation(office.linkRestaurantToIikoDepartment)
}

export type IntegrationOverview = FunctionReturnType<typeof office.integrationOverview>
export type ImportRun = NonNullable<IntegrationOverview["lastRun"]>
export type EndpointState = FunctionReturnType<typeof office.listEndpointStates>["page"][number]
export type EndpointClassification = NonNullable<EndpointState["classification"]>
export type RestaurantLinkOptions = FunctionReturnType<typeof office.restaurantLinkOptions>
export type RestaurantLinkRow = RestaurantLinkOptions["restaurants"][number]
export type IikoDepartmentOption = RestaurantLinkOptions["departments"][number]
