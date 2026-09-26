import { describe, expect, it } from "vitest"

import {
  BANK_PRESETS,
  chunkRows,
  decodeStatement,
  detectDelimiter,
  mappingToSave,
  parseStatement,
  parseStatementAmount,
  parseStatementDate,
  presetById,
  splitCsv,
  type StatementMapping,
} from "@/office/features/finance/model/parse-statement"
import { almatyMonth, budgetLinesArgs, budgetSaveArgs, calendarSaveArgs, formatMonth, monthGrid, shiftMonth, validateBudget, validateCalendar, type BudgetDraft, type CalendarDraft } from "@/office/features/finance/model/planning"

// W3-FIN-11/12/13 office models: the bank statement CSV parser, the month grid (Almaty) and the calendar / budget drafts.

const sandyq = presetById("sandyq")!.mapping
const manual = (overrides: Partial<StatementMapping>): StatementMapping => ({ ...presetById("manual")!.mapping, ...overrides })

/** Windows-1251 bytes of Cyrillic text (А–я, Ёё) and ASCII — enough for a statement. */
function cp1251(text: string) {
  return Uint8Array.from([...text].map((char) => {
    const code = char.charCodeAt(0)
    if (code < 0x80) return code
    if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0
    if (char === "Ё") return 0xa8
    if (char === "ё") return 0xb8
    if (char === "№") return 0xb9
    throw new Error(`no cp1251 byte for ${char}`)
  }))
}

describe("bank statement CSV (W3-FIN-11)", () => {
  it("the Sandyq format: `;`, BOM, ISO and local dates, direction words, amounts with spaces and a decimal comma", () => {
    const text = "﻿2026-09-21;11;ТОО Клининг;123456789013;Оплата клининга;50 000;outgoing\r\n21.09.2026;12;ТОО Банкет;123456789014;Предоплата;120 000,50;incoming\n\n2026-09-22;;Банк;;Комиссия;700;outgoing\n"
    const parsed = parseStatement(text, sandyq)
    expect(parsed.problems).toEqual([])
    expect(parsed.errors).toEqual([])
    expect(parsed.rows).toEqual([
      { date: "2026-09-21", number: "11", amount: 50_000, direction: "outgoing", counterparty: "ТОО Клининг", bin: "123456789013", purpose: "Оплата клининга", occurrence: 0 },
      // Tiyn are rounded: money in the office is whole tenge.
      { date: "2026-09-21", number: "12", amount: 120_001, direction: "incoming", counterparty: "ТОО Банкет", bin: "123456789014", purpose: "Предоплата", occurrence: 0 },
      { date: "2026-09-22", number: "", amount: 700, direction: "outgoing", counterparty: "Банк", bin: "", purpose: "Комиссия", occurrence: 0 },
    ])
  })

  it("dates and amounts in every notation; bad ones are null", () => {
    expect(["2026-09-20", "20.09.2026", "20.09.26", "20/09/2026", "20.09.2026 10:15:00", "2026-09-20T10:00"].map(parseStatementDate)).toEqual(Array(6).fill("2026-09-20"))
    expect(["31.02.2026", "2026-13-01", "вчера", ""].map(parseStatementDate)).toEqual([null, null, null, null])
    expect(["1 234,56", "1 234.56", "1,234.56", "1.234,56", "-1234,5", "(700)", "12 000 ₸", "+5", "", "12a"].map(parseStatementAmount)).toEqual([1234.56, 1234.56, 1234.56, 1234.56, -1234.5, -700, 12_000, 5, 0, null])
  })

  it("a signed amount column: negative is outgoing; identical lines get occurrence 0, 1 in file order", () => {
    const mapping = manual({ delimiter: ";", amountMode: "signed", hasHeader: true, columns: [{ field: "date", header: "Дата" }, { field: "amount", header: "Сумма" }, { field: "counterparty", header: "Контрагент" }, { field: "purpose", header: "Назначение" }, { field: "bin", header: "БИН" }] })
    const parsed = parseStatement("Дата;Сумма;Контрагент;БИН;Назначение\n20.09.2026;-700;Банк;;Комиссия\n20.09.2026;-700;Банк;;Комиссия\n21.09.2026;15000;ТОО;БИН 123456789013;Возврат\n", mapping)
    expect(parsed.rows.map((row) => [row.direction, row.amount, row.bin, row.occurrence])).toEqual([
      ["outgoing", 700, "", 0],
      ["outgoing", 700, "", 1],
      ["incoming", 15_000, "123456789013", 0],
    ])
  })

  it("a Windows-1251 file with `,` and quoted cells; «auto» tells it from UTF-8", () => {
    const text = 'Дата,Дебет,Кредит,Корреспондент,БИН/ИИН корреспондента,Назначение платежа\r\n20.09.2026,"1 500,00",,"ТОО ""Мясо""",123456789013,"Оплата, счёт 5"\r\n'
    const bytes = cp1251(text)
    const decoded = decodeStatement(bytes, "auto")
    expect(decoded.encoding).toBe("windows-1251")
    expect(decoded.text).toBe(text)
    expect(decodeStatement(new TextEncoder().encode(text), "auto").encoding).toBe("utf-8")
    expect(detectDelimiter(decoded.text)).toBe(",")
    const parsed = parseStatement(decoded.text, presetById("halyk")!.mapping)
    expect(parsed.errors).toEqual([])
    expect(parsed.rows).toEqual([{ date: "2026-09-20", number: "", amount: 1500, direction: "outgoing", counterparty: 'ТОО "Мясо"', bin: "123456789013", purpose: "Оплата, счёт 5", occurrence: 0 }])
  })

  it("a preset finds its header below the bank's preamble and skips totals; wrong lines are reported with their line number", () => {
    const text = [
      "Выписка по счёту KZ12345678901234567A",
      "Период: 01.09.2026 — 30.09.2026",
      "Дата операции;Номер документа;Контрагент;БИН/ИИН;Назначение платежа;Расход;Приход",
      "20.09.2026;1;ТОО Клининг;123456789013;Оплата;50 000;",
      "21.09.2026;2;ТОО Банкет;123456789014;Предоплата;;90 000",
      "22.09.2026;3;ТОО;12345;Оплата;100;",
      "23.09.2026;4;ТОО;123456789013;Оплата;100;200",
      "Итого обороты;;;;;50 100;90 000",
    ].join("\n")
    const parsed = parseStatement(text, presetById("kaspi-business")!.mapping)
    expect(parsed.header?.[0]).toBe("Дата операции")
    expect(parsed.rows.map((row) => [row.number, row.direction, row.amount])).toEqual([
      ["1", "outgoing", 50_000],
      ["2", "incoming", 90_000],
    ])
    expect(parsed.errors).toEqual([
      { line: 6, message: "БИН / ИИН «12345» — не 12 цифр" },
      { line: 7, message: "Заполнены и дебет, и кредит" },
    ])
    expect(parsed.skipped).toBe(1)
    // Saved per account: header names and positions, no preset aliases.
    expect(mappingToSave(presetById("kaspi-business")!.mapping, parsed).columns).toContainEqual({ field: "debit", index: 5, header: "Расход" })
  })

  it("a missing column is a problem of the whole file; the Kaspi Business and Halyk presets are marked unverified", () => {
    const parsed = parseStatement("Дата;Сумма\n20.09.2026;100\n", presetById("halyk")!.mapping)
    expect(parsed.problems[0]).toBe("Не найдены колонки: Контрагент, Назначение, Дебет (расход), Кредит (приход)")
    expect(BANK_PRESETS.filter((preset) => !preset.verified).map((preset) => [preset.id, preset.label])).toEqual([
      ["kaspi-business", "Kaspi Business — формат не проверен на образце"],
      ["halyk", "Halyk — формат не проверен на образце"],
    ])
    const direction = parseStatement("2026-09-20;1;ТОО;;Оплата;100;туда\n", sandyq)
    expect(direction.errors).toEqual([{ line: 1, message: "Непонятное направление «туда»" }])
  })

  it("quotes with line breaks and doubled quotes; 501 lines go in two calls", () => {
    expect(splitCsv('a;"b\nc";"d ""e"""\n', ";")).toEqual([["a", "b\nc", 'd "e"']])
    expect(chunkRows(Array.from({ length: 501 }, (_, index) => index)).map((chunk) => chunk.length)).toEqual([500, 1])
  })
})

describe("month grid and drafts (W3-FIN-12/13)", () => {
  it("weeks start on Monday; the month is the Almaty one", () => {
    const september = monthGrid("2026-09")
    expect(september[0]).toEqual([null, "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"])
    expect(september.at(-1)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", null, null, null, null])
    expect(september).toHaveLength(5)
    expect(monthGrid("2026-02").flat().filter(Boolean)).toHaveLength(28)
    // 30.09 20:00 UTC is 01.10 01:00 in Almaty (UTC+5).
    expect(almatyMonth(Date.parse("2026-09-30T20:00:00Z"))).toBe("2026-10")
    expect(almatyMonth(Date.parse("2026-09-30T18:59:00Z"))).toBe("2026-09")
    expect([shiftMonth("2026-12", 1), shiftMonth("2026-01", -1), formatMonth("2026-09")]).toEqual(["2027-01", "2025-12", "Сентябрь 2026"])
  })

  it("a calendar record needs a name, a planned date and an amount; the data keeps the flow, priority and basis", () => {
    const draft: CalendarDraft = { name: " Аренда ", restaurantExternalId: "r1", direction: "outgoing", plannedAt: "2026-10-05", amount: 400_000, priority: "required", counterpartyExternalId: "cp-1", cashflowCategoryExternalId: "", obligationExternalId: "ob-1", sourceDocument: "Договор 7", comment: "" }
    expect(validateCalendar({ ...draft, name: "", plannedAt: "", amount: null })).toEqual({ name: "Укажите, что планируется", plannedAt: "Укажите плановую дату", amount: "Сумма должна быть больше нуля" })
    expect(calendarSaveArgs(draft, null)).toMatchObject({ moduleId: "payment-calendar", name: "Аренда", amount: 400_000, counterpartyExternalId: "cp-1", data: { direction: "outgoing", plannedAt: "2026-10-05", priority: "required", obligationExternalId: "ob-1", sourceDocument: "Договор 7" } })
  })

  it("a budget: lines by account or category, no repeats, the amount is their sum", () => {
    const draft: BudgetDraft = {
      name: "Октябрь",
      restaurantExternalId: "r1",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      comment: "",
      lines: [
        { key: "a", kind: "account", articleExternalId: "acc-7210", planAmount: 100_000 },
        { key: "b", kind: "category", articleExternalId: "cat-1", planAmount: 50_000 },
      ],
    }
    expect(validateBudget(draft)).toEqual({})
    expect(validateBudget({ ...draft, periodEnd: "2026-09-30", lines: [] })).toEqual({ periodEnd: "Конец периода раньше начала", lines: "Добавьте хотя бы одну строку" })
    expect(validateBudget({ ...draft, lines: [draft.lines[0], { ...draft.lines[0], key: "c" }] }).lines).toBe("Статья повторяется в бюджете")
    expect(budgetSaveArgs(draft, null)).toMatchObject({ moduleId: "budgets", businessDate: "2026-10-01", amount: 150_000, data: { periodStart: "2026-10-01", periodEnd: "2026-10-31" } })
    expect(budgetLinesArgs(draft)).toEqual([
      { accountExternalId: "acc-7210", planAmount: 100_000 },
      { cashflowCategoryExternalId: "cat-1", planAmount: 50_000 },
    ])
  })
})
