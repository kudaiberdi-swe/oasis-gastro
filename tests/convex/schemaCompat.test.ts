import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")

// W1-PLT-01 is deploy 1 of 2: every new field on an existing table is optional, so documents written
// before this change (prod data) still validate. convex-test enforces the schema on insert.
describe("schema v1 platform fields are backward compatible", () => {
  it("accepts pre-W1 documents in every changed table", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
      const restaurantId = await ctx.db.insert("restaurants", { externalId: "r", organizationExternalId: "sandyq", name: "R", address: "—", timezone: "Asia/Almaty", active: true })
      const terminalId = await ctx.db.insert("posTerminals", { externalId: "t", restaurantId, name: "Касса", terminalNumber: 1, nextOrderNumber: 1, active: true })
      await ctx.db.insert("officeUsers", { externalId: "u", email: "a@b.kz", name: "A", roleExternalId: "administrator", restaurantScopes: ["*"], active: true })
      await ctx.db.insert("auditEvents", { actorKey: "x", action: "a", summary: "s", resourceType: "order", resourceExternalId: "o", organizationExternalId: "sandyq", occurredAt: 1, terminalId })
      await ctx.db.insert("iikoImportRuns", { runExternalId: "run", status: "completed", startedAt: 1, counts: { departments: 1, employees: 2 } })
      await ctx.db.insert("iikoEndpointStates", { endpointKey: "corporation/departments", lastStatus: "ok", lastRunAt: 1 })
    })
  })

  it("stores the new platform tables", async () => {
    const t = convexTest(schema, modules)
    const counts = await t.run(async (ctx) => {
      const legacy = await ctx.db.insert("ledgerEntries", {
        restaurantExternalId: "r",
        businessDate: "2026-09-24",
        occurredAt: 1,
        kind: "revenue",
        category: "Выручка",
        amount: 1000,
        sourceModuleId: "orders",
        sourceExternalId: "orders:1",
        description: "Выручка",
        createdAt: 1,
      })
      await ctx.db.insert("accounts", { externalId: "1010", code: "1010", name: "Денежные средства в кассе", type: "asset", allowManualEntries: true, system: true, active: true })
      const entry = await ctx.db.insert("journalEntries", {
        externalId: "je-1",
        organizationExternalId: "sandyq",
        restaurantExternalId: "r",
        sourceModuleId: "orders",
        sourceExternalId: "1",
        sourceNumber: "1",
        occurredAt: 1,
        businessDate: "2026-09-24",
        debitAccountExternalId: "1010",
        creditAccountExternalId: "6010",
        amount: 1000,
        description: "Выручка",
        legacyLedgerEntryId: legacy,
      })
      await ctx.db.insert("journalEntries", {
        externalId: "je-2",
        organizationExternalId: "sandyq",
        restaurantExternalId: "r",
        sourceModuleId: "orders",
        sourceExternalId: "1",
        sourceNumber: "1",
        occurredAt: 2,
        businessDate: "2026-09-24",
        debitAccountExternalId: "6010",
        creditAccountExternalId: "1010",
        amount: 1000,
        description: "Сторно",
        reversalOf: entry,
      })
      await ctx.db.insert("periodLocks", { externalId: "pl", organizationExternalId: "sandyq", kind: "final", lockedThrough: 1, active: true, reason: "Август закрыт", createdBy: "a@b.kz", createdAt: 1 })
      await ctx.db.insert("outboxEvents", { externalId: "ev", aggregateType: "order", aggregateExternalId: "1", eventType: "order.paid", organizationExternalId: "sandyq", payload: {}, status: "pending", attempts: 0, availableAt: 1, createdAt: 1 })
      await ctx.db.insert("integrationJobs", { externalId: "job", provider: "1c", direction: "outbound", operation: "export", idempotencyKey: "k", status: "queued", attempts: 0, payload: {}, nextAttemptAt: 1, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert("documentCounters", { scopeKey: "receipts:sandyq:2026", next: 1 })
      return (await ctx.db.query("journalEntries").withIndex("by_source", (q) => q.eq("sourceExternalId", "1")).collect()).length
    })
    expect(counts).toBe(2)
  })
})
