import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"

import { allowsCapability } from "@/office/model/capabilities"

import { api } from "../../../../../convex/_generated/api"
import { SPECIAL_CAPABILITIES, type CapabilityAction } from "../../../../../convex/lib/capabilities"

// «Роли и права» and «Пользователи» (W1-ACL-05/06) read one query; the server re-checks every rule.

export type AccessControlData = FunctionReturnType<typeof api.domains.office.access.listAccessControl>
export type AccessRole = AccessControlData["roles"][number]
export type AccessUser = AccessControlData["users"][number]
export type AccessEditor = AccessControlData["editor"]
export type CatalogSection = AccessControlData["catalog"][number]
export type { CapabilityAction }

export function useAccessControl() {
  return useQuery(api.domains.office.access.listAccessControl, {})
}

export function useAccessControlMutations() {
  const saveRole = useMutation(api.domains.office.access.saveRole)
  const saveUser = useMutation(api.domains.office.access.saveUser)
  const setUserActive = useMutation(api.domains.office.access.setUserActive)
  return { saveRole, saveUser, setUserActive }
}

export const ACTION_LABELS: Record<CapabilityAction, string> = {
  view: "Просмотр",
  edit: "Изменение",
  post: "Проведение",
  approve: "Согласование",
  reverse: "Сторно",
  cancel: "Отмена",
}

/** Column order of the permission matrix. */
export const ACTION_ORDER: CapabilityAction[] = ["view", "edit", "post", "approve", "reverse", "cancel"]

export const rightId = (sectionId: string, action: CapabilityAction) => `office.${sectionId}.${action}`

/**
 * Every explicit office.<section>.<action> a capability list grants — wildcards, "*" and the legacy
 * module aliases included (read through the one allowsCapability rule).
 */
export function explicitRights(capabilities: readonly string[], catalog: readonly CatalogSection[]): string[] {
  return catalog.flatMap((section) => section.actions.map((action) => rightId(section.id, action)).filter((right) => allowsCapability(capabilities, right)))
}

/** Special rights outside the matrix (office.guests.pii) are kept as the role had them. */
export function specialRights(capabilities: readonly string[]): string[] {
  return capabilities.filter((capability) => (SPECIAL_CAPABILITIES as readonly string[]).includes(capability))
}

/** Whether the editor may hand out this right (the server rule: never more than you have). */
export function editorGrants(editor: AccessEditor, right: string) {
  return editor.fullAccess || allowsCapability(editor.capabilities, right)
}

/** A role the editor may assign to a user: all its rights are within the editor's own. */
export function editorCanAssign(editor: AccessEditor, role: AccessRole, catalog: readonly CatalogSection[]) {
  if (editor.fullAccess) return true
  if (role.fullAccess) return false
  return [...explicitRights(role.capabilities, catalog), ...specialRights(role.capabilities)].every((right) => allowsCapability(editor.capabilities, right))
}

/** Russian plural: 1 разрешение, 2–4 разрешения, 5+ разрешений (11–14 → разрешений). */
export function plural(count: number, [one, few, many]: [string, string, string]) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export const countLabel = (count: number, forms: [string, string, string]) => `${count} ${plural(count, forms)}`
