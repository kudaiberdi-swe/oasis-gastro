import { almatyBusinessDate } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"

import { parseSettingValue, SETTING_SCOPE_LABELS, SETTINGS_REGISTRY, settingDefinition, type SettingCategory, type SettingKey, type SettingScope } from "@convex/lib/settings"
import { organizationScopeId, type PlatformRecord, type PlatformReferences, type SavePlatformRecordArgs } from "../data/use-platform-records"

// The «Настройка системы» card (W3-ADM-12): the draft, the registry-driven value control and the same
// value check as the server (convex/lib/settings.ts parseSettingValue).

export interface SettingDraft {
  category: SettingCategory
  key: SettingKey
  scope: SettingScope
  scopeExternalId: string
  /** Text of the value (number, string or JSON); a boolean setting uses `flag`. */
  value: string
  flag: boolean
}

export const SETTING_KEYS = Object.keys(SETTINGS_REGISTRY) as SettingKey[]

const text = (value: unknown) => (typeof value === "string" ? value : "")

/** The stored value as the editor's text. */
function valueText(key: SettingKey, raw: unknown) {
  if (raw === undefined || raw === null) {
    const fallback = settingDefinition(key).defaultValue
    return typeof fallback === "object" ? JSON.stringify(fallback) : String(fallback)
  }
  return typeof raw === "string" ? raw : String(raw)
}

export function settingDraftOf(record: PlatformRecord | null, references: PlatformReferences): SettingDraft {
  const storedKey = text(record?.data.key)
  const key = (SETTING_KEYS as string[]).includes(storedKey) ? (storedKey as SettingKey) : SETTING_KEYS[0]
  const definition = settingDefinition(key)
  const scope = (text(record?.data.scope) as SettingScope) || defaultScope(key, references)
  return {
    category: definition.category,
    key,
    scope,
    scopeExternalId: text(record?.data.scopeExternalId) || defaultScopeObject(scope, references),
    value: valueText(key, record?.data.value),
    flag: record?.data.value === true,
  }
}

/** The widest scope a key allows that the user can edit: network users start at the organization. */
export function defaultScope(key: SettingKey, references: Pick<PlatformReferences, "network">): SettingScope {
  const scopes = settingDefinition(key).scopes as readonly SettingScope[]
  if (references.network && scopes.includes("organization")) return "organization"
  return scopes.find((scope) => scope !== "organization") ?? scopes[0]
}

export function scopesFor(key: SettingKey, references: Pick<PlatformReferences, "network">): SettingScope[] {
  return (settingDefinition(key).scopes as readonly SettingScope[]).filter((scope) => scope !== "organization" || references.network)
}

export function defaultScopeObject(scope: SettingScope, references: Pick<PlatformReferences, "organizations" | "restaurants" | "terminals">) {
  if (scope === "organization") return references.organizations[0]?.externalId ?? ""
  if (scope === "restaurant") return references.restaurants[0]?.externalId ?? ""
  return references.terminals[0]?.externalId ?? ""
}

export function scopeObjectOptions(scope: SettingScope, references: PlatformReferences) {
  if (scope === "organization") return references.organizations.map((organization) => ({ value: organization.externalId, label: organization.name }))
  if (scope === "restaurant") return references.restaurants.map((restaurant) => ({ value: restaurant.externalId, label: restaurant.name }))
  const restaurantName = (externalId: string) => references.restaurants.find((restaurant) => restaurant.externalId === externalId)?.name ?? externalId
  return references.terminals.map((terminal) => ({ value: terminal.externalId, label: `${terminal.name} · ${restaurantName(terminal.restaurantExternalId)}` }))
}

/** Where the record lives: the organization scope, the restaurant, or the terminal's restaurant. */
export function recordScopeOf(draft: SettingDraft, references: Pick<PlatformReferences, "terminals">) {
  if (draft.scope === "organization") return organizationScopeId(draft.scopeExternalId)
  if (draft.scope === "restaurant") return draft.scopeExternalId
  return references.terminals.find((terminal) => terminal.externalId === draft.scopeExternalId)?.restaurantExternalId ?? ""
}

export function rawValueOf(draft: SettingDraft): string | number | boolean {
  const type = settingDefinition(draft.key).valueType
  if (type === "boolean") return draft.flag
  if (type === "number") return draft.value.trim() === "" ? "" : Number(draft.value.replace(",", "."))
  return draft.value
}

export function validateSetting(draft: SettingDraft): Partial<Record<"value" | "scopeExternalId", string>> {
  const errors: Partial<Record<"value" | "scopeExternalId", string>> = {}
  if (!draft.scopeExternalId) errors.scopeExternalId = "Выберите объект"
  try {
    parseSettingValue(draft.key, rawValueOf(draft))
  } catch (caught) {
    errors.value = errorMessage(caught, "Некорректное значение")
  }
  return errors
}

export function settingSaveArgs(draft: SettingDraft, record: PlatformRecord | null, references: Pick<PlatformReferences, "terminals">): SavePlatformRecordArgs {
  return {
    moduleId: "system-settings",
    ...(record ? { externalId: record.externalId, expectedVersion: record.version } : {}),
    name: settingDefinition(draft.key).label,
    restaurantExternalId: record?.restaurantExternalId ?? recordScopeOf(draft, references),
    businessDate: record?.businessDate ?? almatyBusinessDate(Date.now()),
    data: { key: draft.key, scope: draft.scope, scopeExternalId: draft.scopeExternalId, value: rawValueOf(draft) },
  }
}

/** «15 мин», «30 % / 35 %», «да», «—» for the register. */
export function formatSettingValue(key: string, raw: unknown) {
  let definition
  try {
    definition = settingDefinition(key)
  } catch {
    return String(raw ?? "—")
  }
  if (definition.valueType === "boolean") return raw === true ? "Да" : "Нет"
  if (definition.valueType === "json") {
    try {
      const value = JSON.parse(String(raw)) as Record<string, unknown>
      if (key === "accounting.foodCostThresholds") return `${value.warningFrom} % / ${value.dangerAbove} %`
      return JSON.stringify(value)
    } catch {
      return String(raw)
    }
  }
  const shown = raw === "" || raw === undefined || raw === null ? "—" : String(raw)
  return definition.unit && shown !== "—" ? `${shown} ${definition.unit}` : shown
}

export function scopeText(record: PlatformRecord, references: PlatformReferences | undefined) {
  const scope = text(record.data.scope) as SettingScope
  const id = text(record.data.scopeExternalId)
  const name =
    scope === "organization"
      ? references?.organizations.find((row) => row.externalId === id)?.name
      : scope === "restaurant"
        ? references?.restaurants.find((row) => row.externalId === id)?.name
        : references?.terminals.find((row) => row.externalId === id)?.name
  return `${SETTING_SCOPE_LABELS[scope] ?? scope} · ${name ?? id}`
}
