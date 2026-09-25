import { describe, expect, it } from "vitest"

import { filterReports, REPORT_CATALOG } from "@/office/features/reports/model/catalog"
import { CSV_BOM, csvCell, exportFileName, toCsv, type ExportableResult } from "@/office/features/reports/model/export"
import { formatBusinessDay, formatReportValue } from "@/office/features/reports/model/format"
import { defaultPeriod, periodError, readFilters, readView, writeFilters } from "@/office/features/reports/model/url-state"

// W1-RPT-03/04: URL state of the report filters, unit formatting, catalog search, CSV export.

const plain = (value: string) => value.replace(/[\u2009\u00a0]/g, " ")

const NOW = Date.parse("2026-09-24T09:00:00Z") // 14:00 in Almaty

describe("report filters ↔ query string", () => {
  it("defaults to the last 7 days (Almaty) and keeps the default period out of the URL", () => {
    expect(defaultPeriod(NOW)).toEqual({ dateFrom: "2026-09-18", dateTo: "2026-09-24" })
    const filters = readFilters(new URLSearchParams(), NOW)
    expect(filters).toEqual({ dateFrom: "2026-09-18", dateTo: "2026-09-24", restaurantExternalIds: [], search: "" })
    expect(writeFilters(new URLSearchParams(), filters, NOW).toString()).toBe("")
  })

  it("round-trips period, restaurants and search, keeping other params", () => {
    const filters = { dateFrom: "2026-09-01", dateTo: "2026-09-30", restaurantExternalIds: ["almaty", "astana"], search: "Бешбармак" }
    const params = writeFilters(new URLSearchParams("view=summary"), filters, NOW)
    expect(params.get("view")).toBe("summary")
    expect(params.get("restaurants")).toBe("almaty,astana")
    expect(readFilters(params, NOW)).toEqual(filters)
  })

  it("ignores broken dates and validates the period like the server (366 days at most)", () => {
    expect(readFilters(new URLSearchParams("from=2026-13-40&to=x"), NOW).dateFrom).toBe("2026-09-18")
    expect(periodError({ dateFrom: "2026-09-10", dateTo: "2026-09-01" })).toMatch(/позже/)
    expect(periodError({ dateFrom: "2025-01-01", dateTo: "2026-01-02" })).toMatch(/года/)
    expect(periodError({ dateFrom: "2025-01-01", dateTo: "2026-01-01" })).toBeNull()
    expect(readView(new URLSearchParams("view=shifts"), undefined)).toBe("shifts")
    expect(readView(new URLSearchParams("view=shifts"), "sales-01")).toBe("catalog")
  })
})

describe("report value formatting", () => {
  it("money without tiyn, real minus, hours, percent, dates", () => {
    expect(plain(formatReportValue(1279652.4, "money"))).toBe("1 279 652 ₸")
    expect(plain(formatReportValue(-1500, "money"))).toBe("−1 500 ₸")
    expect(plain(formatReportValue(12.46, "percent"))).toBe("12,5 %")
    expect(plain(formatReportValue(7.5, "hours"))).toBe("7,5 ч")
    expect(plain(formatReportValue(2.5, "quantity"))).toBe("2,5")
    expect(plain(formatReportValue(1234, "count"))).toBe("1 234")
    expect(plain(formatReportValue("2026-09-24", "date"))).toBe("24.09.2026")
    expect(plain(formatReportValue(undefined, "money"))).toBe("—")
    expect(formatBusinessDay("2026-09-01")).toBe("01.09.2026")
  })
})

describe("catalog search", () => {
  it("filters by family and by title/description, case-insensitive", () => {
    expect(REPORT_CATALOG).toHaveLength(190)
    expect(filterReports(REPORT_CATALOG, { search: "", family: "menu" })).toHaveLength(15)
    const found = filterReports(REPORT_CATALOG, { search: "почасовая", family: "all" })
    expect(found.map((report) => report.id)).toEqual(["sales-02"])
    const ready = filterReports(REPORT_CATALOG, { search: "", family: "all", onlyReady: true, implemented: new Set(["sales-01", "stock-01"]) })
    expect(ready.map((report) => report.id)).toEqual(["sales-01", "stock-01"])
  })
})

const RESULT: ExportableResult = {
  generatedAt: Date.parse("2026-09-24T07:17:00Z"),
  sourceLabel: "Продажи кассы (предагрегат за день)",
  columns: [
    { key: "group", label: "Блюдо", unit: "text", align: "left" },
    { key: "quantity", label: "Количество", unit: "quantity", align: "right" },
    { key: "netAmount", label: "Выручка", unit: "money", align: "right" },
    { key: "marginPercent", label: "Маржа, %", unit: "percent", align: "right" },
  ],
  rows: [
    { key: "p1", cells: { group: 'Бешбармак "по-казахски"; большой', quantity: 3, netAmount: 12990.6, marginPercent: 61.5 } },
    { key: "p2", cells: { group: "Қазы-қарта", quantity: 1.5, netAmount: 1234567, marginPercent: 40 } },
    { key: "p3", cells: { group: "=HYPERLINK()", quantity: 1, netAmount: -500, marginPercent: 0 } },
  ],
  totals: { quantity: 5.5, netAmount: 1247057.6 },
  kpis: [{ key: "net", label: "Выручка", value: 1247057.6, unit: "money" }],
  truncated: false,
}

describe("CSV export (W1-RPT-04)", () => {
  const meta = { title: "Продажи по блюдам", dateFrom: "2026-09-01", dateTo: "2026-09-07", restaurants: ["Sandyq Алматы"] }
  const csv = toCsv(RESULT, meta)
  const lines = csv.slice(1).split("\r\n")

  it("starts with the UTF-8 BOM and uses «;» with a header block", () => {
    expect(csv.startsWith(CSV_BOM)).toBe(true)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(lines[0]).toBe("Отчёт;Продажи по блюдам")
    expect(lines[1]).toBe("Период;01.09.2026 — 07.09.2026")
    expect(lines[2]).toBe("Рестораны;Sandyq Алматы")
    expect(lines).toContain("Выручка;1247058")
  })

  it("columns as on screen, whole tenge, dot decimals, escaping, KZ letters, «Итого»", () => {
    const header = lines.indexOf("Блюдо;Количество;Выручка;Маржа, %")
    expect(header).toBeGreaterThan(0)
    expect(lines[header + 1]).toBe('"Бешбармак ""по-казахски""; большой";3;12991;61.5')
    expect(lines[header + 2]).toBe("Қазы-қарта;1.5;1234567;40")
    expect(lines[header + 3]).toBe("'=HYPERLINK();1;-500;0")
    expect(lines[header + 4]).toBe("Итого;5.5;1247058;")
  })

  it("quotes cells and names the file after the report and period", () => {
    expect(csvCell("a;b")).toBe('"a;b"')
    expect(csvCell("просто")).toBe("просто")
    expect(exportFileName({ title: "Выручка «по дням»", dateFrom: "2026-09-01", dateTo: "2026-09-07" }, "csv")).toBe("Выручка по дням_2026-09-01_2026-09-07.csv")
  })
})
