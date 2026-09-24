import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { insertAudit, writeAudit } from "../../convex/lib/audit"
import type { PosAccess } from "../../convex/lib/auth"
import { writeOfficeAudit } from "../../convex/lib/officeAccess"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")

async function setup() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
    for (const externalId of ["branch-a", "branch-b"]) {
      await ctx.db.insert("restaurants", { externalId, organizationExternalId: "sandyq", name: externalId, address: "—", timezone: "Asia/Almaty", active: true })
    }
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeRoles", { externalId: "auditor", name: "Аудитор филиала", capabilities: ["office.audit-log.view"], system: false })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], active: true })
    await ctx.db.insert("officeUsers", { externalId: "a", email: "a@sandyq.test", name: "Аудитор A", roleExternalId: "auditor", restaurantScopes: ["branch-a"], active: true })
  })
  return t
}

const page = { numItems: 10, cursor: null }

describe("one audit journal (W1-PLT-07)", () => {
  it("stores POS and office events together with search text", async () => {
    const t = await setup()
    await t.run(async (ctx) => {
      const restaurant = (await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", "branch-a")).unique())!
      const terminalId = await ctx.db.insert("posTerminals", { externalId: "t", restaurantId: restaurant._id, name: "Касса", terminalNumber: 1, nextOrderNumber: 1, active: true })
      const employeeId = await ctx.db.insert("employees", { code: "101", displayName: "Кассир", role: "cashier", restaurantIds: [restaurant._id], pinSalt: "s", pinHash: "h", active: true, failedAttempts: 0 })
      const sessionId = await ctx.db.insert("posSessions", { tokenHash: "x", purpose: "operator", employeeId, terminalId, createdAt: 1, lastActivityAt: 1, expiresAt: 2 })
      const access = { restaurant, terminal: (await ctx.db.get(terminalId))!, employee: (await ctx.db.get(employeeId))!, session: (await ctx.db.get(sessionId))! } as PosAccess
      await writeAudit(ctx, access, { action: "order.cancel", summary: "Отменён заказ №7", correlationId: "corr-42" })
      await writeOfficeAudit(ctx, "admin@sandyq.test", { action: "catalog.product", summary: "Изменена цена «Қазақ ет»", resourceType: "product", resourceExternalId: "kazakh-et" })
    })
    const all = await t.withIdentity({ email: "admin@sandyq.test" }).query(api.domains.platform.queries.auditLog, { paginationOpts: page })
    expect(all.page.map((event) => event.action).sort()).toEqual(["catalog.product", "order.cancel"])
    expect(all.page.every((event) => event.searchText && event.organizationExternalId === "sandyq")).toBe(true)

    const found = await t.withIdentity({ email: "admin@sandyq.test" }).query(api.domains.platform.queries.auditLog, { search: "corr-42", paginationOpts: page })
    expect(found.page.map((event) => event.summary)).toEqual(["Отменён заказ №7"])
  })

  it("a user scoped to branch A never reads branch B", async () => {
    const t = await setup()
    await t.run(async (ctx) => {
      for (const restaurantExternalId of ["branch-a", "branch-b"]) {
        await insertAudit(ctx, { actorKey: "x", action: "stock.receive", summary: `Приход ${restaurantExternalId}`, resourceType: "stock", resourceExternalId: "flour", organizationExternalId: "sandyq", restaurantExternalId })
      }
    })
    const asA = t.withIdentity({ email: "a@sandyq.test" })
    const own = await asA.query(api.domains.platform.queries.auditLog, { paginationOpts: page })
    expect(own.page.map((event) => event.restaurantExternalId)).toEqual(["branch-a"])
    await expect(asA.query(api.domains.platform.queries.auditLog, { restaurantExternalId: "branch-b", paginationOpts: page })).rejects.toThrow(/Нет доступа/)
    const searched = await asA.query(api.domains.platform.queries.auditLog, { search: "приход", paginationOpts: page })
    expect(searched.page.map((event) => event.restaurantExternalId)).toEqual(["branch-a"])
  })

  it("pages through events newest first", async () => {
    const t = await setup()
    await t.run(async (ctx) => {
      for (let index = 0; index < 25; index += 1) {
        await insertAudit(ctx, { actorKey: "x", action: "a", summary: `#${index}`, resourceType: "r", resourceExternalId: String(index), organizationExternalId: "sandyq", restaurantExternalId: "branch-a", occurredAt: 1000 + index })
      }
    })
    const admin = t.withIdentity({ email: "admin@sandyq.test" })
    const first = await admin.query(api.domains.platform.queries.auditLog, { paginationOpts: { numItems: 10, cursor: null } })
    expect(first.page[0].summary).toBe("#24")
    const second = await admin.query(api.domains.platform.queries.auditLog, { paginationOpts: { numItems: 10, cursor: first.continueCursor } })
    const third = await admin.query(api.domains.platform.queries.auditLog, { paginationOpts: { numItems: 10, cursor: second.continueCursor } })
    expect([...first.page, ...second.page, ...third.page]).toHaveLength(25)
    expect(third.isDone).toBe(true)
  })

  it("backfills search text for old events", async () => {
    const t = await setup()
    await t.run((ctx) => ctx.db.insert("auditEvents", { actorKey: "old", action: "a", summary: "Старое событие", resourceType: "r", resourceExternalId: "1", organizationExternalId: "sandyq", occurredAt: 1 }))
    const dry = await t.mutation(internal.domains.platform.internal.backfillAuditSearchText, { paginationOpts: page, dryRun: true })
    expect(dry.updated).toBe(1)
    await t.mutation(internal.domains.platform.internal.backfillAuditSearchText, { paginationOpts: page })
    const [event] = await t.run((ctx) => ctx.db.query("auditEvents").collect())
    expect(event.searchText).toContain("старое событие")
  })
})
