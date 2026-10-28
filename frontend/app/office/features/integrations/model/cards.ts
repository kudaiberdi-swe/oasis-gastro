// Pure rules of the integration cards (W3-INT-01): the sections, their fields, lifecycle tabs, the card
// draft and the client checks that mirror convex/domains/integrations/cards.ts. The server checks again —
// and refuses any literal secret: the card keeps only the NAME of an env variable.

export type CardModuleId = "integration-1c" | "integration-edi" | "integration-bank" | "integration-fiscal" | "integration-loyalty" | "integration-messaging" | "integration-maps"
export type CardStatus = "draft" | "published" | "inactive"
export type CardMode = "sandbox" | "production"
export type CardDirection = "bidirectional" | "inbound" | "outbound"

export type SettingField =
  | { key: "format"; label: string; kind: "select"; options: { value: string; label: string }[] }
  | { key: "statementFormat" | "channel" | "mapProvider"; label: string; kind: "select"; options: { value: string; label: string }[] }
  | { key: "accountMapping"; label: string; kind: "textarea"; placeholder?: string }
  | { key: "gln" | "iban" | "kkmRegistration" | "ofd" | "protocol" | "programExternalId" | "sender"; label: string; kind: "text"; placeholder?: string; hint?: string }
  | { key: "documentTypes"; label: string; kind: "multi"; options: { value: string; label: string }[] }

export type SettingKey = SettingField["key"]

export const CARD_SECTIONS: Record<CardModuleId, { label: string; provider: string; secretHint: string; fields: SettingField[] }> = {
  "integration-1c": {
    label: "1С",
    provider: "1c",
    secretHint: "Например, ONEC_API_TOKEN",
    fields: [
      { key: "format", label: "Формат", kind: "select", options: [{ value: "xml", label: "XML" }, { value: "csv", label: "CSV" }, { value: "json", label: "JSON" }] },
      { key: "accountMapping", label: "Сопоставление счетов", kind: "textarea", placeholder: "6010 → 90.01" },
    ],
  },
  "integration-edi": {
    label: "EDI",
    provider: "edi",
    secretHint: "Например, EDI_API_TOKEN",
    fields: [
      { key: "gln", label: "GLN", kind: "text", placeholder: "13 цифр" },
      {
        key: "documentTypes",
        label: "Типы документов",
        kind: "multi",
        options: [
          { value: "ORDERS", label: "ORDERS — заказ" },
          { value: "ORDRSP", label: "ORDRSP — подтверждение" },
          { value: "DESADV", label: "DESADV — отгрузка" },
          { value: "INVOIC", label: "INVOIC — счёт-фактура" },
          { value: "RECADV", label: "RECADV — приёмка и расхождения" },
        ],
      },
    ],
  },
  "integration-bank": {
    label: "Банк-клиент",
    provider: "bank",
    secretHint: "Например, HALYK_API_TOKEN",
    fields: [
      { key: "iban", label: "IBAN", kind: "text", placeholder: "KZ…", hint: "Казахстанский счёт из 20 символов" },
      { key: "statementFormat", label: "Формат выписки", kind: "select", options: [{ value: "iso20022", label: "ISO 20022" }, { value: "1c-client-bank", label: "1С: Клиент банка" }, { value: "csv", label: "CSV" }] },
    ],
  },
  "integration-fiscal": {
    label: "Фискальные сервисы",
    provider: "kz-ofd",
    secretHint: "Например, OFD_API_TOKEN",
    fields: [
      { key: "kkmRegistration", label: "Регистрационный номер ККМ", kind: "text" },
      { key: "ofd", label: "Оператор ОФД", kind: "text" },
      { key: "protocol", label: "Протокол", kind: "text", placeholder: "2.0.3" },
    ],
  },
  "integration-loyalty": {
    label: "Лояльность",
    provider: "iikocard",
    secretHint: "Например, IIKOCARD_API_KEY",
    fields: [{ key: "programExternalId", label: "Программа по умолчанию", kind: "text" }],
  },
  "integration-messaging": {
    label: "SMS и email",
    provider: "resend-mobizon",
    secretHint: "RESEND_API_KEY или MOBIZON_API_KEY",
    fields: [
      { key: "sender", label: "Отправитель", kind: "text", placeholder: "Ресторан <office@company.kz> или имя SMS" },
      { key: "channel", label: "Канал", kind: "select", options: [{ value: "both", label: "SMS и email" }, { value: "email", label: "Только email" }, { value: "sms", label: "Только SMS" }] },
    ],
  },
  "integration-maps": {
    label: "Карты и курьеры",
    provider: "2gis",
    secretHint: "Например, TWOGIS_API_KEY",
    fields: [{ key: "mapProvider", label: "Провайдер карт", kind: "select", options: [{ value: "2gis", label: "2GIS" }, { value: "yandex", label: "Яндекс Карты" }, { value: "google", label: "Google Maps" }] }],
  },
}

export const CARD_MODULE_IDS = Object.keys(CARD_SECTIONS) as CardModuleId[]

/** OFFICE-DESIGN §3.5 publish. */
export const CARD_TABS = [
  { value: "all", label: "Все" },
  { value: "draft", label: "Черновики" },
  { value: "published", label: "Опубликованные" },
  { value: "inactive", label: "Неактивные" },
] as const

export type CardTab = (typeof CARD_TABS)[number]["value"]

export const MODE_LABELS: Record<CardMode, string> = { sandbox: "Sandbox", production: "Production" }
export const DIRECTION_OPTIONS: { value: CardDirection; label: string }[] = [
  { value: "bidirectional", label: "Двусторонний обмен" },
  { value: "outbound", label: "Только выгрузка" },
  { value: "inbound", label: "Только загрузка" },
]

const ENV_NAME = /^[A-Z][A-Z0-9_]{2,63}$/

export interface CardDraft {
  organizationExternalId: string
  name: string
  provider: string
  mode: CardMode
  endpoint: string
  secretRef: string
  direction: CardDirection
  schedule: string
  maxAttempts: string
  mapping: string
  settings: Partial<Record<SettingKey, string | string[]>>
}

type CardLike = {
  externalId: string
  version: number
  organizationExternalId: string
  name: string
  provider: string
  mode: CardMode
  endpoint: string
  secretRef: string
  direction: CardDirection
  schedule: string
  maxAttempts: number
  mapping: string
  settings: Partial<Record<SettingKey, string | string[]>>
}

export function cardDraftOf(moduleId: CardModuleId, card: CardLike | null, organizationExternalId: string): CardDraft {
  if (!card) {
    return { organizationExternalId, name: "", provider: CARD_SECTIONS[moduleId].provider, mode: "sandbox", endpoint: "", secretRef: "", direction: "outbound", schedule: "", maxAttempts: "5", mapping: "{}", settings: moduleId === "integration-fiscal" ? { protocol: "2.0.3" } : {} }
  }
  return {
    organizationExternalId: card.organizationExternalId,
    name: card.name,
    provider: card.provider,
    mode: card.mode,
    endpoint: card.endpoint,
    secretRef: card.secretRef,
    direction: card.direction,
    schedule: card.schedule,
    maxAttempts: String(card.maxAttempts),
    mapping: card.mapping,
    settings: { ...card.settings },
  }
}

/** Mapping JSON must be an object; the server also refuses literal secrets in it. */
export function mappingError(text: string) {
  try {
    const parsed: unknown = JSON.parse(text.trim() || "{}")
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? null : "Ожидается объект { … }"
  } catch {
    return "Некорректный JSON"
  }
}

export function validateCard(draft: CardDraft): Partial<Record<keyof CardDraft, string>> {
  const errors: Partial<Record<keyof CardDraft, string>> = {}
  if (draft.name.trim().length < 2) errors.name = "Укажите название подключения"
  if (!draft.provider.trim()) errors.provider = "Укажите провайдера"
  if (draft.endpoint.trim() && !/^https:\/\//i.test(draft.endpoint.trim())) errors.endpoint = "Адрес https://…"
  if (draft.secretRef.trim() && !ENV_NAME.test(draft.secretRef.trim())) errors.secretRef = "Имя переменной окружения ЗАГЛАВНЫМИ_БУКВАМИ, не сам секрет"
  if (draft.mode === "production" && !draft.secretRef.trim()) errors.secretRef = "Для production укажите имя переменной с секретом"
  const attempts = Number(draft.maxAttempts)
  if (!(Number.isInteger(attempts) && attempts >= 1 && attempts <= 10)) errors.maxAttempts = "От 1 до 10"
  const mapping = mappingError(draft.mapping)
  if (mapping) errors.mapping = mapping
  return errors
}

export function cardSaveArgs(moduleId: CardModuleId, draft: CardDraft, card: Pick<CardLike, "externalId" | "version"> | null) {
  const allowed = CARD_SECTIONS[moduleId].fields.map((field) => field.key)
  const settings: Record<string, string | string[]> = {}
  for (const key of allowed) {
    const value = draft.settings[key]
    if (Array.isArray(value) ? value.length : value?.trim()) settings[key] = Array.isArray(value) ? value : value!.trim()
  }
  return {
    ...(card ? { externalId: card.externalId, expectedVersion: card.version } : { organizationExternalId: draft.organizationExternalId || undefined }),
    moduleId,
    name: draft.name.trim(),
    provider: draft.provider.trim(),
    mode: draft.mode,
    endpoint: draft.endpoint.trim(),
    secretRef: draft.secretRef.trim(),
    direction: draft.direction,
    schedule: draft.schedule.trim(),
    maxAttempts: Number(draft.maxAttempts),
    mapping: draft.mapping,
    settings,
  }
}
