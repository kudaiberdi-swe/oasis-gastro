import type { ComponentType, ReactNode } from "react"

import type { StatusDomain } from "@/shared/lib/status-dictionary"

/** How a module's records move through states; decides the status tabs (OFFICE-DESIGN §3.5). */
export type Lifecycle = "master" | "publish" | "approval" | "document"

/** Cell and field kinds. Every column declares its own kind and unit — there is no shared "Сумма / значение" column (L-10). */
export type ValueKind = "text" | "money" | "hours" | "percent" | "qty" | "date" | "datetime" | "status" | "ref" | "boolean"

export type ColumnDef<Row> = {
  key: string
  label: string
  kind: ValueKind
  /** Unit for qty ("kg", "pcs", …). */
  unit?: string
  /** Reads the value; defaults to row[key]. */
  value?: (row: Row) => unknown
  /** For kind "ref": the display text of the referenced record. */
  display?: (row: Row) => ReactNode
  sortable?: boolean
  statusDomain?: StatusDomain
}

export type KpiDef<Row> = {
  key: string
  label: string
  kind: Exclude<ValueKind, "status" | "ref" | "boolean">
  /** Computed from the loaded rows; KPIs belong to the module, never a shared block (L-11). */
  compute: (rows: Row[]) => number
  unit?: string
}

export type FieldKind = "text" | "number" | "money" | "date" | "select" | "checkbox" | "textarea"

export type DomainField = {
  key: string
  label: string
  kind: FieldKind
  required?: boolean
  /** select: static options, or a hook that loads them (another module's records). */
  options?: { value: string; label: string }[]
  hint?: string
  /** Two-column layout on wide screens: "full" spans both. */
  span?: "half" | "full"
  validate?: (value: unknown, values: Record<string, unknown>) => string | null
}

export type ModuleConfig<Row> = {
  id: string
  /** Singular name for buttons and titles: «Статья ДДС», «Проводка». */
  entityLabel: string
  lifecycle: Lifecycle
  columns: ColumnDef<Row>[]
  /** Status value of a row, for tabs and the status column. */
  statusOf?: (row: Row) => string
  statusDomain?: StatusDomain
  fields: DomainField[]
  kpis?: KpiDef<Row>[]
  /** Optional panel above the search (forecast, CSV import, …). */
  topPanel?: ComponentType
  /** Title of a record in lists and the editor header. */
  titleOf: (row: Row) => string
  /** Second line in master/settings lists. */
  metaOf?: (row: Row) => string
  /** Search text of a row (client-side filtering for mocks; real modules search on the server). */
  searchText?: (row: Row) => string
  /** document/approval editors: line tables. */
  lines?: LinesConfig<Row>
}

export type LinesConfig<Row> = {
  tabs: { key: string; label: string; rows: (record: Row) => Record<string, unknown>[] }[]
  columns: ColumnDef<Record<string, unknown>>[]
  /** Total under the table, e.g. «Итого по документу». */
  total?: { label: string; kind: "money" | "qty"; compute: (record: Row) => number }
}

export type StatusTab = { key: string; label: string; statuses: string[] | null }

/** Tabs per lifecycle: master Все/Активные/Неактивные, publish +Черновики/Опубликованные, approval, document. */
export function statusTabs(lifecycle: Lifecycle): StatusTab[] {
  switch (lifecycle) {
    case "master":
      return [
        { key: "all", label: "Все", statuses: null },
        { key: "active", label: "Активные", statuses: ["active"] },
        { key: "inactive", label: "Неактивные", statuses: ["inactive"] },
      ]
    case "publish":
      return [
        { key: "all", label: "Все", statuses: null },
        { key: "draft", label: "Черновики", statuses: ["draft"] },
        { key: "published", label: "Опубликованные", statuses: ["published"] },
        { key: "inactive", label: "Неактивные", statuses: ["inactive", "expired"] },
      ]
    case "approval":
      return [
        { key: "all", label: "Все", statuses: null },
        { key: "draft", label: "Черновики", statuses: ["draft"] },
        { key: "pending", label: "На согласовании", statuses: ["pending-approval"] },
        { key: "approved", label: "Согласованные", statuses: ["approved"] },
        { key: "posted", label: "Проведённые", statuses: ["posted"] },
      ]
    case "document":
      return [
        { key: "all", label: "Все", statuses: null },
        { key: "draft", label: "Черновики", statuses: ["draft"] },
        { key: "posted", label: "Проведённые", statuses: ["posted"] },
        { key: "reversed", label: "Сторно", statuses: ["reversed"] },
      ]
  }
}

/** Posted and reversed documents are read-only; changes go through a reversal (L-18). */
export function isReadOnlyStatus(lifecycle: Lifecycle, status: string | undefined) {
  if (lifecycle !== "document" && lifecycle !== "approval") return false
  return status === "posted" || status === "reversed"
}
