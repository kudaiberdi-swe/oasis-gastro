import type { StatusTone } from "@/shared/lib/status-dictionary"

// «Матрица endpoint parity»: labels for the iiko endpoint states (convex/schema.ts iikoEndpointStates).
// The import writes only endpointKey/status/classification/recordCount today, so the operation and the
// Convex / UI target of the known endpoints come from this table.

export const CLASSIFICATION: Record<string, { label: string; tone: StatusTone }> = {
  mirrored: { label: "Зеркалируется", tone: "success" },
  "blocked-one-way": { label: "Заблокировано one-way", tone: "warning" },
  "query-template": { label: "Шаблон запроса", tone: "info" },
  unsupported: { label: "Не поддерживается", tone: "neutral" },
}

export const LAST_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  ok: { label: "Успешно", tone: "success" },
  error: { label: "Ошибка", tone: "danger" },
  unsupported: { label: "Не поддерживается", tone: "neutral" },
}

/** Same ids as bahandi's matrix filter; the server filters by `iikoEndpointStates.domain`. */
export const ENDPOINT_DOMAINS: { value: string; label: string }[] = [
  { value: "organization", label: "Организация" },
  { value: "products", label: "Номенклатура" },
  { value: "stock-balances", label: "Остатки" },
  { value: "workforce", label: "Сотрудники" },
  { value: "suppliers", label: "Поставщики" },
  { value: "documents", label: "Документы" },
  { value: "cash-shifts", label: "Кассовые смены" },
  { value: "orders", label: "Заказы" },
  { value: "reports", label: "Отчёты" },
  { value: "events", label: "События" },
  { value: "system", label: "Система" },
  { value: "edi", label: "EDI" },
  { value: "other", label: "Прочее" },
]

type KnownEndpoint = { operation: string; target: string; ui: string }

export const KNOWN_ENDPOINTS: Record<string, KnownEndpoint> = {
  "corporation/departments": { operation: "Подразделения", target: "iikoDepartments", ui: "Сопоставление филиалов" },
  employees: { operation: "Сотрудники", target: "iikoEmployees", ui: "Сотрудники → Из iiko" },
  "corporation/stores": { operation: "Склады", target: "warehouses", ui: "Склады" },
  "corporation/terminals": { operation: "Кассовые терминалы", target: "posTerminals", ui: "Терминалы" },
  "v2/entities/list?rootType=MeasureUnit": { operation: "Единицы измерения", target: "units", ui: "Единицы измерения" },
  suppliers: { operation: "Поставщики", target: "suppliers", ui: "Поставщики" },
  "v2/entities/products/list": { operation: "Номенклатура", target: "products", ui: "Номенклатура" },
  "v2/entities/products/group/list": { operation: "Группы товаров", target: "categories", ui: "Группы товаров" },
  "v2/reports/balance/stores": { operation: "Остатки на складах", target: "stockMovements", ui: "Остатки" },
}

/** Human label of a countsByEndpoint key: the known operation, otherwise the key itself. */
export function endpointLabel(endpointKey: string) {
  return KNOWN_ENDPOINTS[endpointKey]?.operation ?? endpointKey
}
