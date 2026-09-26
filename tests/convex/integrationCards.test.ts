import { convexTest } from "convex-test"
import { afterEach, describe, expect, it, vi } from "vitest"

import { api } from "../../convex/_generated/api"
import { isKzIban } from "../../convex/domains/integrations/cards"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")
const cards = api.domains.integrations.cards

// Integration cards (W3-INT-01) and ЕГАИС under KZ (W3-INT-02). No provider is called; no real secret exists.

async function setup(jurisdiction?: "KZ" | "RU") {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true, ...(jurisdiction ? { jurisdiction } : {}) })
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeRoles", { externalId: "editor", name: "Интегратор", capabilities: ["office.integration-1c.view", "office.integration-1c.edit"], system: false })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["*"], active: true })
    await ctx.db.insert("officeUsers", { externalId: "editor", email: "editor@sandyq.test", name: "Интегратор", roleExternalId: "editor", restaurantScopes: ["*"], organizationScopes: ["sandyq"], active: true })
  })
  return t
}

const card = (extra: Record<string, unknown> = {}) => ({
  moduleId: "integration-1c" as const,
  name: "Выгрузка в 1С",
  provider: "1c",
  mode: "sandbox" as const,
  endpoint: "https://1c.example/api",
  secretRef: "ONEC_API_TOKEN",
  direction: "outbound" as const,
  schedule: "каждый день 02:00",
  maxAttempts: 5,
  mapping: '{ "accounts": { "revenue": "6010" } }',
  settings: { format: "xml" as const },
  ...extra,
})

afterEach(() => vi.unstubAllEnvs())

describe("integration cards (W3-INT-01)", () => {
  it("refuses a literal secret in the mapping or in the secret reference, and fields of another section", async () => {
    const t = await setup()
    const admin = t.withIdentity({ email: "admin@sandyq.test" })
    await expect(admin.mutation(cards.saveIntegrationCard, card({ mapping: '{ "auth": { "token": "sk_live_1234" } }' }))).rejects.toThrow(/auth\.token.*похоже на секрет/)
    await expect(admin.mutation(cards.saveIntegrationCard, card({ mapping: '{ "password": "hunter2" }' }))).rejects.toThrow(/секрет/)
    await expect(admin.mutation(cards.saveIntegrationCard, card({ secretRef: "re_9f8e7d6c5b4a" }))).rejects.toThrow(/имя переменной окружения/)
    await expect(admin.mutation(cards.saveIntegrationCard, card({ settings: { iban: "KZ000000" } }))).rejects.toThrow(/не относятся/)
    await expect(admin.mutation(cards.saveIntegrationCard, card({ mapping: "{ oops" }))).rejects.toThrow(/некорректный JSON/)
    // An env variable name under a secret-like key is a reference, not a secret.
    const saved = await admin.mutation(cards.saveIntegrationCard, card({ mapping: '{ "token": "ONEC_API_TOKEN" }' }))
    expect(saved.number).toMatch(/^SYS-\d{4}-00001$/)
  })

  it("answers never contain secret values; production publishing needs the env variable and the approve right", async () => {
    const t = await setup()
    const admin = t.withIdentity({ email: "admin@sandyq.test" })
    const editor = t.withIdentity({ email: "editor@sandyq.test" })
    const saved = await admin.mutation(cards.saveIntegrationCard, card({ mode: "production" }))
    await expect(editor.mutation(cards.transitionIntegrationCard, { externalId: saved.externalId, action: "publish", expectedVersion: 1 })).rejects.toThrow(/Недостаточно прав/)
    await expect(admin.mutation(cards.transitionIntegrationCard, { externalId: saved.externalId, action: "publish", expectedVersion: 1 })).rejects.toThrow(/ONEC_API_TOKEN не задана/)

    vi.stubEnv("ONEC_API_TOKEN", "test-onec-value-7f3a")
    const listed = await admin.query(cards.listIntegrationCards, { moduleId: "integration-1c", paginationOpts: { numItems: 20, cursor: null } })
    expect(listed.page[0]).toMatchObject({ secretRef: "ONEC_API_TOKEN", secretConfigured: true, status: "draft" })
    await admin.mutation(cards.transitionIntegrationCard, { externalId: saved.externalId, action: "publish", expectedVersion: 1 })
    const shown = await admin.query(cards.getIntegrationCard, { externalId: saved.externalId })
    expect(shown).toMatchObject({ status: "published", mode: "production", errors: 0, lastSyncAt: null })
    for (const answer of [listed, shown]) expect(JSON.stringify(answer)).not.toContain("test-onec-value-7f3a")
    await expect(admin.mutation(cards.saveIntegrationCard, { ...card(), externalId: saved.externalId })).rejects.toThrow(/сначала отключите/)
  })

  it("a sandbox card publishes without a secret; the card counts the section's job errors and last sync", async () => {
    const t = await setup()
    const admin = t.withIdentity({ email: "admin@sandyq.test" })
    const saved = await admin.mutation(cards.saveIntegrationCard, card({ secretRef: "" }))
    await admin.mutation(cards.transitionIntegrationCard, { externalId: saved.externalId, action: "publish", expectedVersion: 1 })
    await t.run(async (ctx) => {
      const base = { direction: "outbound" as const, operation: "export", attempts: 1, payload: {}, nextAttemptAt: 0, createdAt: 0, organizationExternalId: "sandyq", provider: "1c" }
      await ctx.db.insert("integrationJobs", { ...base, externalId: "a", idempotencyKey: "a", status: "dead-letter", updatedAt: 10 })
      await ctx.db.insert("integrationJobs", { ...base, externalId: "b", idempotencyKey: "b", status: "completed", updatedAt: 1_758_000_000_000 })
    })
    const [row] = (await admin.query(cards.listIntegrationCards, { moduleId: "integration-1c", status: "published", paginationOpts: { numItems: 20, cursor: null } })).page
    expect(row).toMatchObject({ status: "published", errors: 1, lastSyncAt: 1_758_000_000_000 })
    await admin.mutation(cards.transitionIntegrationCard, { externalId: saved.externalId, action: "deactivate", expectedVersion: 2 })
    expect((await admin.query(cards.getIntegrationCard, { externalId: saved.externalId }))?.status).toBe("inactive")
  })

  it("validates section fields: KZ IBAN, GLN, the fiscal protocol default", async () => {
    const t = await setup()
    const admin = t.withIdentity({ email: "admin@sandyq.test" })
    expect(isKzIban("KZ86 125K ZT50 0410 0100")).toBe(true)
    expect(isKzIban("KZ87125KZT5004100100")).toBe(false)
    await expect(admin.mutation(cards.saveIntegrationCard, card({ moduleId: "integration-bank", provider: "halyk", settings: { iban: "KZ87125KZT5004100100", statementFormat: "iso20022" } }))).rejects.toThrow(/IBAN/)
    await admin.mutation(cards.saveIntegrationCard, card({ moduleId: "integration-bank", provider: "halyk", settings: { iban: "kz86 125k zt50 0410 0100", statementFormat: "iso20022" } }))
    await expect(admin.mutation(cards.saveIntegrationCard, card({ moduleId: "integration-edi", provider: "edi", settings: { gln: "123" } }))).rejects.toThrow(/GLN/)
    const fiscal = await admin.mutation(cards.saveIntegrationCard, card({ moduleId: "integration-fiscal", provider: "kz-ofd", settings: { ofd: "Транстелеком" } }))
    expect((await admin.query(cards.getIntegrationCard, { externalId: fiscal.externalId }))?.settings).toEqual({ ofd: "Транстелеком", protocol: "2.0.3" })
    await expect(admin.mutation(cards.saveIntegrationCard, card({ moduleId: "integration-cloud-api", provider: "sandyq.kz", settings: {} }))).rejects.toThrow(/Cloud API/)
  })
})

describe("ЕГАИС (W3-INT-02)", () => {
  it("under KZ (the default) no ЕГАИС card is accepted", async () => {
    const t = await setup()
    const admin = t.withIdentity({ email: "admin@sandyq.test" })
    await expect(admin.mutation(cards.saveIntegrationCard, card({ moduleId: "integration-egais", provider: "egais", settings: { utmEndpoint: "https://utm.example" } }))).rejects.toThrow(/ЕГАИС недоступен для KZ/)
    expect(await t.run((ctx) => ctx.db.query("integrationCards").collect())).toHaveLength(0)
    expect((await admin.query(cards.integrationReferences, { moduleId: "integration-egais" })).organizations).toEqual([{ externalId: "sandyq", name: "Sandyq", jurisdiction: "KZ" }])
  })

  it("an organization in the Russian jurisdiction may configure it", async () => {
    const t = await setup("RU")
    const admin = t.withIdentity({ email: "admin@sandyq.test" })
    const saved = await admin.mutation(cards.saveIntegrationCard, card({ moduleId: "integration-egais", provider: "egais", settings: { utmEndpoint: "https://utm.example" } }))
    expect(saved.externalId).toMatch(/^integration-egais-/)
  })
})
