import { KpiCard } from "@/shared/components/ui"
import { cn } from "@/shared/lib/utils"

import type { ReportResult } from "../data/use-reports"
import { hasTotals } from "../model/export"
import { formatReportValue } from "../model/format"

// Result table (W1-RPT-03): columns from the report registry, formatted by `unit`, numbers on the right in
// tabular figures, the «Итого» row from `totals`, horizontal scroll inside its own card (L-16).

export function ReportTable({ result, caption }: { result: Pick<ReportResult, "columns" | "rows" | "totals">; caption: string }) {
  const { columns, rows, totals } = result
  const right = (index: number) => columns[index].align === "right"
  return (
    <div className="min-w-0 overflow-hidden rounded-card border border-border bg-card">
      <div className="max-h-[70vh] min-w-0 overflow-auto">
        <table className="w-full border-collapse text-body-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-[1] bg-card">
            <tr className="border-b border-border">
              {columns.map((column, index) => (
                <th key={column.key} scope="col" className={cn("h-10 px-4 text-caption font-semibold whitespace-nowrap text-muted-foreground", right(index) ? "text-right" : "text-left")}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="h-[var(--table-row-h)] border-b border-border last:border-b-0 hover:bg-muted">
                {columns.map((column, index) => (
                  <td key={column.key} className={cn("px-4 py-2 text-foreground", right(index) ? "text-right whitespace-nowrap tabular-nums" : index === 0 && "font-semibold")}>
                    {formatReportValue(row.cells[column.key], column.unit)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {rows.length && hasTotals(result) ? (
            <tfoot className="sticky bottom-0 bg-muted">
              <tr className="h-[var(--table-row-h)] border-t border-border font-semibold text-foreground">
                {columns.map((column, index) => (
                  <td key={column.key} className={cn("px-4 py-2", right(index) ? "text-right whitespace-nowrap tabular-nums" : "text-left")}>
                    {index === 0 ? "Итого" : column.key in totals ? formatReportValue(totals[column.key], column.unit) : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
        {rows.length === 0 ? <p className="px-4 py-10 text-center text-body-sm text-muted-foreground">За выбранный период данных нет</p> : null}
      </div>
    </div>
  )
}

/** KPI set from the registry of the report (only its own, L-11). */
export function ReportKpis({ kpis }: { kpis: ReportResult["kpis"] }) {
  if (!kpis.length) return null
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((kpi) => (
        <KpiCard key={kpi.key} label={kpi.label} value={formatReportValue(kpi.value, kpi.unit)} />
      ))}
    </div>
  )
}
