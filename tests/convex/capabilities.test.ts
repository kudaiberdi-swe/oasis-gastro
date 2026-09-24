import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { allowsCapability, CAPABILITY_CATALOG, isValidCapability } from "../../convex/lib/capabilities"
import { effectiveScopes, requireOrganizationScope, requireWarehouseScope } from "../../convex/lib/officeAccess"
import schema from "../../convex/schema"
import { officeItems } from "../../src/office/model/navigation"

const modules = import.meta.glob("../../convex/**/*.ts")

describe("capability catalog (W1-ACL-01)", () => {
  it("has exactly the office navigation sections, in order", () => {
    expect(CAPABILITY_CATALOG.map((section) => section.id)).toEqual(officeItems.map((item) => item.id))
    expect(CAPABILITY_CATALOG).toHaveLength(91)
  })

  it("validates the grammar and the section's actions", () => {
    for (const valid of ["*", "office.receipts.post", "office.receipts.*", "office.stock.view", "office.guests.pii", "office.payments.approve"]) expect(isValidCapability(valid), valid).toBe(true)
    for (const invalid of ["office..view", "office.receipts", "office.product-groups.post", "office.unknown.view", "stock.view", "office.receipts.delete"]) expect(isValidCapability(invalid), invalid).toBe(false)
  })

  it("allows *, a module wildcard and an exact right", () => {
    expect(allowsCapability(["*"], "office.receipts.post")).toBe(true)
    expect(allowsCapability(["office.receipts.*"], "office.receipts.post")).toBe(true)
    expect(allowsCapability(["office.receipts.view"], "office.receipts.view")).toBe(true)
    expect(allowsCapability(["office.receipts.view"], "office.receipts.post")).toBe(false)
  })

  it("keeps old module rights working through the aliases", () => {
    expect(allowsCapability(["office.catalog.*"], "office.nomenclature.edit")).toBe(true)
    expect(allowsCapability(["office.stock.*"], "office.receipts.post")).toBe(true)
    expect(allowsCapability(["office.stock.*"], "office.stock.view")).toBe(true)
    expect(allowsCapability(["office.finance.*"], "office.transactions.view")).toBe(true)
    expect(allowsCapability(["office.finance.view"], "office.transactions.post")).toBe(false)
    expect(allowsCapability(["office.catalog.*"], "office.receipts.view")).toBe(false)
  })
})

describe("scopes", () => {
  it("derives organizations from restaurants before M-6 and denies unknown warehouses", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert("restaurants", { externalId: "almaty", organizationExternalId: "sandyq", name: "Алматы", address: "—", timezone: "Asia/Almaty", active: true })
      const manager = { restaurantScopes: ["almaty"] }
      const scopes = await effectiveScopes(ctx, manager, { capabilities: ["office.stock.*"] })
      expect(scopes).toEqual({ restaurantScopes: ["almaty"], organizationScopes: ["sandyq"], warehouseScopes: [] })
      await expect(requireOrganizationScope(ctx, manager, "tary")).rejects.toThrow(/организации/)
      await expect(requireWarehouseScope(ctx, manager, "almaty-main")).rejects.toThrow(/складу/)
      await expect(requireWarehouseScope(ctx, { ...manager, warehouseScopes: ["almaty-main"] }, "almaty-main")).resolves.toBeUndefined()
      const admin = await effectiveScopes(ctx, { restaurantScopes: ["almaty"] }, { capabilities: ["*"] })
      expect(admin.organizationScopes).toEqual(["*"])
    })
  })
})
