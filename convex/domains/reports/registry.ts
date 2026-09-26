import type { GenericQueryCtx } from "convex/server"

import type { DataModel } from "../../_generated/dataModel"
import type { ReportConfig, ReportResult } from "../../lib/reportConfig"
import { count, factReport, money } from "./calculators/_facts"
import { DELIVERY_CALCULATORS } from "./calculators/delivery"
import { EMPLOYEE_CALCULATORS } from "./calculators/employees"
import { FINANCE_CALCULATORS } from "./calculators/finance"
import { MENU_CALCULATORS } from "./calculators/menu"
import { OPERATION_CALCULATORS } from "./calculators/operations"
import { PRODUCTION_CALCULATORS } from "./calculators/production"
import { SALES_CALCULATORS } from "./calculators/sales"
import { STOCK_CALCULATORS } from "./calculators/stock"

type QueryCtx = GenericQueryCtx<DataModel>

// Report registry (W1-RPT-01): only reports with a calculator and a test are "implemented"; the rest of
// the 190 are honestly "in development" (bahandi reported 190/190 — B-23). Fact-based calculators live
// in calculators/_facts.ts.

export type Calculator = (ctx: QueryCtx, config: ReportConfig, restaurantExternalIds: string[]) => Promise<Omit<ReportResult, "reportId" | "generatedAt">>

export const REPORT_REGISTRY: Record<string, { calculator: Calculator }> = {
  ...Object.fromEntries(Object.entries({ ...STOCK_CALCULATORS, ...OPERATION_CALCULATORS, ...SALES_CALCULATORS, ...MENU_CALCULATORS, ...FINANCE_CALCULATORS, ...EMPLOYEE_CALCULATORS, ...PRODUCTION_CALCULATORS, ...DELIVERY_CALCULATORS }).map(([id, calculator]) => [id, { calculator }])),
  "sales-11": { calculator: factReport({ factType: "branch", byDay: true, dimensionLabel: "Дата", measures: [count("orderCount", "Заказов"), count("guestCount", "Гостей"), money("netAmount", "Выручка")], average: true }) },
  "sales-13": { calculator: factReport({ factType: "category", dimensionLabel: "Категория", measures: [{ key: "quantity", label: "Количество", unit: "quantity" }, money("grossAmount", "По меню"), money("netAmount", "Выручка")], sortBy: "netAmount" }) },
  "sales-19": { calculator: factReport({ factType: "payment-type", dimensionLabel: "Тип оплаты", measures: [money("netAmount", "Оплачено"), money("refundAmount", "Возвращено"), count("refundCount", "Возвратов")], sortBy: "netAmount" }) },
  "sales-01": { calculator: factReport({ factType: "branch", byDay: true, dimensionLabel: "Дата", measures: [count("orderCount", "Заказов"), count("guestCount", "Гостей"), money("grossAmount", "По меню"), money("discountAmount", "Скидки"), money("serviceChargeAmount", "Сервисный сбор"), money("netAmount", "Выручка"), money("refundAmount", "Возвраты")], average: true }) },
  "sales-02": { calculator: factReport({ factType: "hour", dimensionLabel: "Час", measures: [count("orderCount", "Заказов"), money("netAmount", "Выручка")], average: true, sortBy: "netAmount" }) },
  "sales-04": { calculator: factReport({ factType: "employee", dimensionLabel: "Официант", measures: [count("orderCount", "Заказов"), count("guestCount", "Гостей"), money("netAmount", "Выручка")], average: true }) },
  "sales-06": { calculator: factReport({ factType: "payment-type", dimensionLabel: "Тип оплаты", measures: [count("orderCount", "Оплат"), money("netAmount", "Сумма"), money("refundAmount", "Возвраты"), count("refundCount", "Возвратов")], sortBy: "netAmount" }) },
  "sales-07": { calculator: factReport({ factType: "category", dimensionLabel: "Категория", measures: [{ key: "quantity", label: "Количество", unit: "quantity" }, money("netAmount", "Выручка"), money("costAmount", "Себестоимость")], margin: true, sortBy: "netAmount" }) },
  "sales-12": { calculator: factReport({ factType: "product", dimensionLabel: "Блюдо", measures: [{ key: "quantity", label: "Количество", unit: "quantity" }, money("grossAmount", "По меню"), money("netAmount", "Выручка"), money("costAmount", "Себестоимость")], margin: true, sortBy: "netAmount" }) },
  "sales-14": { calculator: factReport({ factType: "order-type", dimensionLabel: "Тип заказа", measures: [count("orderCount", "Заказов"), money("netAmount", "Выручка")], average: true }) },
  "sales-21": { calculator: factReport({ factType: "deletion-reason", dimensionLabel: "Причина", measures: [count("orderCount", "Случаев"), { key: "quantity", label: "Позиций", unit: "quantity" }, money("grossAmount", "Сумма")] }) },
  "sales-22": { calculator: factReport({ factType: "discount-type", dimensionLabel: "Скидка / надбавка", measures: [count("orderCount", "Заказов"), money("grossAmount", "По меню"), money("discountAmount", "Сумма скидки")], sortBy: "discountAmount" }) },
  "sales-23": { calculator: factReport({ factType: "service-charge", dimensionLabel: "Сбор", measures: [count("orderCount", "Заказов"), money("serviceChargeAmount", "Сервисный сбор"), money("netAmount", "Выручка")] }) },
}
