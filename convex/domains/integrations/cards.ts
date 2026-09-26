import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { mutation, query, type MutationCtx, type QueryCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { envIsSet } from "../../lib/env"
import { organizationJurisdiction } from "../../lib/integrationQueue"
import { nextNumber } from "../../lib/numbering"
import { effectiveScopes, getOfficeAuthEmail, hasScope, requireOfficeCapability, writeOfficeAudit } from "../../lib/officeAccess"
import { almatyBusinessDate } from "../../lib/time"
import { providersOfCard } from "./adapters"
import { redactSecrets } from "./queries"
import { integrationCardModule, integrationCardSettings, integrationDirection, integrationMode, type IntegrationCardModule } from "./validators"

// Integration cards (W3-INT-01, W3-INT-02): the provider configuration of each «Обмен и интеграции»
// section per organization, publish lifecycle draft → published ⇄ inactive. Secrets never enter the
// database: secretRef is the NAME of an env variable, a literal secret anywhere in the card is refused,
// and every answer goes through redactSecrets. Publishing in production needs that env variable to
// exist and office.<section>.approve. ЕГАИС (Russia only) accepts no card under KZ.

type Card = Doc<"integrationCards">
type SettingKey = keyof Card["settings"]
type Settings = Card["settings"]

const METRIC_LIMIT = 200
const SECRET_KEY = /(token|secret|password|passwd|apikey|api_key|authorization|credential|private_?key)$/i
const ENV_NAME = /^[A-Z][A-Z0-9_]{2,63}$/

/** Per section: the provider suggested for a new card and the section-specific fields it accepts. */
export const CARD_SECTIONS: Record<Exclude<IntegrationCardModule, "integration-cloud-api">, { label: string; provider: string; settings: SettingKey[] }> = {
  "integration-1c": { label: "1С", provider: "1c", settings: ["format", "accountMapping"] },
  "integration-edi": { label: "EDI", provider: "edi", settings: ["gln", "documentTypes"] },
  "integration-bank": { label: "Банк-клиент", provider: "bank", settings: ["iban", "statementFormat"] },
  "integration-fiscal": { label: "Фискальные сервисы", provider: "kz-ofd", settings: ["kkmRegistration", "ofd", "protocol"] },
  "integration-egais": { label: "ЕГАИС", provider: "egais", settings: ["utmEndpoint"] },
  "integration-loyalty": { label: "Лояльность", provider: "iikocard", settings: ["programExternalId"] },
  "integration-messaging": { label: "SMS и email", provider: "resend-mobizon", settings: ["sender", "channel"] },
  "integration-maps": { label: "Карты и курьеры", provider: "2gis", settings: ["mapProvider"] },
}

type CardModule = keyof typeof CARD_SECTIONS

function cardSection(moduleId: IntegrationCardModule) {
  // Cloud API is configured on its own page (W3-INT-03): env CLOUD_API_SECRET, routes and signature check.
  if (moduleId === "integration-cloud-api") throw new ConvexError("Cloud API настраивается в разделе «Cloud API», а не карточкой")
  return CARD_SECTIONS[moduleId]
}

/** Kazakhstan IBAN: KZ + 2 check digits + 16 characters, ISO 13616 mod-97 = 1. */
export function isKzIban(value: string) {
  const iban = value.replace(/\s/g, "").toUpperCase()
  if (!/^KZ\d{2}[0-9A-Z]{16}$/.test(iban)) return false
  const digits = `${iban.slice(4)}${iban.slice(0, 4)}`.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55))
  let rest = 0
  for (const digit of digits) rest = (rest * 10 + Number(digit)) % 97
  return rest === 1
}

/** A secret-named key with a literal value anywhere in the mapping is refused (names of env variables are fine). */
function findLiteralSecret(value: unknown, path = ""): string | null {
  if (!value || typeof value !== "object") return null
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const at = path ? `${path}.${key}` : key
    if (SECRET_KEY.test(key) && (typeof item === "number" || (typeof item === "string" && item.trim() && !ENV_NAME.test(item.trim())))) return at
    const nested = findLiteralSecret(item, at)
    if (nested) return nested
  }
  return null
}

function parseMapping(text: string) {
  const source = text.trim() || "{}"
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new ConvexError("Mapping JSON: некорректный JSON")
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ConvexError("Mapping JSON: ожидается объект { … }")
  const secret = findLiteralSecret(parsed)
  if (secret) throw new ConvexError(`Mapping JSON: поле «${secret}» похоже на секрет — секреты не хранятся в карточке, укажите имя переменной окружения`)
  return JSON.stringify(parsed, null, 2)
}

const httpsUrl = (value: string) => {
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

function checkSettings(moduleId: CardModule, settings: Settings): Settings {
  const allowed = CARD_SECTIONS[moduleId].settings
  const extra = (Object.keys(settings) as SettingKey[]).filter((key) => settings[key] !== undefined && !allowed.includes(key))
  if (extra.length) throw new ConvexError(`Поля ${extra.join(", ")} не относятся к разделу «${CARD_SECTIONS[moduleId].label}»`)
  const clean: Settings = {}
  for (const key of allowed) {
    const value = settings[key]
    if (typeof value === "string") {
      const text = value.trim()
      if (text) (clean as Record<string, unknown>)[key] = text
    } else if (value !== undefined) (clean as Record<string, unknown>)[key] = value
  }
  if (clean.iban && !isKzIban(clean.iban)) throw new ConvexError("IBAN: ожидается казахстанский счёт KZ… из 20 символов с верной контрольной суммой")
  if (clean.iban) clean.iban = clean.iban.replace(/\s/g, "").toUpperCase()
  if (clean.gln && !/^\d{13}$/.test(clean.gln)) throw new ConvexError("GLN — 13 цифр")
  if (clean.documentTypes) clean.documentTypes = [...new Set(clean.documentTypes.map((row) => row.trim()).filter(Boolean))]
  if (moduleId === "integration-fiscal" && !clean.protocol) clean.protocol = "2.0.3"
  if (clean.webhookUrl && !httpsUrl(clean.webhookUrl)) throw new ConvexError("Webhook URL — адрес https://…")
  if (clean.utmEndpoint && !httpsUrl(clean.utmEndpoint)) throw new ConvexError("Адрес УТМ — адрес https://…")
  for (const [key, value] of Object.entries(clean)) {
    if (typeof value === "string" && value.length > 500) throw new ConvexError(`Поле ${key} — не длиннее 500 символов`)
  }
  return clean
}

/** The organization of a new card: the one asked for (in scope), the user's only one, or the only one there is. */
async function cardOrganization(ctx: QueryCtx, user: Doc<"officeUsers">, role: Doc<"officeRoles">, requested: string | undefined) {
  const scopes = (await effectiveScopes(ctx, user, role)).organizationScopes
  if (requested) {
    if (!hasScope(scopes, requested)) throw new ConvexError("Нет доступа к организации")
    const organization = await ctx.db.query("organizations").withIndex("by_external_id", (q) => q.eq("externalId", requested)).unique()
    if (!organization) throw new ConvexError("Организация не найдена")
    return organization.externalId
  }
  const own = scopes.filter((id) => id !== "*")
  if (own.length === 1) return own[0]
  const rows = await ctx.db.query("organizations").take(2)
  if (rows.length === 1) return rows[0].externalId
  throw new ConvexError("Выберите организацию")
}

async function visibleCard(ctx: QueryCtx, user: Doc<"officeUsers">, role: Doc<"officeRoles">, card: Card | null) {
  if (!card) return false
  return hasScope((await effectiveScopes(ctx, user, role)).organizationScopes, card.organizationExternalId)
}

/** «Последняя синхронизация» and «Ошибок» of a section: aggregates of its providers' jobs. */
async function sectionMetrics(ctx: QueryCtx, moduleId: IntegrationCardModule) {
  let lastSyncAt: number | null = null
  let errors = 0
  for (const provider of providersOfCard(moduleId)) {
    const last = await ctx.db.query("integrationJobs").withIndex("by_provider_status_updated", (q) => q.eq("provider", provider).eq("status", "completed")).order("desc").first()
    if (last && (lastSyncAt === null || last.updatedAt > lastSyncAt)) lastSyncAt = last.updatedAt
    for (const status of ["failed", "dead-letter"] as const) errors += (await ctx.db.query("integrationJobs").withIndex("by_provider_status_updated", (q) => q.eq("provider", provider).eq("status", status)).take(METRIC_LIMIT)).length
  }
  return { lastSyncAt, errors, errorsCapped: errors >= METRIC_LIMIT }
}

/** What the office sees of a card: no secret values (redactSecrets), only whether the secret's env variable is set. */
function publicCard(card: Card) {
  const { searchText: _search, ...rest } = card
  let mapping = card.mapping
  try {
    mapping = JSON.stringify(redactSecrets(JSON.parse(card.mapping)), null, 2)
  } catch {
    mapping = "{}"
  }
  return { ...rest, mapping, settings: redactSecrets(card.settings) as Settings, secretConfigured: card.secretRef ? envIsSet(card.secretRef) : false }
}

// --- Queries ----------------------------------------------------------------------------------

export const listIntegrationCards = query({
  args: { moduleId: integrationCardModule, status: v.optional(v.union(v.literal("draft"), v.literal("published"), v.literal("inactive"))), search: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, `office.${args.moduleId}.view`)
    const scopes = (await effectiveScopes(ctx, user, role)).organizationScopes
    const needle = args.search?.trim().toLocaleLowerCase("ru")
    const page = needle
      ? await ctx.db.query("integrationCards").withSearchIndex("search_integration_cards", (q) => (args.status ? q.search("searchText", needle).eq("moduleId", args.moduleId).eq("status", args.status) : q.search("searchText", needle).eq("moduleId", args.moduleId))).paginate(args.paginationOpts)
      : await ctx.db.query("integrationCards").withIndex("by_module_status_updated", (q) => (args.status ? q.eq("moduleId", args.moduleId).eq("status", args.status) : q.eq("moduleId", args.moduleId))).order("desc").paginate(args.paginationOpts)
    const metrics = await sectionMetrics(ctx, args.moduleId)
    return { ...page, page: page.page.filter((card) => hasScope(scopes, card.organizationExternalId)).map((card) => ({ ...publicCard(card), ...(card.status === "published" ? metrics : { lastSyncAt: null, errors: 0, errorsCapped: false }) })) }
  },
})

export const getIntegrationCard = query({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const card = await ctx.db.query("integrationCards").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!card) return null
    const { user, role } = await requireOfficeCapability(ctx, `office.${card.moduleId}.view`)
    if (!(await visibleCard(ctx, user, role, card))) return null
    return { ...publicCard(card), ...(await sectionMetrics(ctx, card.moduleId)) }
  },
})

/** Organizations the user may configure, with their jurisdiction (ЕГАИС, W3-INT-02). */
export const integrationReferences = query({
  args: { moduleId: integrationCardModule },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, `office.${args.moduleId}.view`)
    const scopes = (await effectiveScopes(ctx, user, role)).organizationScopes
    const rows = await ctx.db.query("organizations").take(50)
    return {
      organizations: rows.filter((row) => row.active && hasScope(scopes, row.externalId)).map((row) => ({ externalId: row.externalId, name: row.name, jurisdiction: row.jurisdiction ?? "KZ" })),
    }
  },
})

/** Env keys a section's built-in adapters read (owner decision Б-B6): only «задан / не задан», never the value. */
const SECTION_ENV: Partial<Record<IntegrationCardModule, string[]>> = {
  "integration-messaging": ["RESEND_API_KEY", "EMAIL_FROM", "MOBIZON_API_KEY", "SMS_SENDER"],
}

export const providerKeys = query({
  args: { moduleId: integrationCardModule },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, `office.${args.moduleId}.view`)
    return (SECTION_ENV[args.moduleId] ?? []).map((name) => ({ name, set: envIsSet(name) }))
  },
})

// --- Mutations --------------------------------------------------------------------------------

async function requireCard(ctx: MutationCtx, externalId: string) {
  const card = await ctx.db.query("integrationCards").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!card) throw new ConvexError("Карточка не найдена")
  return card
}

export const saveIntegrationCard = mutation({
  args: {
    externalId: v.optional(v.string()),
    expectedVersion: v.optional(v.number()),
    moduleId: integrationCardModule,
    organizationExternalId: v.optional(v.string()),
    name: v.string(),
    provider: v.string(),
    mode: integrationMode,
    endpoint: v.string(),
    secretRef: v.string(),
    direction: integrationDirection,
    schedule: v.string(),
    maxAttempts: v.number(),
    mapping: v.string(),
    settings: integrationCardSettings,
  },
  handler: async (ctx, args) => {
    const capability = `office.${args.moduleId}.edit`
    const { user, role } = await requireOfficeCapability(ctx, capability)
    const email = (await getOfficeAuthEmail(ctx))!
    const section = cardSection(args.moduleId)
    const existing = args.externalId ? await requireCard(ctx, args.externalId) : null
    if (existing) {
      if (existing.moduleId !== args.moduleId || !(await visibleCard(ctx, user, role, existing))) throw new ConvexError("Карточка не найдена")
      if (existing.status === "published") throw new ConvexError("Опубликованную карточку сначала отключите, затем измените")
      if (args.expectedVersion !== undefined && existing.version !== args.expectedVersion) throw new ConvexError("Карточка изменена другим пользователем. Обновите страницу")
    }
    const organizationExternalId = existing?.organizationExternalId ?? (await cardOrganization(ctx, user, role, args.organizationExternalId))
    // W3-INT-02: ЕГАИС exists only in Russia — under KZ the section accepts no configuration at all.
    if (args.moduleId === "integration-egais" && (await organizationJurisdiction(ctx, organizationExternalId)) === "KZ") {
      throw new ConvexError("ЕГАИС недоступен для KZ: для учёта Казахстана используйте интеграции ОФД/ККМ")
    }
    const name = args.name.trim()
    if (name.length < 2) throw new ConvexError("Укажите название подключения")
    const provider = args.provider.trim()
    if (!provider || provider.length > 60) throw new ConvexError("Укажите провайдера")
    const endpoint = args.endpoint.trim()
    if (endpoint && !httpsUrl(endpoint)) throw new ConvexError("API endpoint — адрес https://…")
    const secretRef = args.secretRef.trim()
    if (secretRef && !ENV_NAME.test(secretRef)) throw new ConvexError("Ссылка на секрет — имя переменной окружения (например, RESEND_API_KEY), а не сам секрет")
    if (!(Number.isInteger(args.maxAttempts) && args.maxAttempts >= 1 && args.maxAttempts <= 10)) throw new ConvexError("Попыток — от 1 до 10")
    const schedule = args.schedule.trim()
    if (schedule.length > 100) throw new ConvexError("Расписание — не длиннее 100 символов")
    const mapping = parseMapping(args.mapping)
    const settings = checkSettings(args.moduleId as CardModule, args.settings)
    const now = Date.now()
    const number = existing?.number ?? (await nextNumber(ctx, { moduleId: "integration-cards", prefix: "SYS", organizationExternalId, businessDate: almatyBusinessDate(now) }))
    const value = {
      name,
      provider,
      mode: args.mode,
      endpoint,
      secretRef,
      direction: args.direction,
      schedule,
      maxAttempts: args.maxAttempts,
      mapping,
      settings,
      searchText: `${number} ${name} ${provider} ${section.label}`.toLocaleLowerCase("ru"),
      updatedAt: now,
    }
    let externalId: string
    let version: number
    if (existing) {
      externalId = existing.externalId
      version = existing.version + 1
      await ctx.db.patch(existing._id, { ...value, version })
    } else {
      externalId = `${args.moduleId}-${crypto.randomUUID()}`
      version = 1
      await ctx.db.insert("integrationCards", { ...value, externalId, moduleId: args.moduleId, number, status: "draft", organizationExternalId, version, createdBy: email, createdAt: now })
    }
    await writeOfficeAudit(ctx, email, { action: "integration-card.save", summary: `${section.label} ${number}: ${name} (${args.mode})`, resourceType: args.moduleId, resourceExternalId: externalId, capability, details: { secretRef, mode: args.mode } })
    return { externalId, number, version }
  },
})

/**
 * «Опубликовать» / «Отключить» (office.<section>.approve). Production needs the secret's env variable to
 * exist; publishing a card takes the section's other published card of the organization offline.
 */
export const transitionIntegrationCard = mutation({
  args: { externalId: v.string(), action: v.union(v.literal("publish"), v.literal("deactivate")), expectedVersion: v.number() },
  handler: async (ctx, args) => {
    const card = await requireCard(ctx, args.externalId)
    const capability = `office.${card.moduleId}.approve`
    const { user, role } = await requireOfficeCapability(ctx, capability)
    const email = (await getOfficeAuthEmail(ctx))!
    if (!(await visibleCard(ctx, user, role, card))) throw new ConvexError("Карточка не найдена")
    if (card.version !== args.expectedVersion) throw new ConvexError("Карточка изменена другим пользователем. Обновите страницу")
    const now = Date.now()
    if (args.action === "publish") {
      if (card.status === "published") throw new ConvexError("Карточка уже опубликована")
      if (card.moduleId === "integration-egais" && (await organizationJurisdiction(ctx, card.organizationExternalId)) === "KZ") throw new ConvexError("ЕГАИС недоступен для KZ")
      if (card.mode === "production") {
        if (!card.secretRef) throw new ConvexError("Для production укажите ссылку на секрет — имя переменной окружения")
        if (!envIsSet(card.secretRef)) throw new ConvexError(`Переменная окружения ${card.secretRef} не задана — задайте секрет в Convex или опубликуйте в режиме sandbox`)
      }
      const others = await ctx.db.query("integrationCards").withIndex("by_module_org_status", (q) => q.eq("moduleId", card.moduleId).eq("organizationExternalId", card.organizationExternalId).eq("status", "published")).take(20)
      for (const other of others) await ctx.db.patch(other._id, { status: "inactive", version: other.version + 1, updatedAt: now })
      await ctx.db.patch(card._id, { status: "published", publishedAt: now, version: card.version + 1, updatedAt: now })
    } else {
      if (card.status !== "published") throw new ConvexError("Отключить можно только опубликованную карточку")
      await ctx.db.patch(card._id, { status: "inactive", version: card.version + 1, updatedAt: now })
    }
    await writeOfficeAudit(ctx, email, { action: `integration-card.${args.action}`, summary: `${card.number} «${card.name}»: ${args.action === "publish" ? `опубликована (${card.mode})` : "отключена"}`, resourceType: card.moduleId, resourceExternalId: card.externalId, capability })
    return { version: card.version + 1 }
  },
})
