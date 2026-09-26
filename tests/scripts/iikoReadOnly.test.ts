import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

// @ts-expect-error plain ESM script without types
import { ALLOWLISTS, sanitizeRecord } from "../../scripts/iiko/lib.mjs"
// @ts-expect-error plain ESM script without types
import { ENDPOINTS } from "../../scripts/iiko/endpoint-registry.mjs"

describe("iiko stays read-only (W1-IIKO-01)", () => {
  it("strips personal data outside the allowlist, keeps nested allowed keys, refuses unknown domains", () => {
    const supplier = sanitizeRecord({ id: "s1", code: "1", name: "ТОО Мясо", supplier: true, phone: "+77010000000", email: "a@b.kz", iin: "900101300123", address: "Алматы", login: "x" }, "supplier")
    expect(supplier).toEqual({ id: "s1", code: "1", name: "ТОО Мясо", supplier: true })
    expect(sanitizeRecord({ id: "t", name: "Касса", groupInfo: { id: "d", password: "x" }, phone: "1" }, "terminal")).toEqual({ id: "t", name: "Касса" })
    expect(sanitizeRecord({ id: "p", name: "Бешбармак", type: "DISH", modifiers: [{ id: "m" }], description: "x" }, "product")).toEqual({ id: "p", name: "Бешбармак", type: "DISH" })
    expect(sanitizeRecord({ id: "c", assembledProductId: "p", items: [{ productId: "i", amountIn: 0.2, cost: 5 }] }, "recipe")).toEqual({ id: "c", assembledProductId: "p", items: [{ productId: "i", amountIn: 0.2 }] })
    expect(sanitizeRecord({ departmentId: "d", productId: "p", prices: [{ price: 5450, documentId: "x", dateFrom: "2026-06-12" }] }, "price")).toEqual({ departmentId: "d", productId: "p", prices: [{ price: 5450, dateFrom: "2026-06-12" }] })
    expect(() => sanitizeRecord({ id: 1 }, "orders")).toThrow(/No sanitizer/)
    for (const endpoint of ENDPOINTS as { domain: string }[]) expect(ALLOWLISTS[endpoint.domain], endpoint.domain).toBeDefined()
  })

  it("cash shifts and orders carry no personal data (D7): the manager only by id, no waiter or guest columns", () => {
    expect(sanitizeRecord({ id: "s", sessionNumber: 7, managerId: "e1", managerName: "Иванов", salesCash: 100, phone: "1" }, "cash-shift")).toEqual({ id: "s", sessionNumber: 7, managerId: "e1", salesCash: 100 })
    expect(sanitizeRecord({ orderId: "o", orderNumber: 5, total: 900, waiterName: "Айгерим", guestPhone: "+7", guestName: "Гость" }, "order")).toEqual({ orderId: "o", orderNumber: 5, total: 900 })
  })

  it("no iiko script uses a mutating HTTP method", () => {
    const dir = path.resolve(__dirname, "../../scripts/iiko")
    for (const file of readdirSync(dir)) {
      const source = readFileSync(path.join(dir, file), "utf8")
      expect(source, file).not.toMatch(/method:\s*["'](POST|PUT|DELETE|PATCH)["']/)
    }
  })
})
