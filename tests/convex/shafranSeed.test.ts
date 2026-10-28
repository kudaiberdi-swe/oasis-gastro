import { convexTest } from "convex-test"
import { afterEach, describe, expect, it, vi } from "vitest"

import { internal } from "../../convex/_generated/api"
import schema from "../../convex/schema"
import { businessDateFor, DAY_MS } from "../../convex/lib/time"
import { SHAFRAN_DEMO_RESTAURANT } from "../../convex/domains/seed/shafranData"
import { DEMO_OFFICE_LOGINS, DEMO_RESTAURANT } from "../../frontend/app/shared/demo/demo-logins"

// Demo chain «Шафран» (convex/domains/seed/shafran.ts): dev-only guard, wipe, idempotent seed on a small slice.

const modules = import.meta.glob("../../convex/**/*.ts")
const DEV_URL = "https://dapper-lobster-404.convex.cloud"
const demoEmails = DEMO_OFFICE_LOGINS.map((login) => login.email)

afterEach(() => vi.unstubAllEnvs())

async function counts(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const result: Record<string, number> = {}
    for (const table of ["organizations", "restaurants", "products", "productPrices", "inventoryItems", "recipes", "guests", "employees", "orders", "orderLines", "payments", "shifts", "zReports", "receipts", "stockMovements", "dailySalesFacts", "journalEntries", "kitchenTickets", "deliveryOrders", "loyaltyTransactions"] as const) {
      result[table] = (await ctx.db.query(table).collect()).length
    }
    return result
  })
}

describe("[shafran-demo-seed] dev-only guard", () => {
  it("[shafran-demo-seed] refuses to wipe or seed on the production deployment", async () => {
    vi.stubEnv("CONVEX_CLOUD_URL", "https://clear-flamingo-97.convex.cloud")
    const t = convexTest(schema, modules)
    await t.run((ctx) => ctx.db.insert("organizations", { externalId: "client", name: "Клиент", currency: "KZT", timezone: "Asia/Almaty", active: true }))
    await expect(t.mutation(internal.domains.seed.shafran.wipePage, { table: "organizations" })).rejects.toThrow(/только для dev-развёртывания dapper-lobster-404/)
    await expect(t.action(internal.domains.seed.shafran.wipeAll, {})).rejects.toThrow(/dapper-lobster-404/)
    await expect(t.action(internal.domains.seed.shafran.seedChain, { demoEmails })).rejects.toThrow(/dapper-lobster-404/)
    await expect(t.mutation(internal.domains.seed.shafran.seedDay, { restaurantExternalId: "shafran-01", businessDate: "2026-01-01", startDate: "2026-01-01", from: 0, baseOrders: 2 })).rejects.toThrow(/dapper-lobster-404/)
    expect(await t.run((ctx) => ctx.db.query("organizations").collect())).toHaveLength(1)
  })

  it("[shafran-demo-seed] refuses when the deployment URL is unknown or only looks like dev", async () => {
    const t = convexTest(schema, modules)
    vi.stubEnv("CONVEX_CLOUD_URL", "")
    await expect(t.mutation(internal.domains.seed.shafran.wipePage, { table: "organizations" })).rejects.toThrow(/dapper-lobster-404/)
    vi.stubEnv("CONVEX_CLOUD_URL", "https://evil.example/dapper-lobster-404.convex.cloud")
    await expect(t.mutation(internal.domains.seed.shafran.wipePage, { table: "organizations" })).rejects.toThrow(/dapper-lobster-404/)
  })
})

describe("[shafran-demo-seed] wipe", () => {
  it("[shafran-demo-seed] wipes client tables but keeps sign-in, office roles and refuses kept tables", async () => {
    vi.stubEnv("CONVEX_CLOUD_URL", DEV_URL)
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert("organizations", { externalId: "client", name: "Клиент", currency: "KZT", timezone: "Asia/Almaty", active: true })
      await ctx.db.insert("iikoDepartments", { externalId: "d1", name: "Отдел", type: "DEPARTMENT", sourceHash: "h", importedAt: 0 })
      await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
      await ctx.db.insert("officeUsers", { externalId: "owner", email: "owner@example.test", name: "Владелец", roleExternalId: "administrator", restaurantScopes: ["*"], active: true })
      await ctx.db.insert("users", { email: "owner@example.test" })
    })
    const deleted = await t.action(internal.domains.seed.shafran.wipeAll, {})
    expect(deleted).toMatchObject({ organizations: 1, iikoDepartments: 1 })
    expect(await t.run((ctx) => ctx.db.query("officeUsers").collect())).toHaveLength(1)
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(1)
    await expect(t.mutation(internal.domains.seed.shafran.wipePage, { table: "officeUsers" })).rejects.toThrow(/не очищается/)
  })
})

describe("[shafran-demo-seed] seed", () => {
  it("[shafran-demo-seed] seeds the chain and a day of sales once — a re-run changes nothing", { timeout: 120_000 }, async () => {
    vi.stubEnv("CONVEX_CLOUD_URL", DEV_URL)
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert("officeUsers", { externalId: "owner", email: "owner@example.test", name: "Владелец", roleExternalId: "administrator", restaurantScopes: ["old-a", "old-b"], organizationScopes: ["*"], warehouseScopes: ["*"], active: true })
      await ctx.db.insert("officeUsers", { externalId: "branch-manager", email: "manager@example.test", name: "Управляющий", roleExternalId: "restaurant-manager", restaurantScopes: ["old-a"], organizationScopes: ["old-org"], warehouseScopes: [], active: true })
      await ctx.db.insert("officeUsers", { externalId: "demo-administrator", email: "demo-admin@old.example", name: "Демо", roleExternalId: "administrator", restaurantScopes: ["old-a"], active: true })
      const userId = await ctx.db.insert("users", { email: "demo-admin@old.example" })
      await ctx.db.insert("authAccounts", { userId, provider: "password", providerAccountId: "demo-admin@old.example", secret: "x" })
    })
    const yesterday = businessDateFor(Date.now() - DAY_MS)
    const seedOnce = async () => {
      await t.action(internal.domains.seed.shafran.seedChain, { demoEmails })
      for (let from: number | null = 0; from !== null; ) {
        from = (await t.mutation(internal.domains.seed.shafran.seedDay, { restaurantExternalId: "shafran-02", businessDate: yesterday, startDate: yesterday, from, baseOrders: 4 })).next
      }
    }
    await seedOnce()
    const first = await counts(t)
    expect(first).toMatchObject({ organizations: 1, restaurants: 16, products: 62, productPrices: 62 * 16, guests: 200, employees: 37, shifts: 1, zReports: 1 })
    expect(first.orders).toBeGreaterThan(0)
    expect(first.payments).toBe(first.orders)
    expect(first.receipts).toBeGreaterThan(0)
    expect(first.stockMovements).toBeGreaterThan(first.receipts)
    expect(first.dailySalesFacts).toBeGreaterThan(0)

    await seedOnce()
    expect(await counts(t)).toEqual(first)

    const orders = await t.run((ctx) => ctx.db.query("orders").collect())
    expect(orders.every((order) => order.status === "paid" && order.businessDate === yesterday)).toBe(true)
    const shift = await t.run((ctx) => ctx.db.query("shifts").first())
    expect(shift).toMatchObject({ status: "closed", variance: 0 })
    expect(await t.query(internal.domains.seed.shafran.leftoverNames, {})).toEqual([])

    const users = await t.run((ctx) => ctx.db.query("officeUsers").collect())
    expect(users.map((user) => [user.externalId, user.restaurantScopes, user.organizationScopes])).toEqual([
      ["owner", ["*"], ["*"]],
      ["branch-manager", [SHAFRAN_DEMO_RESTAURANT], ["shafran"]],
    ])
    expect(await t.run((ctx) => ctx.db.query("authAccounts").collect())).toEqual([])
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toEqual([])
  })

  it("[shafran-demo-seed] the demo sign-ins point at the seeded demo branch", () => {
    expect(DEMO_RESTAURANT).toBe(SHAFRAN_DEMO_RESTAURANT)
  })
})
