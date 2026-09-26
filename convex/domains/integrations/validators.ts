import { v } from "convex/values"

export const integrationJobStatus = v.union(
  v.literal("queued"),
  v.literal("processing"),
  v.literal("retrying"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("dead-letter"),
  v.literal("cancelled"),
)

/** Sections with an integration card (W3-INT-01); ЕГАИС is listed so the server can refuse it under KZ (W3-INT-02). */
export const INTEGRATION_CARD_MODULES = [
  "integration-1c",
  "integration-edi",
  "integration-bank",
  "integration-fiscal",
  "integration-egais",
  "integration-loyalty",
  "integration-messaging",
  "integration-maps",
  "integration-cloud-api",
] as const

export type IntegrationCardModule = (typeof INTEGRATION_CARD_MODULES)[number]

export const integrationCardModule = v.union(
  v.literal("integration-1c"),
  v.literal("integration-edi"),
  v.literal("integration-bank"),
  v.literal("integration-fiscal"),
  v.literal("integration-egais"),
  v.literal("integration-loyalty"),
  v.literal("integration-messaging"),
  v.literal("integration-maps"),
  v.literal("integration-cloud-api"),
)

export const integrationCardStatus = v.union(v.literal("draft"), v.literal("published"), v.literal("inactive"))
export const integrationMode = v.union(v.literal("sandbox"), v.literal("production"))
export const integrationDirection = v.union(v.literal("bidirectional"), v.literal("inbound"), v.literal("outbound"))

/** Section-specific fields of a card; which of them a section accepts is checked in cards.ts. No secrets here. */
export const integrationCardSettings = v.object({
  // 1С
  format: v.optional(v.union(v.literal("xml"), v.literal("csv"), v.literal("json"))),
  accountMapping: v.optional(v.string()),
  // EDI
  gln: v.optional(v.string()),
  documentTypes: v.optional(v.array(v.string())),
  // Банк-клиент
  iban: v.optional(v.string()),
  statementFormat: v.optional(v.union(v.literal("iso20022"), v.literal("1c-client-bank"), v.literal("csv"))),
  // Фискальные сервисы
  kkmRegistration: v.optional(v.string()),
  ofd: v.optional(v.string()),
  protocol: v.optional(v.string()),
  // Лояльность
  programExternalId: v.optional(v.string()),
  // SMS и email
  sender: v.optional(v.string()),
  channel: v.optional(v.union(v.literal("email"), v.literal("sms"), v.literal("both"))),
  // Карты
  mapProvider: v.optional(v.union(v.literal("2gis"), v.literal("yandex"), v.literal("google"))),
  // Cloud API
  organizationId: v.optional(v.string()),
  webhookUrl: v.optional(v.string()),
  // ЕГАИС (RU only)
  utmEndpoint: v.optional(v.string()),
})
