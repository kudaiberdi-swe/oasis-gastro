import { formatAlmatyDate } from "@/shared/lib/almaty-time"

import { createMockModuleApi } from "./mock-module-api"
import type { ModuleConfig } from "./module-config"

// Two reference configs that exercise the engine before real domain modules exist (W0-UI-03):
// a master module (Статьи ДДС) and a document module (Проводки), both on the in-memory adapter.

export type CashflowCategory = { id: string; code: string; name: string; direction: "inflow" | "outflow"; status: string }

export const cashflowCategoriesConfig: ModuleConfig<CashflowCategory> = {
  id: "cashflow-categories",
  entityLabel: "Статья ДДС",
  lifecycle: "master",
  statusOf: (row) => row.status,
  titleOf: (row) => row.name,
  metaOf: (row) => `${row.code} · ${row.direction === "inflow" ? "Поступление" : "Выбытие"}`,
  searchText: (row) => `${row.code} ${row.name}`,
  columns: [
    { key: "code", label: "Код", kind: "text", sortable: true },
    { key: "name", label: "Название", kind: "text", sortable: true },
    { key: "status", label: "Статус", kind: "status" },
  ],
  fields: [
    { key: "code", label: "Код", kind: "text", required: true, validate: (value) => (/^\d{3,6}$/.test(String(value)) ? null : "3–6 цифр") },
    { key: "name", label: "Название", kind: "text", required: true },
    {
      key: "direction",
      label: "Направление",
      kind: "select",
      required: true,
      options: [
        { value: "inflow", label: "Поступление" },
        { value: "outflow", label: "Выбытие" },
      ],
    },
    { key: "active", label: "Активна", kind: "checkbox" },
  ],
}

export const cashflowCategoriesApi = createMockModuleApi<CashflowCategory>({
  initial: [
    { id: "cf-1", code: "100", name: "Выручка ресторана", direction: "inflow", status: "active" },
    { id: "cf-2", code: "210", name: "Закупка продуктов", direction: "outflow", status: "active" },
    { id: "cf-3", code: "220", name: "Аренда", direction: "outflow", status: "active" },
    { id: "cf-4", code: "290", name: "Прочие расходы", direction: "outflow", status: "inactive" },
  ],
  search: (row) => `${row.code} ${row.name}`,
  create: (values, index) => ({
    id: `cf-new-${index}`,
    code: String(values.code),
    name: String(values.name),
    direction: values.direction === "inflow" ? "inflow" : "outflow",
    status: values.active === false ? "inactive" : "active",
  }),
  update: (row, values) => ({
    ...row,
    code: String(values.code ?? row.code),
    name: String(values.name ?? row.name),
    direction: values.direction === "inflow" ? "inflow" : values.direction === "outflow" ? "outflow" : row.direction,
    status: values.active === undefined ? row.status : values.active ? "active" : "inactive",
  }),
})

export const cashflowCategoryValues = (row: CashflowCategory | null) =>
  row ? { code: row.code, name: row.name, direction: row.direction, active: row.status === "active" } : { code: "", name: "", direction: "outflow", active: true }

export type Transaction = {
  id: string
  number: string
  date: number
  restaurant: string
  memo: string
  status: string
  lines: { id: string; account: string; debit: number; credit: number }[]
  hours?: number
}

const sum = (row: Transaction) => row.lines.reduce((total, line) => total + line.debit, 0)

export const transactionsConfig: ModuleConfig<Transaction> = {
  id: "transactions",
  entityLabel: "Проводка",
  lifecycle: "document",
  statusOf: (row) => row.status,
  titleOf: (row) => row.number,
  metaOf: (row) => `${row.restaurant} · ${formatAlmatyDate(row.date)}`,
  searchText: (row) => `${row.number} ${row.memo} ${row.restaurant}`,
  columns: [
    { key: "number", label: "Номер", kind: "text", sortable: true },
    { key: "date", label: "Дата", kind: "date", sortable: true },
    { key: "restaurant", label: "Ресторан", kind: "text" },
    { key: "memo", label: "Основание", kind: "text" },
    { key: "amount", label: "Сумма", kind: "money", value: sum, sortable: true },
    { key: "status", label: "Статус", kind: "status" },
  ],
  kpis: [
    { key: "total", label: "Сумма проводок", kind: "money", compute: (rows) => rows.reduce((total, row) => total + sum(row), 0) },
    { key: "count", label: "Строк", kind: "qty", compute: (rows) => rows.reduce((total, row) => total + row.lines.length, 0), unit: "pcs" },
  ],
  fields: [
    { key: "date", label: "Дата", kind: "date", required: true },
    {
      key: "restaurant",
      label: "Ресторан",
      kind: "select",
      required: true,
      options: [
        { value: "Ресторан Алматы", label: "Ресторан Алматы" },
        { value: "Ресторан Шымкент", label: "Ресторан Шымкент" },
        { value: "Ресторан Түркістан", label: "Ресторан Түркістан" },
      ],
    },
    { key: "memo", label: "Основание", kind: "textarea", required: true },
  ],
  lines: {
    tabs: [{ key: "entries", label: "Строки", rows: (record) => record.lines }],
    columns: [
      { key: "account", label: "Счёт", kind: "text" },
      { key: "debit", label: "Дебет", kind: "money" },
      { key: "credit", label: "Кредит", kind: "money" },
    ],
    total: { label: "Итого по документу", kind: "money", compute: sum },
  },
}

const DAY = 86_400_000
const base = Date.parse("2026-09-20T00:00:00+05:00")

export const transactionsApi = createMockModuleApi<Transaction>({
  initial: [
    {
      id: "tx-1",
      number: "ПР-000041",
      date: base,
      restaurant: "Ресторан Алматы",
      memo: "Выручка за смену Z-20260920-01-001",
      status: "posted",
      lines: [
        { id: "l1", account: "50.01 Касса", debit: 1_284_500, credit: 0 },
        { id: "l2", account: "90.01 Выручка", debit: 0, credit: 1_284_500 },
      ],
    },
    {
      id: "tx-2",
      number: "ПР-000042",
      date: base + DAY,
      restaurant: "Ресторан Шымкент",
      memo: "Оплата аренды за сентябрь",
      status: "draft",
      lines: [
        { id: "l1", account: "26 Общие расходы", debit: 850_000, credit: 0 },
        { id: "l2", account: "51 Расчётный счёт", debit: 0, credit: 850_000 },
      ],
    },
    {
      id: "tx-3",
      number: "ПР-000043",
      date: base + 2 * DAY,
      restaurant: "Ресторан Алматы",
      memo: "Ошибочная проводка",
      status: "reversed",
      lines: [{ id: "l1", account: "91 Прочие", debit: 12_000, credit: 0 }],
    },
  ],
  search: (row) => `${row.number} ${row.memo} ${row.restaurant}`,
  create: (values, index) => ({
    id: `tx-new-${index}`,
    number: `ПР-${String(40 + index).padStart(6, "0")}`,
    date: Number(values.date ?? Date.now()),
    restaurant: String(values.restaurant ?? ""),
    memo: String(values.memo ?? ""),
    status: "draft",
    lines: [],
  }),
  update: (row, values) => ({
    ...row,
    date: values.date === undefined ? row.date : Number(values.date),
    restaurant: values.restaurant === undefined ? row.restaurant : String(values.restaurant),
    memo: values.memo === undefined ? row.memo : String(values.memo),
    status: typeof values.status === "string" ? values.status : row.status,
  }),
})

export const transactionValues = (row: Transaction) => ({ date: row.date, restaurant: row.restaurant, memo: row.memo })
