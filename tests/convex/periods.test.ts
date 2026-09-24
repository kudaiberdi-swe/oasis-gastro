import { readFileSync } from "node:fs"

import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { assertPeriodOpen, findPeriodLocks } from "../../convex/lib/periods"
import { almatyBusinessDate, almatyDayStart, businessDateFor } from "../../convex/lib/time"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")

// Almaty is UTC+5: 2026-09-24 03:59 local = 2026-09-23 22:59 UTC.
const at = (local: string) => Date.parse(`${local}+05:00`)

describe("business day cutoff (W1-PLT-08)", () => {
  it("puts 03:59 in the previous day with a 04:00 cutoff and 04:00 in the current one", () => {
    expect(businessDateFor(at("2026-09-24T03:59:00"), 240)).toBe("2026-09-23")
    expect(businessDateFor(at("2026-09-24T04:00:00"), 240)).toBe("2026-09-24")
  })

  it("matches the old function with no cutoff and ignores out-of-range values", () => {
    for (const moment of [at("2026-09-24T00:00:00"), at("2026-09-24T23:59:59"), at("2026-01-01T00:30:00")]) {
      expect(businessDateFor(moment)).toBe(almatyBusinessDate(moment))
      expect(businessDateFor(moment, 900)).toBe(almatyBusinessDate(moment))
    }
  })
})

async function seedLocks(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    const base = { active: true, reason: "Закрытие месяца", createdBy: "admin@sandyq.kz", createdAt: 1 }
    await ctx.db.insert("periodLocks", { ...base, externalId: "a-org", organizationExternalId: "org-a", kind: "preliminary", lockedThrough: almatyDayStart("2026-08-31") })
    await ctx.db.insert("periodLocks", { ...base, externalId: "a-final", organizationExternalId: "org-a", restaurantExternalId: "almaty", kind: "final", lockedThrough: almatyDayStart("2026-08-31") })
    await ctx.db.insert("periodLocks", { ...base, externalId: "a-receipts", organizationExternalId: "org-a", restaurantExternalId: "almaty", moduleId: "receipts", kind: "final", lockedThrough: almatyDayStart("2026-09-15") })
    await ctx.db.insert("periodLocks", { ...base, externalId: "b-old", organizationExternalId: "org-b", kind: "final", lockedThrough: almatyDayStart("2026-09-30"), active: false })
  })
}

describe("period locks (W1-PLT-04)", () => {
  it("a lock of organization A does not block organization B (B-26)", async () => {
    const t = convexTest(schema, modules)
    await seedLocks(t)
    await t.run(async (ctx) => {
      await expect(assertPeriodOpen(ctx, { organizationExternalId: "org-a", restaurantExternalId: "shymkent", businessDate: "2026-08-20" })).rejects.toThrow(/предварительно закрыт по 31\.08\.2026/)
      await expect(assertPeriodOpen(ctx, { organizationExternalId: "org-b", restaurantExternalId: "almaty", businessDate: "2026-08-20" })).resolves.toBeUndefined()
      await expect(assertPeriodOpen(ctx, { organizationExternalId: "org-a", restaurantExternalId: "almaty", businessDate: "2026-09-01" })).resolves.toBeUndefined()
    })
  })

  it("a module lock only covers its module, and final wins over preliminary", async () => {
    const t = convexTest(schema, modules)
    await seedLocks(t)
    await t.run(async (ctx) => {
      await expect(assertPeriodOpen(ctx, { organizationExternalId: "org-a", restaurantExternalId: "almaty", businessDate: "2026-09-10", moduleId: "receipts" })).rejects.toThrow(/окончательно закрыт по 15\.09\.2026/)
      await expect(assertPeriodOpen(ctx, { organizationExternalId: "org-a", restaurantExternalId: "almaty", businessDate: "2026-09-10", moduleId: "orders" })).resolves.toBeUndefined()
      const [first] = await findPeriodLocks(ctx, { organizationExternalId: "org-a", restaurantExternalId: "almaty", businessDate: "2026-08-10", moduleId: "orders" })
      expect(first.kind).toBe("final")
      await expect(assertPeriodOpen(ctx, { organizationExternalId: "org-a", restaurantExternalId: "almaty", businessDate: "2026-08-10" })).rejects.toThrow(/окончательно/)
    })
  })
})

describe("every posting checks the period", () => {
  const source = (file: string) => readFileSync(new URL(`../../convex/domains/${file}`, import.meta.url), "utf8")
  const handlerOf = (code: string, name: string) => {
    const start = code.indexOf(`export const ${name} = mutation(`)
    expect(start, name).toBeGreaterThanOrEqual(0)
    const next = code.indexOf("export const ", start + 10)
    return code.slice(start, next < 0 ? undefined : next)
  }

  it("orders: checkout, refund, cancel", () => {
    const code = source("orders/mutations.ts")
    for (const name of ["checkout", "refund", "cancel"]) expect(handlerOf(code, name), name).toMatch(/assertPeriodOpen\(/)
  })

  it("stock: receive, write-off, adjust", () => {
    const code = source("stock/mutations.ts")
    for (const name of ["receiveStock", "writeOffStock", "adjustStock"]) expect(handlerOf(code, name), name).toMatch(/assertStockPeriodOpen\(/)
  })
})
