import { describe, expect, it } from "vitest"

import { formatAmount, formatHours, formatPercent, formatQuantity, formatTenge } from "@/shared/lib/format"
import { describeStatus, STATUS_DICTIONARY } from "@/shared/lib/status-dictionary"

describe("formatTenge (L-22)", () => {
  it("uses thin-space groups, a no-break space before ₸ and no tiyn", () => {
    expect(formatTenge(1279652.3)).toBe("1 279 652 ₸")
    expect(formatTenge(0)).toBe("0 ₸")
    expect(formatTenge(999)).toBe("999 ₸")
  })

  it("uses a real minus sign and an optional plus", () => {
    expect(formatTenge(-500)).toBe("−500 ₸")
    expect(formatTenge(300, { explicitPlus: true })).toBe("+300 ₸")
    expect(formatTenge(-0.4)).toBe("0 ₸")
  })

  it("formats amounts, quantities, hours and percents", () => {
    expect(formatAmount(-12500)).toBe("−12 500")
    expect(formatQuantity(2.5, "kg")).toBe("2,5 кг")
    expect(formatQuantity(1200, "pcs")).toBe("1 200 шт")
    expect(formatQuantity(0.125)).toBe("0,125")
    expect(formatHours(7.5)).toBe("7 ч 30 мин")
    expect(formatHours(0.25)).toBe("15 мин")
    expect(formatHours(12)).toBe("12 ч")
    expect(formatHours(0)).toBe("0 ч")
    expect(formatPercent(12.5)).toBe("12,5 %")
    expect(formatPercent(15)).toBe("15 %")
  })
})

describe("status dictionary (L-9)", () => {
  it("gives every status a Russian label and a tone", () => {
    for (const [domain, entries] of Object.entries(STATUS_DICTIONARY)) {
      for (const [value, entry] of Object.entries(entries)) {
        expect(entry.label, `${domain}:${value}`).toMatch(/[А-Яа-яЁё]/)
        expect(["neutral", "success", "warning", "danger", "danger-muted", "info"]).toContain(entry.tone)
      }
    }
  })

  it("covers every order and kitchen status the backend can return", () => {
    for (const status of ["draft", "held", "paid", "cancelled", "partially_refunded", "refunded"]) expect(describeStatus("order", status).known).toBe(true)
    for (const status of ["queued", "preparing", "ready", "completed"]) expect(describeStatus("kitchen", status).known).toBe(true)
  })

  it("maps iiko-style upper-case values and never shows an unknown raw value", () => {
    expect(describeStatus("document", "PUBLISHED").label).toBe("Опубликовано")
    expect(describeStatus("document", "PENDING_APPROVAL").label).toBe("На согласовании")
    expect(describeStatus("document", "WEIRD")).toEqual({ label: "Другой статус", tone: "neutral", known: false })
    expect(describeStatus("order", "unknown_value").label).toBe("Другой статус")
  })

  it("tells held, refunded and paid checks apart by tone (day theme critique)", () => {
    expect(describeStatus("order", "held").tone).toBe("warning")
    expect(describeStatus("order", "refunded").tone).toBe("danger-muted")
    expect(describeStatus("order", "partially_refunded").tone).toBe("danger-muted")
    expect(describeStatus("order", "paid").tone).toBe("success")
    expect(describeStatus("kitchen", "cancelled")).toMatchObject({ label: "Отменён", known: true })
  })
})
