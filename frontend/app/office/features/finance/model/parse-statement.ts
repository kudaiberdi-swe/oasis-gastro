// Bank statement CSV in the browser (W3-FIN-11): decode (UTF-8 or Windows-1251), split (`;` or `,`),
// find the columns by a bank preset or by the mapping saved for the account, and turn every line into
// what convex/domains/finance/bankStatements importStatement takes. Nothing is sent until the preview is clean.
//
// The restaurants work with Kaspi Business, Halyk and other banks (owner decision Б-6). No sample statement of either
// bank has been seen yet: the Kaspi Business and Halyk presets below guess the column names and are marked
// «формат не проверен на образце» (`verified: false`) until a real file confirms them; any other bank uses
// the manual mapping, saved per bank account.

export type StatementField = "date" | "number" | "amount" | "debit" | "credit" | "direction" | "counterparty" | "bin" | "purpose"
export type AmountMode = "signed" | "direction" | "debit-credit"
export type Encoding = "auto" | "utf-8" | "windows-1251"
export type Delimiter = "auto" | ";" | ","

export type MappingColumn = { field: StatementField; header?: string; index?: number; aliases?: string[] }

export interface StatementMapping {
  bank: string
  encoding: Encoding
  delimiter: Delimiter
  amountMode: AmountMode
  hasHeader: boolean
  columns: MappingColumn[]
  /** Values of the direction column meaning «приход», comma-separated (direction mode). */
  incomingValues?: string
}

export interface BankPreset {
  id: string
  label: string
  /** false — the column names are a guess, no sample file of this bank has been checked. */
  verified: boolean
  mapping: StatementMapping
}

export const UNVERIFIED_NOTE = "формат не проверен на образце"

export const FIELD_LABELS: Record<StatementField, string> = {
  date: "Дата",
  number: "Номер документа",
  amount: "Сумма",
  debit: "Дебет (расход)",
  credit: "Кредит (приход)",
  direction: "Направление",
  counterparty: "Контрагент",
  bin: "БИН / ИИН",
  purpose: "Назначение",
}

export const AMOUNT_MODE_LABELS: Record<AmountMode, string> = { signed: "Сумма со знаком", direction: "Сумма и направление", "debit-credit": "Дебет и кредит" }

/** The fields a mapping needs for its amount mode (the rest are optional). */
export function requiredFields(mode: AmountMode): StatementField[] {
  return ["date", "counterparty", "purpose", ...(mode === "debit-credit" ? (["debit", "credit"] as const) : (["amount"] as const)), ...(mode === "direction" ? (["direction"] as const) : [])]
}

/** Fields shown in the manual mapping, in form order. */
export function mappingFields(mode: AmountMode): StatementField[] {
  const amount: StatementField[] = mode === "debit-credit" ? ["debit", "credit"] : mode === "direction" ? ["amount", "direction"] : ["amount"]
  return ["date", "number", ...amount, "counterparty", "bin", "purpose"]
}

export const DEFAULT_INCOMING = "incoming, приход, поступление, кредит, кт, cr, c, +"
const OUTGOING_VALUES = ["outgoing", "расход", "списание", "дебет", "дт", "dr", "d", "-"]

export const BANK_PRESETS: BankPreset[] = [
  {
    id: "sandyq",
    label: "Формат по умолчанию (как в подсказке)",
    verified: true,
    mapping: {
      bank: "sandyq",
      encoding: "auto",
      delimiter: ";",
      amountMode: "direction",
      hasHeader: false,
      columns: [
        { field: "date", index: 0 },
        { field: "number", index: 1 },
        { field: "counterparty", index: 2 },
        { field: "bin", index: 3 },
        { field: "purpose", index: 4 },
        { field: "amount", index: 5 },
        { field: "direction", index: 6 },
      ],
      incomingValues: "incoming, приход",
    },
  },
  {
    // Kaspi Business «Выписка по счёту» — UNVERIFIED: the column names are an assumption until a sample file arrives (Б-6).
    id: "kaspi-business",
    label: `Kaspi Business — ${UNVERIFIED_NOTE}`,
    verified: false,
    mapping: {
      bank: "kaspi-business",
      encoding: "auto",
      delimiter: "auto",
      amountMode: "debit-credit",
      hasHeader: true,
      columns: [
        { field: "date", aliases: ["дата операции", "дата", "дата документа", "дата проводки"] },
        { field: "number", aliases: ["номер документа", "№ документа", "номер", "№"] },
        { field: "debit", aliases: ["расход", "дебет", "списание", "сумма списания"] },
        { field: "credit", aliases: ["приход", "кредит", "поступление", "сумма поступления"] },
        { field: "counterparty", aliases: ["контрагент", "наименование контрагента", "получатель / отправитель", "отправитель / получатель", "корреспондент"] },
        { field: "bin", aliases: ["бин/иин", "бин / иин", "иин/бин", "бин", "иин", "бин/иин контрагента"] },
        { field: "purpose", aliases: ["назначение платежа", "назначение", "детали платежа", "описание"] },
      ],
    },
  },
  {
    // Halyk (Onlinebank для бизнеса) — UNVERIFIED: the column names are an assumption until a sample file arrives (Б-6).
    id: "halyk",
    label: `Halyk — ${UNVERIFIED_NOTE}`,
    verified: false,
    mapping: {
      bank: "halyk",
      encoding: "auto",
      delimiter: "auto",
      amountMode: "debit-credit",
      hasHeader: true,
      columns: [
        { field: "date", aliases: ["дата", "дата операции", "дата валютирования", "дата документа"] },
        { field: "number", aliases: ["№ документа", "номер документа", "№ док.", "номер"] },
        { field: "debit", aliases: ["дебет", "обороты по дебету", "сумма по дебету", "расход"] },
        { field: "credit", aliases: ["кредит", "обороты по кредиту", "сумма по кредиту", "приход"] },
        { field: "counterparty", aliases: ["корреспондент", "наименование корреспондента", "контрагент", "наименование бенефициара/отправителя"] },
        { field: "bin", aliases: ["бин/иин корреспондента", "бин/иин", "иин/бин", "бин", "иин"] },
        { field: "purpose", aliases: ["назначение платежа", "назначение", "детали платежа"] },
      ],
    },
  },
  {
    id: "manual",
    label: "Другой банк — сопоставить колонки",
    verified: true,
    mapping: { bank: "manual", encoding: "auto", delimiter: "auto", amountMode: "debit-credit", hasHeader: true, columns: [] },
  },
]

export const presetById = (id: string) => BANK_PRESETS.find((preset) => preset.id === id)

// ── Decoding and splitting ──────────────────────────────────────────────────

/** UTF-8 (with or without BOM) or Windows-1251; «auto» takes UTF-8 when the bytes are valid UTF-8. */
export function decodeStatement(bytes: Uint8Array, encoding: Encoding): { text: string; encoding: "utf-8" | "windows-1251" } {
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  if (encoding === "windows-1251") return { text: new TextDecoder("windows-1251").decode(bytes), encoding }
  if (encoding === "utf-8" || bom) return { text: new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, ""), encoding: "utf-8" }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" }
  } catch {
    return { text: new TextDecoder("windows-1251").decode(bytes), encoding: "windows-1251" }
  }
}

/** Splits CSV text: quoted cells (with "" and line breaks inside), CRLF or LF, empty lines dropped. */
export function splitCsv(text: string, delimiter: ";" | ","): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  const source = text.replace(/^﻿/, "")
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (char === '"') quoted = false
      else cell += char
      continue
    }
    if (char === '"' && cell.trim() === "") {
      quoted = true
      cell = ""
    } else if (char === delimiter) {
      row.push(cell)
      cell = ""
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1
      row.push(cell)
      if (row.some((value) => value.trim() !== "")) rows.push(row.map((value) => value.trim()))
      row = []
      cell = ""
    } else cell += char
  }
  row.push(cell)
  if (row.some((value) => value.trim() !== "")) rows.push(row.map((value) => value.trim()))
  return rows
}

/** `;` unless the first lines have more `,` outside quotes (a decimal comma inside quotes does not count). */
export function detectDelimiter(text: string): ";" | "," {
  const sample = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 10).join("\n")
  const count = (delimiter: string) => sample.replace(/"[^"]*"/g, "").split(delimiter).length - 1
  return count(",") > count(";") ? "," : ";"
}

export function readTable(text: string, delimiter: Delimiter) {
  const used = delimiter === "auto" ? detectDelimiter(text) : delimiter
  return { delimiter: used, rows: splitCsv(text, used) }
}

const normalizeHeader = (value: string) => value.toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/["«»]/g, "").replace(/\s+/g, " ").trim()

/** The header of a file without a known mapping: the first line (of the first 30) with the most filled cells. */
export function guessHeaderRow(rows: string[][]) {
  const head = rows.slice(0, 30)
  const filled = head.map((row) => row.filter((cell) => cell !== "").length)
  const most = Math.max(0, ...filled)
  const index = filled.findIndex((count) => count >= Math.max(2, most - 1))
  return index < 0 ? null : index
}

// ── Values ──────────────────────────────────────────────────────────────────

/** 20.09.2026, 20.09.26, 20/09/2026, 2026-09-20 (a time after the date is ignored) → 2026-09-20; null otherwise. */
export function parseStatementDate(value: string): string | null {
  const text = value.trim()
  let year: number
  let month: number
  let day: number
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/.exec(text)
  const local = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})(?:\s.*)?$/.exec(text)
  if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  else if (local) [day, month, year] = [Number(local[1]), Number(local[2]), Number(local[3].length === 2 ? `20${local[3]}` : local[3])]
  else return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date.toISOString().slice(0, 10)
}

/**
 * "1 234,56", "1 234.56", "1,234.56", "-1234,5", "(700)", "12 000 ₸" → a number (tiyn kept); "" → 0; null when
 * it is not a number. With both separators the last one is the decimal one; a lone comma is decimal.
 */
export function parseStatementAmount(value: string): number | null {
  let text = value.replace(/[\s  ]/g, "").replace(/(₸|kzt|тг\.?)$/i, "")
  if (text === "") return 0
  let negative = false
  if (/^\(.*\)$/.test(text)) {
    negative = true
    text = text.slice(1, -1)
  }
  if (text.startsWith("-")) {
    negative = !negative
    text = text.slice(1)
  } else if (text.startsWith("+")) text = text.slice(1)
  const comma = text.lastIndexOf(",")
  const dot = text.lastIndexOf(".")
  if (comma >= 0 && dot >= 0) text = comma > dot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "")
  else if (comma >= 0) text = text.replace(",", ".")
  if (!/^\d+(\.\d+)?$/.test(text)) return null
  const number = Number(text)
  return negative ? -number : number
}

/** Whole tenge (money in the office is whole tenge; the bank's tiyn are rounded). */
const toTenge = (value: number) => Math.round(Math.abs(value))

/** The 12-digit BIN / IIN in a cell ("БИН 123456789012" too); "" when there is none. */
export function parseBin(value: string) {
  return /\d{12}/.exec(value.replace(/\s+/g, ""))?.[0] ?? ""
}

// ── Lines ───────────────────────────────────────────────────────────────────

export type StatementRow = { date: string; number: string; amount: number; direction: "incoming" | "outgoing"; counterparty: string; bin: string; purpose: string; occurrence: number }

export interface ParsedStatement {
  rows: StatementRow[]
  /** 1-based line of the file and what is wrong with it. */
  errors: { line: number; message: string }[]
  /** Lines without a date — preamble, totals, blank amounts. */
  skipped: number
  /** Problems of the whole file (a column is missing). */
  problems: string[]
  header: string[] | null
  delimiter: ";" | ","
  columns: Partial<Record<StatementField, number>>
}

/** Column index of each field: the header name (or a preset's aliases) first, then the saved position. */
function resolveColumns(mapping: StatementMapping, header: string[] | null) {
  const normalized = header?.map(normalizeHeader) ?? []
  const result: Partial<Record<StatementField, number>> = {}
  for (const column of mapping.columns) {
    const names = [...(column.header ? [column.header] : []), ...(column.aliases ?? [])].map(normalizeHeader)
    const byName = names.map((name) => normalized.indexOf(name)).find((index) => index >= 0)
    if (byName !== undefined) result[column.field] = byName
    else if (column.index !== undefined && (!header || column.index < header.length)) result[column.field] = column.index
  }
  return result
}

/** The header line: the first (of 30) that has the date column's name, else the best guess. */
function findHeader(rows: string[][], mapping: StatementMapping) {
  const date = mapping.columns.find((column) => column.field === "date")
  const names = [...(date?.header ? [date.header] : []), ...(date?.aliases ?? [])].map(normalizeHeader)
  if (names.length) {
    const index = rows.slice(0, 30).findIndex((row) => row.some((cell) => names.includes(normalizeHeader(cell))))
    if (index >= 0) return index
  }
  return guessHeaderRow(rows)
}

/** Every line of the statement by the mapping; identical lines of the file get occurrence 0, 1, … in file order. */
export function parseStatement(text: string, mapping: StatementMapping): ParsedStatement {
  const table = readTable(text, mapping.delimiter)
  const headerIndex = mapping.hasHeader ? findHeader(table.rows, mapping) : null
  const header = headerIndex === null ? null : table.rows[headerIndex]
  const columns = resolveColumns(mapping, header)
  const result: ParsedStatement = { rows: [], errors: [], skipped: 0, problems: [], header, delimiter: table.delimiter, columns }
  if (mapping.hasHeader && headerIndex === null) result.problems.push("Не найдена строка с заголовками колонок")
  const missing = requiredFields(mapping.amountMode).filter((field) => columns[field] === undefined)
  if (missing.length) result.problems.push(`Не найдены колонки: ${missing.map((field) => FIELD_LABELS[field]).join(", ")}`)
  if (result.problems.length) return result

  const incoming = (mapping.incomingValues ?? DEFAULT_INCOMING).split(",").map((value) => value.trim().toLocaleLowerCase("ru")).filter(Boolean)
  const cell = (row: string[], field: StatementField) => (columns[field] === undefined ? "" : (row[columns[field]!] ?? "").trim())
  const occurrences = new Map<string, number>()
  const start = headerIndex === null ? 0 : headerIndex + 1
  table.rows.slice(start).forEach((row, offset) => {
    const line = start + offset + 1
    const date = parseStatementDate(cell(row, "date"))
    if (!date) {
      result.skipped += 1
      return
    }
    let signed: number | null
    if (mapping.amountMode === "debit-credit") {
      const debit = parseStatementAmount(cell(row, "debit"))
      const credit = parseStatementAmount(cell(row, "credit"))
      if (debit === null || credit === null) signed = null
      else if (debit && credit) {
        result.errors.push({ line, message: "Заполнены и дебет, и кредит" })
        return
      } else signed = credit ? Math.abs(credit) : -Math.abs(debit)
    } else {
      const amount = parseStatementAmount(cell(row, "amount"))
      if (amount === null || mapping.amountMode === "signed") signed = amount
      else {
        const value = cell(row, "direction").toLocaleLowerCase("ru")
        if (incoming.includes(value)) signed = Math.abs(amount)
        else if (OUTGOING_VALUES.includes(value)) signed = -Math.abs(amount)
        else {
          result.errors.push({ line, message: `Непонятное направление «${cell(row, "direction")}»` })
          return
        }
      }
    }
    if (signed === null) {
      result.errors.push({ line, message: "Сумма — не число" })
      return
    }
    const amount = toTenge(signed)
    if (amount <= 0) {
      result.errors.push({ line, message: "Нулевая сумма" })
      return
    }
    const binCell = cell(row, "bin")
    const bin = parseBin(binCell)
    if (binCell && !bin && /\d/.test(binCell)) {
      result.errors.push({ line, message: `БИН / ИИН «${binCell}» — не 12 цифр` })
      return
    }
    const direction = signed > 0 ? ("incoming" as const) : ("outgoing" as const)
    const number = cell(row, "number")
    const key = [date, number, direction, amount, bin].join("|")
    const occurrence = occurrences.get(key) ?? 0
    occurrences.set(key, occurrence + 1)
    result.rows.push({ date, number, amount, direction, counterparty: cell(row, "counterparty"), bin, purpose: cell(row, "purpose"), occurrence })
  })
  return result
}

/** Totals of the preview: lines, receipts and payments. */
export function statementTotals(rows: StatementRow[]) {
  return rows.reduce((sum, row) => ({ count: sum.count + 1, incoming: sum.incoming + (row.direction === "incoming" ? row.amount : 0), outgoing: sum.outgoing + (row.direction === "outgoing" ? row.amount : 0) }), { count: 0, incoming: 0, outgoing: 0 })
}

/** The server takes at most 500 lines per call. */
export function chunkRows<T>(rows: T[], size = 500): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size))
  return chunks
}

/** What is saved per bank account: the resolved columns (header name + position), without preset aliases. */
export function mappingToSave(mapping: StatementMapping, parsed: Pick<ParsedStatement, "header" | "columns">) {
  const columns = (Object.entries(parsed.columns) as [StatementField, number][]).map(([field, index]) => ({ field, index, ...(parsed.header?.[index] ? { header: parsed.header[index] } : {}) }))
  return { bank: mapping.bank, encoding: mapping.encoding, delimiter: mapping.delimiter, amountMode: mapping.amountMode, hasHeader: mapping.hasHeader, columns, ...(mapping.incomingValues ? { incomingValues: mapping.incomingValues } : {}) }
}

export const normalizeIban = (value: string) => value.replace(/\s+/g, "").toUpperCase()
export const isIban = (value: string) => /^KZ\d{2}[A-Z0-9]{16}$/.test(normalizeIban(value))
