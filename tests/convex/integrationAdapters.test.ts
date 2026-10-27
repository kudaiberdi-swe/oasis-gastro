import { convexTest } from "convex-test"
import { afterEach, describe, expect, it, vi } from "vitest"

import { internal } from "../../convex/_generated/api"
import { mobizonRecipient, renderMessage } from "../../convex/domains/integrations/adapters/messaging"
import { providersOfCard } from "../../convex/domains/integrations/adapters"
import { PROCESSING_LEASE_MS } from "../../convex/domains/integrations/internal"
import { enqueueIntegrationJob } from "../../convex/lib/integrationQueue"
import { nextAlmatyWindowTime } from "../../convex/lib/time"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")

// Provider adapters, queue and dead-letter (W3-INT-06). fetch is always mocked — no real provider.

const PHONE = "77011234567"

async function setup() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
  })
  return t
}

type T = Awaited<ReturnType<typeof setup>>

const base = { direction: "outbound" as const, status: "queued" as const, attempts: 0, nextAttemptAt: 0, createdAt: 0, updatedAt: 0, organizationExternalId: "sandyq" }

const jobs = (t: T) => t.run((ctx) => ctx.db.query("integrationJobs").collect())
const runQueue = (t: T) => t.action(internal.domains.integrations.internal.processIntegrationJobs, {})
/** Makes every job due now (instead of waiting out the backoff). */
const makeDue = (t: T) =>
  t.run(async (ctx) => {
    for (const job of await ctx.db.query("integrationJobs").collect()) await ctx.db.patch(job._id, { nextAttemptAt: 0 })
  })

async function guestWithConsents(t: T, consents: ("personal-data" | "sms" | "email")[], consentState: "granted" | "unknown" = "granted") {
  return t.run(async (ctx) => {
    const guestId = await ctx.db.insert("guests", { phone: PHONE, name: "Айгерим", email: "aigerim@example.kz", points: 0, createdAt: 0, externalId: "guest-1", status: "active", consentState })
    for (const channel of consents) await ctx.db.insert("guestConsents", { guestId, channel, granted: true, source: "office", actorKey: "admin", recordedAt: 1 })
    return guestId
  })
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("provider adapters and dead-letter (W3-INT-06)", () => {
  it("providers without a chosen vendor go to dead-letter with the reason after one attempt, none stays processing", async () => {
    const t = await setup()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    await t.run(async (ctx) => {
      for (const provider of ["1c", "edi", "bank", "fiscal", "maps", "telephony"]) await ctx.db.insert("integrationJobs", { ...base, externalId: provider, provider, operation: "export", idempotencyKey: provider, payload: {} })
    })
    await runQueue(t)
    const rows = await jobs(t)
    expect(rows.every((job) => job.status === "dead-letter" && job.attempts === 1)).toBe(true)
    expect(rows.find((job) => job.provider === "maps")?.error).toBe("Провайдер не подключён: карты и геокодирование (2GIS)")
    expect(fetchMock).not.toHaveBeenCalled()
    expect(providersOfCard("integration-messaging").sort()).toEqual(["email", "messaging", "sms"])
  })

  it("email without RESEND_API_KEY ends in dead-letter «ключ не задан» and works the moment the key exists", async () => {
    const t = await setup()
    const fetchMock = vi.fn(async () => jsonResponse(200, { id: "msg-1" }))
    vi.stubGlobal("fetch", fetchMock)
    await t.run((ctx) => ctx.db.insert("integrationJobs", { ...base, externalId: "mail", provider: "email", operation: "office-user.password-reset", idempotencyKey: "reset:1", payload: { to: "admin@sandyq.test", resetToken: "12345678" } }))
    await runQueue(t)
    expect((await jobs(t))[0]).toMatchObject({ status: "dead-letter", error: "Ключ Resend не задан (RESEND_API_KEY) — провайдер email не подключён" })
    expect(fetchMock).not.toHaveBeenCalled()

    vi.stubEnv("RESEND_API_KEY", "test-resend-key")
    vi.stubEnv("EMAIL_FROM", "Sandyq <office@sandyq.test>")
    await t.run(async (ctx) => {
      const [job] = await ctx.db.query("integrationJobs").collect()
      await ctx.db.patch(job._id, { status: "queued", attempts: 0, nextAttemptAt: 0 })
    })
    await runQueue(t)
    const [job] = await jobs(t)
    expect(job).toMatchObject({ status: "completed", result: { provider: "resend", messageId: "msg-1", to: "a••••@sandyq.test" } })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://api.resend.com/emails")
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("reset:1")
    expect(JSON.parse(String(init.body))).toMatchObject({ from: "Sandyq <office@sandyq.test>", to: ["admin@sandyq.test"], subject: "Восстановление пароля OASIS Gastro" })
  })

  it("a temporary error retries with a growing nextAttemptAt up to the card's maxAttempts, then dead-letter", async () => {
    const t = await setup()
    vi.stubEnv("RESEND_API_KEY", "test-resend-key")
    vi.stubEnv("EMAIL_FROM", "office@sandyq.test")
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(503, { message: "Service unavailable" })))
    await t.run(async (ctx) => {
      await ctx.db.insert("integrationCards", {
        externalId: "card", moduleId: "integration-messaging", number: "SYS-2026-00001", name: "Resend и Mobizon", status: "published", organizationExternalId: "sandyq",
        provider: "resend", mode: "production", endpoint: "", secretRef: "RESEND_API_KEY", direction: "outbound", schedule: "", maxAttempts: 3, mapping: "{}", settings: {},
        searchText: "", version: 1, createdBy: "admin", createdAt: 0, updatedAt: 0,
      })
      await ctx.db.insert("integrationJobs", { ...base, externalId: "mail", provider: "email", operation: "office-user.password-reset", idempotencyKey: "reset:2", payload: { to: "admin@sandyq.test", resetToken: "12345678" } })
    })
    const delays: number[] = []
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const before = Date.now()
      await runQueue(t)
      const [job] = await jobs(t)
      expect(job).toMatchObject({ status: "retrying", attempts: attempt, error: "Resend: HTTP 503 — Service unavailable" })
      delays.push(job.nextAttemptAt - before)
      await makeDue(t)
    }
    expect(delays[1]).toBeGreaterThan(delays[0])
    await runQueue(t)
    expect((await jobs(t))[0]).toMatchObject({ status: "dead-letter", attempts: 3 })
  })

  it("a final 4xx refusal and a sandbox card go straight to dead-letter", async () => {
    const t = await setup()
    vi.stubEnv("RESEND_API_KEY", "test-resend-key")
    vi.stubEnv("EMAIL_FROM", "office@sandyq.test")
    const fetchMock = vi.fn(async () => jsonResponse(422, { message: "Invalid `to` field" }))
    vi.stubGlobal("fetch", fetchMock)
    await t.run((ctx) => ctx.db.insert("integrationJobs", { ...base, externalId: "mail", provider: "email", operation: "office-user.password-reset", idempotencyKey: "reset:3", payload: { to: "bad", resetToken: "1" } }))
    await runQueue(t)
    expect((await jobs(t))[0]).toMatchObject({ status: "dead-letter", attempts: 1, error: "Resend: HTTP 422 — Invalid `to` field" })

    await t.run(async (ctx) => {
      await ctx.db.insert("integrationCards", {
        externalId: "card", moduleId: "integration-messaging", number: "SYS-2026-00002", name: "Тест", status: "published", organizationExternalId: "sandyq",
        provider: "resend", mode: "sandbox", endpoint: "", secretRef: "RESEND_API_KEY", direction: "outbound", schedule: "", maxAttempts: 5, mapping: "{}", settings: {},
        searchText: "", version: 1, createdBy: "admin", createdAt: 0, updatedAt: 0,
      })
      await ctx.db.insert("integrationJobs", { ...base, externalId: "mail-2", provider: "email", operation: "office-user.password-reset", idempotencyKey: "reset:4", payload: { to: "admin@sandyq.test", resetToken: "1" } })
    })
    fetchMock.mockClear()
    await runQueue(t)
    expect((await jobs(t)).find((job) => job.externalId === "mail-2")?.error).toMatch(/sandbox/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("a campaign SMS resolves the phone at send time: the job, its result and error never hold the full number", async () => {
    const t = await setup()
    vi.stubEnv("MOBIZON_API_KEY", "test-mobizon-key")
    const fetchMock = vi.fn(async () => jsonResponse(200, { code: 0, data: { campaignId: "1", messageId: "42", status: 1 }, message: "" }))
    vi.stubGlobal("fetch", fetchMock)
    await guestWithConsents(t, ["personal-data", "sms"])
    await t.run((ctx) =>
      ctx.db.insert("integrationJobs", {
        ...base, externalId: "sms", provider: "messaging", operation: "send-campaign", sourceExternalId: "campaign-1", idempotencyKey: "campaign:campaign-1:guest-1:sms",
        payload: { campaignExternalId: "campaign-1", guestExternalId: "guest-1", channel: "sms", recipient: "7701•••••67", text: "Комбо выходного дня −20 %" },
      }),
    )
    await runQueue(t)
    const [job] = await jobs(t)
    expect(job).toMatchObject({ status: "completed", result: { provider: "mobizon", messageId: "42" } })
    expect(JSON.stringify(job)).not.toContain("1234567")
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url.startsWith("https://api.mobizon.kz/service/message/sendsmsmessage?output=json&api=v1&apiKey=")).toBe(true)
    expect(new URLSearchParams(String(init.body)).get("recipient")).toBe(PHONE)

    // Mobizon refuses: the error names the reason, not the number or the key.
    fetchMock.mockImplementation(async () => jsonResponse(200, { code: 1, data: {}, message: `Неверный номер ${PHONE}` }))
    await t.run((ctx) => ctx.db.insert("integrationJobs", { ...base, externalId: "sms-2", provider: "messaging", operation: "send-campaign", idempotencyKey: "k2", payload: { guestExternalId: "guest-1", channel: "sms", text: "Привет" } }))
    await runQueue(t)
    const failed = (await jobs(t)).find((row) => row.externalId === "sms-2")!
    expect(failed.status).toBe("dead-letter")
    expect(failed.error).not.toContain("test-mobizon-key")
  })

  it("a guest whose consent lapsed after queueing gets nothing", async () => {
    const t = await setup()
    vi.stubEnv("MOBIZON_API_KEY", "test-mobizon-key")
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    await guestWithConsents(t, ["sms"])
    await t.run((ctx) => ctx.db.insert("integrationJobs", { ...base, externalId: "sms", provider: "messaging", operation: "send-campaign", idempotencyKey: "k", payload: { guestExternalId: "guest-1", channel: "sms", text: "Привет" } }))
    await runQueue(t)
    expect((await jobs(t))[0]).toMatchObject({ status: "dead-letter", error: "Нет действующего согласия гостя на рассылку — сообщение не отправлено" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("a job outside its quiet hours moves to the next window without an attempt; an abandoned lease is taken again", async () => {
    const t = await setup()
    const now = Date.now()
    // A one-hour window that is not now.
    const almatyHour = new Date(now + 5 * 3_600_000).getUTCHours()
    const start = (almatyHour + 2) % 24
    const quietHours = { start: Math.min(start, 22), end: Math.min(start, 22) + 1 }
    await t.run(async (ctx) => {
      await ctx.db.insert("integrationJobs", { ...base, externalId: "later", provider: "messaging", operation: "send-campaign", idempotencyKey: "q", payload: { channel: "sms", text: "x", quietHours } })
      await ctx.db.insert("integrationJobs", { ...base, externalId: "stale", provider: "1c", operation: "export", idempotencyKey: "s", status: "processing", attempts: 1, nextAttemptAt: now - PROCESSING_LEASE_MS, payload: {} })
    })
    await runQueue(t)
    const rows = await jobs(t)
    const later = rows.find((job) => job.externalId === "later")!
    expect(later).toMatchObject({ status: "queued", attempts: 0 })
    expect(later.nextAttemptAt).toBe(nextAlmatyWindowTime(later.nextAttemptAt, quietHours.start, quietHours.end))
    expect(later.nextAttemptAt).toBeGreaterThan(now)
    expect(rows.find((job) => job.externalId === "stale")).toMatchObject({ status: "dead-letter", attempts: 2 })
  })

  it("ЕГАИС jobs are never queued under KZ; enqueue is idempotent by key", async () => {
    const t = await setup()
    await t.run(async (ctx) => {
      await expect(enqueueIntegrationJob(ctx, { provider: "egais", operation: "export", idempotencyKey: "e", payload: {}, organizationExternalId: "sandyq" })).rejects.toThrow(/ЕГАИС не применяется/)
      const first = await enqueueIntegrationJob(ctx, { provider: "1c", operation: "export", idempotencyKey: "same", payload: {}, organizationExternalId: "sandyq" })
      const second = await enqueueIntegrationJob(ctx, { provider: "1c", operation: "export", idempotencyKey: "same", payload: {}, organizationExternalId: "sandyq" })
      expect(first.created).toBe(true)
      expect(second).toEqual({ externalId: first.externalId, created: false })
    })
    expect(await jobs(t)).toHaveLength(1)
  })

  it("helpers: Mobizon numbers and message templates", () => {
    expect(mobizonRecipient("7011234567")).toBe("77011234567")
    expect(mobizonRecipient("87011234567")).toBe("77011234567")
    expect(mobizonRecipient("123")).toBeNull()
    const job = { externalId: "j", provider: "email", operation: "unknown", payload: {}, idempotencyKey: "k", attempts: 0 }
    expect(renderMessage(job)).toBeNull()
  })
})
