import { ConvexError } from "convex/values"
import type { GenericQueryCtx } from "convex/server"

import type { DataModel } from "../_generated/dataModel"

type QueryCtx = GenericQueryCtx<DataModel>

// «Настройки системы» (W3-ADM-12): typed settings with inheritance terminal → restaurant → organization →
// default. A setting is a published platformRecords row of the system-settings module; its lookupKey is
// `<key>|<scope>|<object>`, so resolving a key is at most three index reads.

export const SETTING_CATEGORIES = ["accounting", "tax", "numbering", "notifications", "delivery", "security"] as const
export type SettingCategory = (typeof SETTING_CATEGORIES)[number]
export const SETTING_CATEGORY_LABELS: Record<SettingCategory, string> = {
  accounting: "Учёт",
  tax: "Налоги",
  numbering: "Нумерация",
  notifications: "Уведомления",
  delivery: "Доставка",
  security: "Безопасность",
}

export const SETTING_SCOPES = ["organization", "restaurant", "terminal"] as const
export type SettingScope = (typeof SETTING_SCOPES)[number]
export const SETTING_SCOPE_LABELS: Record<SettingScope, string> = { organization: "Организация", restaurant: "Ресторан", terminal: "Терминал" }

export type SettingValueType = "string" | "number" | "boolean" | "json"
export type FoodCostThresholds = { warningFrom: number; dangerAbove: number }
export type SettingValue = string | number | boolean | FoodCostThresholds

export type SettingDefinition = {
  category: SettingCategory
  label: string
  description: string
  valueType: SettingValueType
  defaultValue: SettingValue
  scopes: readonly SettingScope[]
  /** "%", "мин", "ч" — shown next to the value. */
  unit?: string
  /** An error text for a value of the right type that is still not allowed; null when it is fine. */
  check: (value: SettingValue) => string | null
}

const integerIn = (min: number, max: number, unit: string) => (value: SettingValue) =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? null : `Целое число от ${min} до ${max} ${unit}`

// The first keys (plan W3-ADM-12); defaults are today's constants, so an empty register changes nothing.
export const SETTINGS_REGISTRY = {
  "numbering.orderPrefix": {
    category: "numbering",
    label: "Префикс номера заказа",
    description: "Печатается перед номером заказа на чеке и экране кухни, например «А» → «А-142». Пусто — только номер.",
    valueType: "string",
    defaultValue: "",
    scopes: ["organization", "restaurant", "terminal"],
    check: (value) => (typeof value === "string" && /^[\p{L}\d-]{0,6}$/u.test(value) ? null : "До 6 букв, цифр или дефисов"),
  },
  "tax.vatRate": {
    category: "tax",
    label: "Ставка НДС",
    description: "Ставка по умолчанию для новых документов. Подтверждает бухгалтер (плательщик ли юрлицо НДС — решение Б-2).",
    valueType: "number",
    defaultValue: 12,
    scopes: ["organization"],
    unit: "%",
    check: integerIn(0, 100, "%"),
  },
  "accounting.foodCostThresholds": {
    category: "accounting",
    label: "Пороги фудкоста",
    description: "Ниже первого порога — норма, между порогами — предупреждение, выше второго — пересмотреть техкарту (решение Б-7).",
    valueType: "json",
    defaultValue: { warningFrom: 30, dangerAbove: 35 },
    scopes: ["organization", "restaurant"],
    unit: "%",
    check: (value) => {
      if (!value || typeof value !== "object") return "Ожидается {\"warningFrom\": 30, \"dangerAbove\": 35}"
      const { warningFrom, dangerAbove } = value as Record<string, unknown>
      if (typeof warningFrom !== "number" || typeof dangerAbove !== "number" || Object.keys(value).length !== 2) return "Ожидается {\"warningFrom\": 30, \"dangerAbove\": 35}"
      return warningFrom > 0 && warningFrom < dangerAbove && dangerAbove <= 100 ? null : "Пороги: 0 < warningFrom < dangerAbove ≤ 100"
    },
  },
  "security.posIdleLockMinutes": {
    category: "security",
    label: "Автоблокировка кассы",
    description: "Через сколько минут без касаний касса блокируется и просит PIN.",
    valueType: "number",
    defaultValue: 5,
    scopes: ["organization", "restaurant", "terminal"],
    unit: "мин",
    check: integerIn(1, 120, "мин"),
  },
  "notifications.shiftOpenWarningHours": {
    category: "notifications",
    label: "Предупреждение о долгой смене",
    description: "Касса и офис предупреждают, если кассовая смена открыта дольше этого срока.",
    valueType: "number",
    defaultValue: 24,
    scopes: ["organization", "restaurant"],
    unit: "ч",
    check: integerIn(1, 168, "ч"),
  },
} as const satisfies Record<string, SettingDefinition>

export type SettingKey = keyof typeof SETTINGS_REGISTRY

export function settingDefinition(key: string): SettingDefinition {
  const definition = (SETTINGS_REGISTRY as Record<string, SettingDefinition>)[key]
  if (!definition) throw new ConvexError(`Неизвестная настройка «${key}»`)
  return definition
}

export const isSettingKey = (key: string): key is SettingKey => Object.prototype.hasOwnProperty.call(SETTINGS_REGISTRY, key)

/**
 * The stored form of a value (json → its JSON text) after checking its type and range; the office
 * form and the server call the same function. Throws ConvexError for a value of the wrong type.
 */
export function parseSettingValue(key: string, raw: string | number | boolean | null | undefined): { value: SettingValue; stored: string | number | boolean } {
  const definition = settingDefinition(key)
  let value: SettingValue
  switch (definition.valueType) {
    case "string":
      if (typeof raw !== "string") throw new ConvexError("Значение должно быть строкой")
      value = raw.trim()
      break
    case "number": {
      const number = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw.replace(",", ".")) : Number.NaN
      if (!Number.isFinite(number)) throw new ConvexError("Значение должно быть числом")
      value = number
      break
    }
    case "boolean":
      if (typeof raw !== "boolean") throw new ConvexError("Значение должно быть «да» или «нет»")
      value = raw
      break
    case "json": {
      if (typeof raw !== "string") throw new ConvexError("Значение должно быть JSON")
      try {
        value = JSON.parse(raw) as SettingValue
      } catch {
        throw new ConvexError("Некорректный JSON")
      }
      break
    }
  }
  const problem = definition.check(value)
  if (problem) throw new ConvexError(problem)
  return { value, stored: definition.valueType === "json" ? JSON.stringify(value) : (value as string | number | boolean) }
}

/** lookupKey of a setting row. */
export function settingLookupKey(key: string, scope: SettingScope, scopeExternalId: string) {
  return `${key}|${scope}|${scopeExternalId}`
}

export type ResolvedSetting<K extends SettingKey> = {
  value: (typeof SETTINGS_REGISTRY)[K]["defaultValue"] extends number ? number : (typeof SETTINGS_REGISTRY)[K]["defaultValue"] extends string ? string : SettingValue
  source: SettingScope | "default"
  recordExternalId?: string
}

/**
 * The value of a setting for a place: the published terminal row, else the restaurant's, else the
 * organization's, else the registry default. Unknown keys throw ConvexError.
 */
export async function resolveSetting<K extends SettingKey>(
  ctx: QueryCtx,
  key: K,
  place: { organizationExternalId: string; restaurantExternalId?: string; terminalExternalId?: string },
): Promise<ResolvedSetting<K>> {
  const definition = settingDefinition(key)
  const levels: [SettingScope, string | undefined][] = [
    ["terminal", place.terminalExternalId],
    ["restaurant", place.restaurantExternalId],
    ["organization", place.organizationExternalId],
  ]
  for (const [scope, scopeExternalId] of levels) {
    if (!scopeExternalId || !(definition.scopes as SettingScope[]).includes(scope)) continue
    const row = await ctx.db
      .query("platformRecords")
      .withIndex("by_module_lookup_status", (q) => q.eq("moduleId", "system-settings").eq("lookupKey", settingLookupKey(key, scope, scopeExternalId)).eq("status", "published"))
      .order("desc")
      .first()
    if (!row) continue
    try {
      const { value } = parseSettingValue(key, row.data.value)
      return { value: value as ResolvedSetting<K>["value"], source: scope, recordExternalId: row.externalId }
    } catch {
      // A row stored under older rules falls through to the next level instead of breaking the POS.
    }
  }
  return { value: definition.defaultValue as ResolvedSetting<K>["value"], source: "default" }
}
