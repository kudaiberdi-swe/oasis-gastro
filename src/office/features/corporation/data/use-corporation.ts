import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"
import { useMemo, useState } from "react"

import { useCan } from "@/office/components/can"

import { api } from "../../../../../convex/_generated/api"

// «Организации», «Рестораны», «Подразделения» (W2-ADM-06…08) over convex/domains/corporation. The lists
// are bounded on the server (≤ 200 rows), so tabs, counters and search work on the whole list here;
// the server checks every right and scope again.

const organizations = api.domains.corporation.organizations
const restaurants = api.domains.corporation.restaurants
const departments = api.domains.corporation.departments

export type OrganizationRow = FunctionReturnType<typeof organizations.listOrganizations>[number]
export type RestaurantRow = FunctionReturnType<typeof restaurants.listRestaurants>[number]
export type DepartmentRow = FunctionReturnType<typeof departments.listDepartments>[number]
export type SaveOrganizationArgs = FunctionArgs<typeof organizations.saveOrganization>
export type SaveRestaurantArgs = FunctionArgs<typeof restaurants.saveRestaurant>
export type SaveDepartmentArgs = FunctionArgs<typeof departments.saveDepartment>

export function useOrganizations() {
  return useQuery(organizations.listOrganizations, {})
}

export function useRestaurants(args: { organizationExternalId?: string }) {
  return useQuery(restaurants.listRestaurants, args)
}

export function useDepartments(args: { organizationExternalId?: string }) {
  return useQuery(departments.listDepartments, args)
}

export function useOrganizationMutations() {
  return { saveOrganization: useMutation(organizations.saveOrganization), setOrganizationActive: useMutation(organizations.setOrganizationActive) }
}

export function useRestaurantMutations() {
  return { saveRestaurant: useMutation(restaurants.saveRestaurant), setRestaurantActive: useMutation(restaurants.setRestaurantActive) }
}

export function useDepartmentMutations() {
  return {
    saveDepartment: useMutation(departments.saveDepartment),
    setDepartmentActive: useMutation(departments.setDepartmentActive),
    createFromIiko: useMutation(departments.createFromIiko),
  }
}

export type ScopeOption = { externalId: string; name: string }
export type ScopeRestaurant = ScopeOption & { organizationExternalId: string }

/**
 * Organizations and restaurants for pickers. With «Организации — просмотр» the names come from the
 * register; otherwise from the office context (the organizations of the user's restaurants).
 */
export function useCorporationScope() {
  const context = useQuery(api.domains.office.queries.context)
  const canViewOrganizations = useCan("office.organizations.view")
  const organizationList = useQuery(organizations.listOrganizations, canViewOrganizations ? {} : "skip")
  return useMemo(() => {
    const restaurantsInScope: ScopeRestaurant[] = (context?.adminRestaurants ?? []).map((row) => ({ externalId: row.externalId, name: row.name, organizationExternalId: row.organizationExternalId }))
    let organizationOptions: ScopeOption[]
    if (organizationList) {
      organizationOptions = organizationList.filter((row) => row.active).map((row) => ({ externalId: row.externalId, name: row.name }))
    } else {
      const ids = [...new Set(restaurantsInScope.map((row) => row.organizationExternalId))]
      organizationOptions = ids.map((externalId) => ({ externalId, name: ids.length === 1 && context?.organization ? context.organization.name : externalId }))
    }
    const organizationName = (externalId: string | undefined | null) =>
      externalId ? (organizationList?.find((row) => row.externalId === externalId)?.name ?? organizationOptions.find((row) => row.externalId === externalId)?.name ?? externalId) : undefined
    return {
      loading: context === undefined,
      network: context?.user?.restaurantScopes.includes("*") ?? false,
      organizations: organizationOptions,
      restaurants: restaurantsInScope,
      organizationName,
      restaurantName: (externalId: string | undefined | null) => (externalId ? (restaurantsInScope.find((row) => row.externalId === externalId)?.name ?? externalId) : undefined),
    }
  }, [context, organizationList])
}

/** iiko departments from the read-only mirror («Создать из iiko»); needs «Обмен — просмотр». */
export function useIikoDepartments(enabled: boolean) {
  const options = useQuery(api.domains.iiko.office.restaurantLinkOptions, enabled ? {} : "skip")
  return options?.departments
}

export const EMPLOYEE_PAGE_SIZE = 50

/** Employees for «Ответственный», searched on the server; skipped without «Сотрудники — просмотр». */
export function useEmployeeOptions(enabled: boolean) {
  const [search, setSearch] = useState("")
  const list = usePaginatedQuery(api.domains.workforce.queries.listEmployees, enabled ? { search: search.trim() || undefined, status: "active" } : "skip", { initialNumItems: EMPLOYEE_PAGE_SIZE })
  const employees = useMemo(() => list.results.map((row) => ({ id: row._id, name: row.displayName, hint: row.code })), [list.results])
  return { employees, setSearch, loading: list.status === "LoadingFirstPage" }
}
