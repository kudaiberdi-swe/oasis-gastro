import { strToU8, zipSync } from "fflate"

import type { ColumnUnit, ReportResult } from "./reportConfig"

// Report export (W1-RPT-04 → W2-RPT-06): one module for the office's download button and the scheduled
// mailings. Pure functions without DOM:
// - CSV: UTF-8 with BOM so Excel detects the encoding, «;» as the separator (the RU/KZ Excel list
//   separator), numbers without group separators and with a dot, money in whole tenge, an «Итого» row
//   and a header block;
// - XLSX: the same layout as a minimal SpreadsheetML workbook (inline strings), zipped with fflate.

export type ExportableResult = Pick<ReportResult, "columns" | "rows" | "totals" | "kpis" | "generatedAt" | "sourceLabel" | "truncated">

export type ExportMeta = {
  title: string
  dateFrom: string
  dateTo: string
  /** Names of the selected restaurants; empty means every restaurant in the user's scope. */
  restaurants: string[]
}

export const CSV_BOM = "﻿"
const SEPARATOR = ";"
const EOL = "\r\n"
const ALMATY_OFFSET_MS = 5 * 3_600_000

/** "2026-09-24" → "24.09.2026"; anything else is returned as is. */
export function formatBusinessDay(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : date
}

export function formatPeriod(dateFrom: string, dateTo: string) {
  return dateFrom === dateTo ? formatBusinessDay(dateFrom) : `${formatBusinessDay(dateFrom)} — ${formatBusinessDay(dateTo)}`
}

/** "24.09.2026, 12:17" in Almaty time (UTC+5, no DST) — without Intl, so it runs in Convex too. */
export function formatGeneratedAt(value: number) {
  const local = new Date(value + ALMATY_OFFSET_MS).toISOString()
  return `${formatBusinessDay(local.slice(0, 10))}, ${local.slice(11, 16)}`
}

/** Quotes a cell when it holds the separator, quotes or a line break; neutralises spreadsheet formulas. */
export function csvCell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** A cell value as a spreadsheet reads it: plain digits and a dot, whole tenge, ASCII minus. */
export function csvValue(value: number | string | null | undefined, unit: ColumnUnit) {
  if (value === null || value === undefined) return ""
  if (unit === "text") return csvCell(String(value))
  if (unit === "date") return typeof value === "string" ? formatBusinessDay(value) : String(value)
  const number = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(number)) return csvCell(String(value))
  if (unit === "money" || unit === "count") return String(Math.round(number))
  return String(Math.round(number * 1000) / 1000)
}

export function hasTotals(result: Pick<ReportResult, "columns" | "totals">) {
  return result.columns.some((column, index) => index > 0 && column.key in result.totals)
}

type Cell = { text: string } | { number: number }

/** The export as rows of typed cells: header block, KPIs, table, totals. CSV and XLSX both render it. */
function layout(result: ExportableResult, meta: ExportMeta): Cell[][] {
  const text = (value: string): Cell => ({ text: value })
  const value = (raw: number | string | null | undefined, unit: ColumnUnit): Cell => {
    if (raw === null || raw === undefined) return text("")
    if (unit === "text") return text(String(raw))
    if (unit === "date") return text(typeof raw === "string" ? formatBusinessDay(raw) : String(raw))
    const number = typeof raw === "number" ? raw : Number(raw)
    if (!Number.isFinite(number)) return text(String(raw))
    return { number: unit === "money" || unit === "count" ? Math.round(number) : Math.round(number * 1000) / 1000 }
  }
  const rows: Cell[][] = [
    [text("Отчёт"), text(meta.title)],
    [text("Период"), text(formatPeriod(meta.dateFrom, meta.dateTo))],
    [text("Рестораны"), text(meta.restaurants.length ? meta.restaurants.join(", ") : "Все рестораны в доступе")],
    [text("Сформировано"), text(formatGeneratedAt(result.generatedAt))],
    [text("Источник"), text(result.sourceLabel)],
  ]
  for (const kpi of result.kpis) rows.push([text(kpi.label), value(kpi.value, kpi.unit)])
  if (result.truncated) rows.push([text("Внимание"), text("Период слишком большой: выгружена только часть записей")])
  rows.push([])
  rows.push(result.columns.map((column) => text(column.label)))
  for (const row of result.rows) rows.push(result.columns.map((column) => value(row.cells[column.key], column.unit)))
  if (hasTotals(result)) rows.push(result.columns.map((column, index) => (index === 0 ? text("Итого") : column.key in result.totals ? value(result.totals[column.key], column.unit) : text(""))))
  return rows
}

export function toCsv(result: ExportableResult, meta: ExportMeta) {
  const lines = layout(result, meta).map((row) => row.map((cell) => ("number" in cell ? String(cell.number) : csvCell(cell.text))).join(SEPARATOR))
  return CSV_BOM + lines.join(EOL) + EOL
}

const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")

function columnName(index: number) {
  let name = ""
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  return name
}

/** A one-sheet workbook; cells starting with = are written as text, never as formulas. */
export function toXlsx(result: ExportableResult, meta: ExportMeta): Uint8Array {
  const sheetRows = layout(result, meta)
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, columnIndex) => {
          const ref = `${columnName(columnIndex)}${rowIndex + 1}`
          return "number" in cell ? `<c r="${ref}"><v>${cell.number}</v></c>` : cell.text ? `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(cell.text)}</t></is></c>` : ""
        })
        .join("")
      return `<row r="${rowIndex + 1}">${cells}</row>`
    })
    .join("")
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Отчёт" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`),
  }
  return zipSync(files, { level: 6 })
}

export const EXPORT_MIME = { csv: "text/csv;charset=utf-8", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } as const

/** "Выручка по дням_2026-09-01_2026-09-07.csv"; characters Windows forbids in names are dropped. */
export function exportFileName(meta: Pick<ExportMeta, "title" | "dateFrom" | "dateTo">, extension: "csv" | "xlsx") {
  const title = meta.title.replace(/[\\/:*?"<>|«»]/g, "").replace(/\s+/g, " ").trim() || "report"
  return `${title}_${meta.dateFrom}_${meta.dateTo}.${extension}`
}
