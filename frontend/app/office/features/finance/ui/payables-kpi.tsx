import { KpiCard, Skeleton } from "@/shared/components/ui"
import { formatTenge } from "@/shared/lib/format"

import type { PayablesSummary } from "../data/use-obligations"

/**
 * KPI of «Задолженность» only (L-11): «К оплате» with its ageing, «Просрочено» (due date before today,
 * Almaty) and «Дебиторская». Open remainders, whole tenge (L-22).
 */
export function PayablesKpi({ summary }: { summary: PayablesSummary | undefined }) {
  if (summary === undefined) {
    return (
      <div className="grid gap-4 md:grid-cols-3" aria-busy="true">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-24 w-full" />
        ))}
      </div>
    )
  }
  const { ageing } = summary
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <KpiCard label="К оплате" value={formatTenge(summary.payable)} hint={`До 30 дней ${formatTenge(ageing.upTo30)} · 31–60 ${formatTenge(ageing.from31to60)} · больше 60 ${formatTenge(ageing.over60)}`} />
      <KpiCard label="Просрочено" value={formatTenge(summary.overdue)} hint={summary.overdue > 0 ? "Срок оплаты прошёл" : "Просроченных нет"} hintTone={summary.overdue > 0 ? "danger" : "neutral"} />
      <KpiCard label="Дебиторская" value={formatTenge(summary.receivable)} hint="Нам должны покупатели и агрегаторы" />
    </div>
  )
}
