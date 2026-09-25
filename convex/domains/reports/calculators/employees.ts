import type { Calculator } from "../registry"
import { matcher } from "./_facts"
import { aggregate, col } from "./_shared"

// Employee reports of W2 (docs/IMPLEMENTATION-PLAN.md W2-RPT-07). A report is listed here only with a
// test (tests/convex/reportsEmployees.test.ts). The catalog marks payroll reports with
// `requiredCapability: "office.payroll.view"`, which queries.execute checks on top of office.reports.view.

/**
 * employees-02: payroll summary — the lines of the payroll runs whose period ends in the report period,
 * summed per employee: gross, withholdings (ОПВ, ВОСМС, ИПН), advances, to pay and employer
 * contributions (СО, СН, ООСМС, ОПВР). Posted runs only; `extra.includeDrafts` adds the drafts,
 * reversed runs never count.
 */
const payrollSummary: Calculator = async (ctx, config, restaurants) => {
  const includeDrafts = config.extra?.includeDrafts === true
  const matches = matcher(config)
  const columns = [
    col("group", "Сотрудник", "text"), col("code", "Табельный №", "text"), col("hours", "Часов", "hours"),
    col("gross", "Начислено", "money"), col("opv", "ОПВ", "money"), col("vosms", "ВОСМС", "money"), col("ipn", "ИПН", "money"), col("withheld", "Удержано", "money"),
    col("advances", "Авансы", "money"), col("toPay", "К выплате", "money"),
    col("socialContribution", "СО", "money"), col("socialTax", "СН", "money"), col("oosms", "ООСМС", "money"), col("opvr", "ОПВР", "money"), col("employerTaxes", "Взносы работодателя", "money"),
  ]
  const rows = []
  let runs = 0
  let drafts = 0
  let truncated = false
  for (const restaurant of restaurants) {
    const inPeriod = await ctx.db.query("payrollRuns").withIndex("by_restaurant_to", (q) => q.eq("restaurantExternalId", restaurant).gte("to", config.dateFrom).lte("to", config.dateTo)).take(100)
    if (inPeriod.length === 100) truncated = true
    for (const run of inPeriod) {
      if (run.status === "reversed" || (run.status === "draft" && !includeDrafts)) continue
      runs += 1
      if (run.status === "draft") drafts += 1
      for (const line of run.lines) {
        if (!matches(line.employeeName, line.employeeCode)) continue
        rows.push({
          key: line.employeeCode,
          label: line.employeeName,
          text: { code: line.employeeCode },
          values: {
            hours: line.hours, gross: line.gross, opv: line.opv, vosms: line.vosms, ipn: line.ipn, withheld: line.employeeTaxes,
            advances: line.advances, toPay: Math.max(0, line.net - line.advances),
            socialContribution: line.socialContribution, socialTax: line.socialTax, oosms: line.oosms, opvr: line.opvr, employerTaxes: line.employerTaxes,
          },
        })
      }
    }
  }
  const result = aggregate(rows, columns, "gross")
  return {
    sourceLabel: includeDrafts ? `Расчётные ведомости (проведённые и черновики: ${drafts})` : "Проведённые расчётные ведомости",
    columns,
    ...result,
    kpis: [
      { key: "gross", label: "Начислено", value: result.totals.gross ?? 0, unit: "money" },
      { key: "toPay", label: "К выплате", value: result.totals.toPay ?? 0, unit: "money" },
      { key: "employerTaxes", label: "Взносы работодателя", value: result.totals.employerTaxes ?? 0, unit: "money" },
      { key: "runs", label: "Ведомостей", value: runs, unit: "count" },
    ],
    truncated,
  }
}

export const EMPLOYEE_CALCULATORS: Record<string, Calculator> = {
  "employees-02": payrollSummary,
}
