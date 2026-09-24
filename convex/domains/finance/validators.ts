import { v } from "convex/values"

import type { Lifecycle } from "../../lib/lifecycles"

// Finance modules stored in financeRecords (W1-FIN-01). The chart of accounts lives in the accounts
// table (W1-PLT-01) and «Задолженность» is computed from records, so neither is a record module.
export const FINANCE_MODULES = {
  "cashflow-categories": { lifecycle: "master", prefix: "ДДС", label: "Статья ДДС" },
  counterparties: { lifecycle: "master", prefix: "КА", label: "Контрагент" },
  transactions: { lifecycle: "document", prefix: "ПР", label: "Проводка" },
  "shift-acceptance": { lifecycle: "document", prefix: "ПС", label: "Принятие смены" },
  services: { lifecycle: "document", prefix: "АУ", label: "Акт услуг" },
  "bank-statements": { lifecycle: "document", prefix: "БВ", label: "Банковская выписка" },
  payments: { lifecycle: "approval", prefix: "ПЛ", label: "Платёж" },
  "payment-calendar": { lifecycle: "approval", prefix: "ПК", label: "Плановый платёж" },
  budgets: { lifecycle: "approval", prefix: "БЮ", label: "Бюджет" },
} as const satisfies Record<string, { lifecycle: Lifecycle; prefix: string; label: string }>

export type FinanceModuleId = keyof typeof FINANCE_MODULES

export const financeModuleId = v.union(
  v.literal("cashflow-categories"),
  v.literal("counterparties"),
  v.literal("transactions"),
  v.literal("shift-acceptance"),
  v.literal("services"),
  v.literal("bank-statements"),
  v.literal("payments"),
  v.literal("payment-calendar"),
  v.literal("budgets"),
)

/**
 * Module-specific fields. Flat scalar values (not v.any()); each module task (W1-FIN-03…06) narrows
 * its own keys while the table is still empty.
 */
export const financeRecordData = v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null()))
