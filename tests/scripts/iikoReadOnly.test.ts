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
    expect(sanitizeRecord({ id: "t", name: "Касса", groupInfo: { id: "d", name: "Sandyq", password: "x" }, phone: "1" }, "terminal")).toEqual({ id: "t", name: "Касса", groupInfo: { id: "d", name: "Sandyq" } })
    expect(sanitizeRecord({ id: "p", modifiers: [{ id: "m", secret: 1 }], placeType: { id: "hot", extra: 1 } }, "product")).toEqual({ id: "p", modifiers: [{ id: "m" }], placeType: { id: "hot" } })
    expect(() => sanitizeRecord({ id: 1 }, "orders")).toThrow(/No sanitizer/)
    for (const endpoint of ENDPOINTS as { domain: string }[]) expect(ALLOWLISTS[endpoint.domain], endpoint.domain).toBeDefined()
  })

  it("no iiko script uses a mutating HTTP method", () => {
    const dir = path.resolve(__dirname, "../../scripts/iiko")
    for (const file of readdirSync(dir)) {
      const source = readFileSync(path.join(dir, file), "utf8")
      expect(source, file).not.toMatch(/method:\s*["'](POST|PUT|DELETE|PATCH)["']/)
    }
  })
})
