import { convexTest, type TestConvex } from "convex-test"

import { api, internal } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import schema from "../../../convex/schema"

// One restaurant, one terminal with an open shift, a cashier session, three single-use manager
// approvals (m1–m3) and a 1000 ₸ dish; optionally the chart of accounts and retail defaults.

const modules = import.meta.glob("../../../convex/**/*.ts")
export const cashier = "cashier-token"

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export async function setup({ ledger = true, retail = true } = {}) {
  const t = convexTest(schema, modules)
  if (ledger) await t.mutation(internal.domains.finance.seed.seedChartOfAccounts, {})
  if (ledger && retail) await t.mutation(internal.domains.retail.internal.seedDefaults, {})
  const productId = await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
    const restaurantId = await ctx.db.insert("restaurants", { externalId: "almaty", organizationExternalId: "sandyq", name: "Алматы", address: "—", timezone: "Asia/Almaty", active: true })
    const terminalId = await ctx.db.insert("posTerminals", { externalId: "t1", restaurantId, name: "Касса 1", terminalNumber: 1, nextOrderNumber: 1, active: true })
    const base = { restaurantIds: [restaurantId], pinSalt: "s", pinHash: "h", active: true, failedAttempts: 0 }
    const cashierId = await ctx.db.insert("employees", { ...base, code: "101", displayName: "Кассир", role: "cashier" })
    const managerId = await ctx.db.insert("employees", { ...base, code: "900", displayName: "Менеджер", role: "manager" })
    const session = { createdAt: Date.now(), lastActivityAt: Date.now(), expiresAt: Date.now() + 3_600_000, terminalId }
    await ctx.db.insert("posSessions", { ...session, tokenHash: await digest(cashier), purpose: "operator", employeeId: cashierId })
    for (const token of ["m1", "m2", "m3"]) await ctx.db.insert("posSessions", { ...session, tokenHash: await digest(token), purpose: "manager-approval", employeeId: managerId })
    await ctx.db.insert("categories", { externalId: "hot", label: "Горячее", shortLabel: "Горячее", sortOrder: 1, active: true })
    return ctx.db.insert("products", { externalId: "dish", name: "Бешбармак", nameKk: "Бешбармақ", nameSort: "бешбармак", searchText: "бешбармак", description: "", category: "hot", categorySort: 1, basePrice: 1000, popular: false, sku: "D", baseUnit: "порц.", enabled: true })
  })
  await t.mutation(api.domains.shifts.mutations.open, { sessionToken: cashier, openingCash: 0, note: "" })
  return { t, productId }
}

export async function draft(t: TestConvex<typeof schema>, productId: Id<"products">, quantity = 2) {
  const result = await t.mutation(api.domains.orders.mutations.saveDraft, { sessionToken: cashier, clientOrderId: crypto.randomUUID(), orderType: "dine-in", tableLabel: "Стол 1", discountPercent: 0, comment: "", lines: [{ productId, quantity }] })
  if ("outcome" in result) throw new Error(result.outcome)
  return result // 2 × 1000 + 15 % = 2300
}

