import { useMutation, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"

import { api } from "@convex/_generated/api"
import type { Id } from "@convex/_generated/dataModel"

// «Cloud API» and «Внешнее меню» (W3-INT-03/04) over convex/domains/integrations. The secret never
// reaches the office: the status query says only whether the env variable is set.

const cloudApi = api.domains.integrations.cloudApi
const externalMenu = api.domains.integrations.externalMenu

export type CloudApiStatus = FunctionReturnType<typeof cloudApi.cloudApiStatus>
export type ExternalMenuRow = FunctionReturnType<typeof externalMenu.listExternalMenus>[number]
export type ExternalMenuCard = NonNullable<FunctionReturnType<typeof externalMenu.externalMenu>>
export type ExternalMenuVersionRow = ExternalMenuCard["versions"][number]
export type ExternalMenuPreview = NonNullable<FunctionReturnType<typeof externalMenu.externalMenuVersion>>
export type ExternalMenuStatus = ExternalMenuRow["status"]
export type ExternalMenuChannel = ExternalMenuRow["channel"]
export type ExternalMenuMode = ExternalMenuRow["mode"]
export type SaveExternalMenuArgs = FunctionArgs<typeof externalMenu.saveExternalMenu>

export function useCloudApiStatus() {
  return useQuery(cloudApi.cloudApiStatus, {})
}

export function useExternalMenus(status: ExternalMenuStatus | undefined) {
  return useQuery(externalMenu.listExternalMenus, status ? { status } : {})
}

export function useExternalMenu(externalId: string | null) {
  return useQuery(externalMenu.externalMenu, externalId ? { externalId } : "skip")
}

export function useExternalMenuPreview(versionId: string | null) {
  return useQuery(externalMenu.externalMenuVersion, versionId ? { versionId: versionId as Id<"externalMenuVersions"> } : "skip")
}

export function useExternalMenuMutations() {
  return {
    saveExternalMenu: useMutation(externalMenu.saveExternalMenu),
    publishExternalMenu: useMutation(externalMenu.publishExternalMenu),
    deactivateExternalMenu: useMutation(externalMenu.deactivateExternalMenu),
  }
}
