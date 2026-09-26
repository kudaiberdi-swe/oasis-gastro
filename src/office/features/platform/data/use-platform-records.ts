import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"

import { api } from "../../../../../convex/_generated/api"

// «Шаблоны печати», «Оборудование», «Настройки системы» (W3-ADM-10…12): typed hooks over
// convex/domains/platform/records (the domain-record engine); the server checks rights, scope and each
// module's rules again.

export const PLATFORM_RECORDS_PAGE_SIZE = 50

const records = api.domains.platform.records
const templates = api.domains.platform.printTemplates

export type PlatformModuleId = FunctionArgs<typeof records.list>["moduleId"]
export type PlatformStatus = NonNullable<FunctionArgs<typeof records.list>["status"]>
export type PlatformRecord = FunctionReturnType<typeof records.list>["page"][number]
export type PlatformReferences = FunctionReturnType<typeof records.references>
export type SavePlatformRecordArgs = FunctionArgs<typeof records.save>
export type PlatformAction = FunctionArgs<typeof records.transition>["action"]
export type RoutingRule = NonNullable<SavePlatformRecordArgs["routing"]>[number]

export function usePlatformRecords(moduleId: PlatformModuleId, args: { status?: PlatformStatus; search?: string; restaurantExternalId?: string }) {
  return usePaginatedQuery(
    records.list,
    {
      moduleId,
      ...(args.status ? { status: args.status } : {}),
      ...(args.search?.trim() ? { search: args.search.trim() } : {}),
      ...(args.restaurantExternalId ? { restaurantExternalId: args.restaurantExternalId } : {}),
    },
    { initialNumItems: PLATFORM_RECORDS_PAGE_SIZE },
  )
}

/** undefined while loading, null when missing, of another module or outside the scope. */
export function usePlatformRecord(moduleId: PlatformModuleId, externalId: string | null) {
  return useQuery(records.get, externalId ? { moduleId, externalId } : "skip")
}

export function usePlatformReferences(moduleId: PlatformModuleId) {
  return useQuery(records.references, { moduleId })
}

export function usePlatformRecordMutations() {
  const save = useMutation(records.save)
  const transition = useMutation(records.transition)
  return { save, transition }
}

/** The server render of a saved template (the editor renders drafts itself with the same code). */
export function useServerPreview(externalId: string | null) {
  return useQuery(templates.renderPrintTemplate, externalId ? { externalId } : "skip")
}

const ORGANIZATION_PREFIX = "organization:"

export const organizationScopeId = (organizationExternalId: string) => `${ORGANIZATION_PREFIX}${organizationExternalId}`
export const isOrganizationScope = (restaurantExternalId: string) => restaurantExternalId.startsWith(ORGANIZATION_PREFIX)

/**
 * «Область» of a record: «Вся сеть · <организация>» (network users only) or a restaurant in scope.
 * The value is what the server stores in restaurantExternalId.
 */
export function scopeOptions(references: Pick<PlatformReferences, "organizations" | "restaurants" | "network">, { organizations = true } = {}) {
  return [
    ...(organizations && references.network ? references.organizations.map((organization) => ({ value: organizationScopeId(organization.externalId), label: `Вся сеть · ${organization.name}` })) : []),
    ...references.restaurants.map((restaurant) => ({ value: restaurant.externalId, label: restaurant.name })),
  ]
}

export function scopeLabel(references: Pick<PlatformReferences, "organizations" | "restaurants"> | undefined, restaurantExternalId: string) {
  if (isOrganizationScope(restaurantExternalId)) {
    const id = restaurantExternalId.slice(ORGANIZATION_PREFIX.length)
    return `Вся сеть · ${references?.organizations.find((organization) => organization.externalId === id)?.name ?? id}`
  }
  return references?.restaurants.find((restaurant) => restaurant.externalId === restaurantExternalId)?.name ?? restaurantExternalId
}
