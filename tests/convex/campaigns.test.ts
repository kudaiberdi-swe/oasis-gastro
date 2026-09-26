import { convexTest } from "convex-test"
import { afterEach, describe, expect, it, vi } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { almatyBusinessDate, almatyDayStart, DAY_MS } from "../../convex/lib/time"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")
const campaigns = api.domains.loyalty.campaigns
const HOUR = 3_600_000

// «Рассылки и акции» (W3-LOY-08): consent-only audience, idempotent jobs, Almaty quiet hours.

async function setup() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("restaurants", { externalId: "almaty", organizationExternalId: "sandyq", name: "Sandyq Алматы", address: "—", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("restaurants", { externalId: "astana", organizationExternalId: "sandyq", name: "Sandyq Астана", address: "—", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeRoles", { externalId: "branch", name: "Маркетолог филиала", capabilities: ["office.campaigns.*"], system: false })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["*"], active: true })
    await ctx.db.insert("officeUsers", { externalId: "branch", email: "branch@sandyq.test", name: "Филиал", roleExternalId: "branch", restaurantScopes: ["astana"], active: true })
    await ctx.db.insert("guestCategories", { externalId: "vip", code: "VIP", name: "VIP", color: "gold", assignment: "manual", minimumSpend: 0, minimumVisits: 0, validDays: 0, active: true, createdAt: 0, updatedAt: 0 })
    const guest = async (externalId: string, phone: string, consents: { channel: "personal-data" | "sms" | "email"; validUntil?: number }[], extra: Record<string, unknown> = {}) => {
      const guestId = await ctx.db.insert("guests", { phone, points: 0, createdAt: 0, externalId, status: "active", consentState: "granted", restaurantExternalId: "almaty", lastVisitAt: 1, ...extra })
      for (const consent of consents) await ctx.db.insert("guestConsents", { guestId, channel: consent.channel, granted: true, source: "office", actorKey: "admin", recordedAt: 1, ...(consent.validUntil ? { validUntil: consent.validUntil } : {}) })
    }
    await guest("g-ok", "77010000001", [{ channel: "personal-data" }, { channel: "sms" }], { categoryExternalIds: ["vip"] })
    await guest("g-no-sms", "77010000002", [{ channel: "personal-data" }])
    await guest("g-unknown", "77010000003", [{ channel: "personal-data" }, { channel: "sms" }], { consentState: "unknown" })
    await guest("g-expired", "77010000004", [{ channel: "personal-data" }, { channel: "sms", validUntil: 5 }])
    await guest("g-no-pd", "77010000005", [{ channel: "sms" }])
    await guest("g-other-branch", "77010000006", [{ channel: "personal-data" }, { channel: "sms" }], { restaurantExternalId: "astana" })
  })
  return t
}

type T = Awaited<ReturnType<typeof setup>>
const jobs = (t: T) => t.run((ctx) => ctx.db.query("integrationJobs").withIndex("by_source_status").collect())
const campaignJobs = async (t: T) => (await jobs(t)).filter((job) => job.operation === "send-campaign")

/** Tomorrow 22:00 in Almaty and the expected send time — 09:00 of the day after. */
function lateEvening() {
  const day = almatyBusinessDate(Date.now() + DAY_MS)
  const start = almatyDayStart(day)
  return { scheduledAt: start + 22 * HOUR, expected: start + DAY_MS + 9 * HOUR }
}

const draft = (scheduledAt: number, extra: Record<string, unknown> = {}) => ({
  name: "Комбо выходного дня",
  channel: "sms" as const,
  restaurantExternalIds: ["almaty"],
  scheduledAt,
  quietHoursStart: 9,
  quietHoursEnd: 20,
  template: "Комбо выходного дня −20 % в Sandyq",
  ...extra,
})

async function approve(t: T, externalId: string, version: number) {
  const admin = t.withIdentity({ email: "admin@sandyq.test" })
  let current = version
  for (const action of ["submit", "approve"] as const) current = (await admin.mutation(campaigns.transitionCampaign, { externalId, action, expectedVersion: current })).version
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  return current
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("campaigns with quiet hours (W3-LOY-08)", () => {
  it("queues only guests with consent to personal data and to SMS; unknown consent state and lapsed consents are out", async () => {
    vi.useFakeTimers()
    const t = await setup()
    const admin = t.withIdentity({ email: "admin@sandyq.test" })
    const { scheduledAt } = lateEvening()
    expect(await admin.query(campaigns.campaignAudience, { channel: "sms", restaurantExternalIds: ["almaty"] })).toEqual({ count: 1, capped: false })
    const saved = await admin.mutation(campaigns.saveCampaign, draft(scheduledAt))
    expect(saved.number).toMatch(/^CMP-\d{4}-00001$/)
    await approve(t, saved.externalId, saved.version)
    const queued = await campaignJobs(t)
    expect(queued.map((job) => job.payload.guestExternalId)).toEqual(["g-ok"])
    expect(queued[0]).toMatchObject({ provider: "messaging", status: "queued", payload: { channel: "sms", campaignName: "Комбо выходного дня", restaurantExternalId: "almaty" }, idempotencyKey: `campaign:${saved.externalId}:g-ok:sms`, organizationExternalId: "sandyq" })
    expect(JSON.stringify(queued[0])).not.toContain("77010000001")
    const card = await admin.query(campaigns.getCampaign, { externalId: saved.externalId })
    expect(card).toMatchObject({ status: "approved", audienceCount: 1, enqueueState: "done", jobsPending: true })
  })

  it("a launch at 22:00 Almaty with a 9–20 window is sent at 09:00 the next day", async () => {
    vi.useFakeTimers()
    const t = await setup()
    const admin = t.withIdentity({ email: "admin@sandyq.test" })
    const { scheduledAt, expected } = lateEvening()
    const saved = await admin.mutation(campaigns.saveCampaign, draft(scheduledAt))
    await approve(t, saved.externalId, saved.version)
    const [job] = await campaignJobs(t)
    expect(job.nextAttemptAt).toBe(expected)
    expect(job.payload.quietHours).toEqual({ start: 9, end: 20 })
  })

  it("approving again or repeating a batch never doubles the jobs", async () => {
    vi.useFakeTimers()
    const t = await setup()
    const admin = t.withIdentity({ email: "admin@sandyq.test" })
    const saved = await admin.mutation(campaigns.saveCampaign, draft(lateEvening().scheduledAt, { restaurantExternalIds: ["*"] }))
    const version = await approve(t, saved.externalId, saved.version)
    await expect(admin.mutation(campaigns.transitionCampaign, { externalId: saved.externalId, action: "approve", expectedVersion: version })).rejects.toThrow(/недоступно/)
    await t.mutation(internal.domains.loyalty.campaigns.enqueueCampaign, { campaignExternalId: saved.externalId, cursor: null })
    const queued = await campaignJobs(t)
    expect(queued.map((job) => job.payload.guestExternalId).sort()).toEqual(["g-ok", "g-other-branch"])
    expect((await admin.query(campaigns.getCampaign, { externalId: saved.externalId }))?.audienceCount).toBe(2)
  })

  it("a category narrows the audience; without the provider key the messages end in dead-letter and count as errors", async () => {
    vi.useFakeTimers()
    const t = await setup()
    const admin = t.withIdentity({ email: "admin@sandyq.test" })
    expect(await admin.query(campaigns.campaignAudience, { channel: "sms", categoryExternalId: "vip", restaurantExternalIds: ["*"] })).toEqual({ count: 1, capped: false })
    // Scheduled now, inside the window or not — the queue itself moves it into the window.
    const now = Date.now()
    const saved = await admin.mutation(campaigns.saveCampaign, draft(now, { categoryExternalId: "vip", quietHoursStart: 0, quietHoursEnd: 24 }))
    const version = await approve(t, saved.externalId, saved.version)
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    await t.action(internal.domains.integrations.internal.processIntegrationJobs, {})
    const [job] = await campaignJobs(t)
    expect(job).toMatchObject({ status: "dead-letter", error: "Ключ Mobizon не задан (MOBIZON_API_KEY) — провайдер SMS не подключён" })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await admin.query(campaigns.getCampaign, { externalId: saved.externalId })).toMatchObject({ sentCount: 0, failedCount: 1, jobsPending: false })

    await admin.mutation(api.domains.integrations.mutations.retryIntegrationJob, { externalId: job.externalId })
    expect((await admin.query(campaigns.getCampaign, { externalId: saved.externalId }))?.failedCount).toBe(0)
    await expect(admin.mutation(campaigns.transitionCampaign, { externalId: saved.externalId, action: "complete", expectedVersion: version })).rejects.toThrow(/в очереди/)
    await admin.mutation(campaigns.transitionCampaign, { externalId: saved.externalId, action: "cancel", expectedVersion: version, reason: "Акция перенесена" })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect((await campaignJobs(t))[0].status).toBe("cancelled")
  })

  it("validates the card and keeps branch users inside their restaurants", async () => {
    const t = await setup()
    const admin = t.withIdentity({ email: "admin@sandyq.test" })
    const branch = t.withIdentity({ email: "branch@sandyq.test" })
    const { scheduledAt } = lateEvening()
    await expect(admin.mutation(campaigns.saveCampaign, draft(scheduledAt, { quietHoursStart: 20, quietHoursEnd: 9 }))).rejects.toThrow(/Окно отправки/)
    await expect(admin.mutation(campaigns.saveCampaign, draft(scheduledAt, { channel: "email" }))).rejects.toThrow(/тему письма/)
    await expect(admin.mutation(campaigns.saveCampaign, draft(scheduledAt, { template: "  " }))).rejects.toThrow(/текст сообщения/)
    await expect(branch.mutation(campaigns.saveCampaign, draft(scheduledAt))).rejects.toThrow(/Нет доступа к ресторану/)
    await expect(branch.mutation(campaigns.saveCampaign, draft(scheduledAt, { restaurantExternalIds: ["*"] }))).rejects.toThrow(/всей сети/)
    const own = await branch.mutation(campaigns.saveCampaign, draft(scheduledAt, { restaurantExternalIds: ["astana"] }))
    await admin.mutation(campaigns.saveCampaign, draft(scheduledAt))
    const listed = await branch.query(campaigns.listCampaigns, { paginationOpts: { numItems: 20, cursor: null } })
    expect(listed.page.map((row) => row.externalId)).toEqual([own.externalId])
    expect(listed.page[0]).not.toHaveProperty("template")
  })
})
