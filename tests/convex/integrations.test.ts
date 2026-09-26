import { convexTest } from "convex-test"
import { describe, expect, it, vi } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { MAX_JOB_ATTEMPTS, retryDelayMs } from "../../convex/domains/integrations/internal"
import { appendOutboxEvent } from "../../convex/lib/outbox"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")

async function setup() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("restaurants", { externalId: "almaty", organizationExternalId: "sandyq", name: "Алматы", address: "—", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeRoles", { externalId: "viewer", name: "Наблюдатель", capabilities: ["office.integration-jobs.view"], system: false })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], active: true })
    await ctx.db.insert("officeUsers", { externalId: "viewer", email: "viewer@sandyq.test", name: "Наблюдатель", roleExternalId: "viewer", restaurantScopes: ["almaty"], active: true })
  })
  return t
}

const jobs = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query("integrationJobs").collect())

describe("outbox and integration queue (W1-PLT-06)", () => {
  it("event → job → completed on the event bus, once", async () => {
    const t = await setup()
    await t.run((ctx) => appendOutboxEvent(ctx, { aggregateType: "order", aggregateExternalId: "o-1", eventType: "order.paid", restaurantExternalId: "almaty" }))
    await t.mutation(internal.domains.integrations.internal.publishOutboxEvents, {})
    await t.mutation(internal.domains.integrations.internal.publishOutboxEvents, {})
    expect(await jobs(t)).toHaveLength(1)
    await t.action(internal.domains.integrations.internal.processIntegrationJobs, {})
    const [job] = await jobs(t)
    expect(job).toMatchObject({ status: "completed", attempts: 1, provider: "convex-event-bus", organizationExternalId: "sandyq" })
  })

  it("an event needs a restaurant or an organization", async () => {
    const t = await setup()
    await t.run(async (ctx) => {
      await expect(appendOutboxEvent(ctx, { aggregateType: "x", aggregateExternalId: "1", eventType: "x" })).rejects.toThrow(/нет ресторана или организации/)
    })
  })

  it("a provider without an adapter goes to dead-letter at once and can be retried or cancelled from the office", async () => {
    vi.useFakeTimers()
    try {
      const t = await setup()
      await t.run((ctx) =>
        ctx.db.insert("integrationJobs", { externalId: "j", provider: "unknown-erp", direction: "outbound", operation: "export", idempotencyKey: "k", status: "queued", attempts: 0, payload: {}, nextAttemptAt: 0, createdAt: 0, updatedAt: 0, organizationExternalId: "sandyq" }),
      )
      await t.action(internal.domains.integrations.internal.processIntegrationJobs, {})
      const [job] = await jobs(t)
      expect(job).toMatchObject({ status: "dead-letter", attempts: 1, error: "Адаптер «unknown-erp» не настроен — провайдер не подключён" })
      expect(retryDelayMs(20)).toBe(60 * 60 * 1000)
      expect(MAX_JOB_ATTEMPTS).toBe(5)

      const admin = t.withIdentity({ email: "admin@sandyq.test" })
      await admin.mutation(api.domains.integrations.mutations.retryIntegrationJob, { externalId: "j" })
      expect((await jobs(t))[0]).toMatchObject({ status: "queued", attempts: 0 })
      await admin.mutation(api.domains.integrations.mutations.cancelIntegrationJob, { externalId: "j" })
      expect((await jobs(t))[0].status).toBe("cancelled")
    } finally {
      vi.useRealTimers()
    }
  })

  it("needs the right to change jobs and lists only the user's organizations", async () => {
    const t = await setup()
    await t.run(async (ctx) => {
      const base = { direction: "outbound" as const, operation: "export", status: "queued" as const, attempts: 0, payload: {}, nextAttemptAt: 0, createdAt: 0, updatedAt: 0, provider: "1c" }
      await ctx.db.insert("integrationJobs", { ...base, externalId: "own", idempotencyKey: "a", organizationExternalId: "sandyq" })
      await ctx.db.insert("integrationJobs", { ...base, externalId: "other", idempotencyKey: "b", organizationExternalId: "tary" })
    })
    const viewer = t.withIdentity({ email: "viewer@sandyq.test" })
    await expect(viewer.mutation(api.domains.integrations.mutations.cancelIntegrationJob, { externalId: "own" })).rejects.toThrow(/Недостаточно прав/)
    const listed = await viewer.query(api.domains.integrations.queries.listIntegrationJobs, { paginationOpts: { numItems: 20, cursor: null } })
    expect(listed.page.map((job) => job.externalId)).toEqual(["own"])
  })
})
