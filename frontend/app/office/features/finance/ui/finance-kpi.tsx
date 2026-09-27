import { KpiCard, Skeleton } from "@/shared/components/ui"
import { formatTenge } from "@/shared/lib/format"

import type { FinanceOverview } from "../data/use-finance-records"

export interface FinanceKpiProps {
  overview: FinanceOverview | undefined
  /** «Проводок за 30 дней» for the default period, «Проводок за период» otherwise. */
  last30Days: boolean
  /** The journal is narrowed by source, the turnover is not. */
  sourceFiltered: boolean
}

/**
 * KPI of «Проводки» only (L-11). With an account: its debit and credit turnover — different numbers.
 * Without: one «Оборот за период», since the whole book's debit always equals its credit.
 */
export function FinanceKpi({ overview, last30Days, sourceFiltered }: FinanceKpiProps) {
  if (overview === undefined) {
    return (
      <div className="grid gap-4 md:grid-cols-3" aria-busy="true">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-24 w-full" />
        ))}
      </div>
    )
  }
  const countLabel = last30Days ? "Проводок за 30 дней" : "Проводок за период"
  const note = [overview.truncated ? "Посчитано по первым 20 000 строкам" : null, sourceFiltered ? "По всем источникам" : null].filter(Boolean).join(" · ") || undefined
  if (overview.mode === "account") {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        <KpiCard label="Оборот Дт по счёту" value={formatTenge(overview.debitTurnover)} hint={note} />
        <KpiCard label="Оборот Кт по счёту" value={formatTenge(overview.creditTurnover)} hint={note} />
        <KpiCard label={countLabel} value={overview.entriesCount} hint={`Сальдо за период: ${formatTenge(overview.balance, { explicitPlus: true })}`} />
      </div>
    )
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <KpiCard label="Оборот за период" value={formatTenge(overview.turnover)} hint={note ?? "Выберите счёт, чтобы увидеть обороты по дебету и кредиту"} />
      <KpiCard label={countLabel} value={overview.entriesCount} />
    </div>
  )
}
