import { describe, expect, it } from "vitest"

import { composeSheet, renderGenerated } from "../../scripts/test-credentials.mjs"

// Synthetic values only — never real codes or PINs.
const seed = { generatedAt: "2026-01-01T00:00:00.000Z", deployment: "dev:example-000", credentials: [{ role: "cashier", code: "10000", pin: "0000" }, { role: "manager", code: "90000", pin: "1111" }] }

describe("test-credentials sheet", () => {
  it("lists every seeded role with its code and PIN", () => {
    const block = renderGenerated(seed)
    expect(block).toContain("| Кассир | `10000` | `0000` |")
    expect(block).toContain("| Менеджер | `90000` | `1111` |")
    expect(block).toContain("sandyq-almaty-01")
  })

  it("builds a new sheet with blank owner rows for the office and prod", () => {
    const sheet = composeSheet(null, renderGenerated(seed))
    expect(sheet).toMatch(/^# Тестовые доступы Sandyq/)
    expect(sheet).toContain("## Dev — офис")
    expect(sheet).toContain("## Prod")
  })

  it("refreshes only the generated block and keeps what the owner typed", () => {
    const first = composeSheet(null, renderGenerated(seed)).replace("| Пароль | |", "| Пароль | owner-typed |")
    const next = composeSheet(first, renderGenerated({ ...seed, credentials: [{ role: "cashier", code: "12345", pin: "2222" }] }))
    expect(next).toContain("owner-typed")
    expect(next).toContain("`12345`")
    expect(next).not.toContain("`10000`")
  })
})
