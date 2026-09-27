import { useMemo, useState } from "react"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { Banner, Button, ConfirmDialog, DataTable, KpiCard, TonePill, useToast, type Column } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatTenge } from "@/shared/lib/format"

import { useMotivationMutations, useMotivationResults, type MotivationProgram, type MotivationResultRow } from "../data/use-workforce-w3"
import { formatMetricValue, formatReward, METRIC_LABEL } from "../model/w3"

// «Результаты» of a motivation program (W3-HR-07): the fact per participant, whether the threshold is
// met and the bonus; «Начислить премии» writes payroll bonus adjustments after the end of the period.

export function resultColumns(program: Pick<MotivationProgram, "metric">): Column<MotivationResultRow>[] {
  return [
    {
      key: "employee",
      header: "Сотрудник",
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold text-foreground">{row.employeeName}</span>
          <span className="truncate text-caption text-muted-foreground">{[`код ${row.employeeCode}`, row.positionName].filter(Boolean).join(" · ")}</span>
        </div>
      ),
    },
    {
      key: "fact",
      header: "Факт",
      numeric: true,
      cell: (row) => (
        <div className="flex flex-col items-end">
          <span>{formatMetricValue(program.metric, row.fact) ?? "—"}</span>
          <span className="text-caption text-muted-foreground">{row.basis}</span>
        </div>
      ),
    },
    { key: "fulfilled", header: "Выполнено", cell: (row) => <TonePill tone={row.fulfilled ? "success" : "neutral"}>{row.fulfilled ? "Да" : "Нет"}</TonePill> },
    {
      key: "reward",
      header: "Премия",
      numeric: true,
      cell: (row) => (
        <div className="flex flex-col items-end">
          <span>{row.reward ? formatTenge(row.reward) : "—"}</span>
          {row.accrued !== null ? <span className="text-caption text-success">начислено {formatTenge(row.accrued)}</span> : null}
        </div>
      ),
    },
  ]
}

export function MotivationResultsPanel({ program }: { program: MotivationProgram }) {
  const results = useMotivationResults(program.externalId)
  const canPayroll = useCan("office.payroll.edit")
  const canProgram = useCan(program.requiresApproval ? "office.motivation.approve" : "office.motivation.edit")
  const { accrue } = useMotivationMutations()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const columns = useMemo(() => resultColumns(program), [program])

  if (results === undefined) return <OfficeStatePage state={{ kind: "loading" }} />
  if (results === null) return <OfficeStatePage state={{ kind: "empty", title: "Результаты недоступны", description: "Программа вне вашего доступа." }} />

  const pending = results.rows.filter((row) => row.fulfilled && row.reward > 0 && row.accrued === null)
  const pendingAmount = pending.reduce((sum, row) => sum + row.reward, 0)
  const canAccrue = canPayroll && canProgram && results.accruable && pending.length > 0

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const done = await accrue({ externalId: program.externalId })
      setConfirming(false)
      toast(done.created ? `Начислено премий: ${done.created} на ${formatTenge(done.amount)}` : "Новых премий нет — всё уже начислено", "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось начислить премии"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Участников" value={results.totals.participants} />
        <KpiCard label="Выполнили" value={results.totals.fulfilled} hint={`${METRIC_LABEL[program.metric]}: ${program.metric === "kitchen-time" ? "≤" : "≥"} ${formatMetricValue(program.metric, program.threshold)}`} />
        <KpiCard label="Премии по результатам" value={formatTenge(results.totals.reward)} hint={formatReward(program)} />
        <KpiCard label="Начислено в зарплату" value={formatTenge(results.totals.accrued)} />
      </div>
      {program.status === "draft" ? (
        <Banner tone="info" title="Предварительный расчёт">
          Программа ещё не опубликована. Результаты уже считаются по данным кассы и явки, начислить премии можно после публикации и окончания периода.
        </Banner>
      ) : null}
      {program.metric === "kitchen-time" ? (
        <Banner tone="info" title="Командный показатель">
          Экран кухни не фиксирует повара, поэтому время кухни — среднее по ресторану, одинаковое для всех участников.
          {results.kitchenTruncated ? " Период слишком большой: посчитана только часть тикетов." : ""}
        </Banner>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-card p-4">
        <div className="flex flex-col gap-0.5">
          <p className="text-body-sm font-semibold">Начисление в зарплату</p>
          <p className="text-caption text-muted-foreground">
            {results.accruable
              ? pending.length
                ? `К начислению: ${pending.length} ${pending.length === 1 ? "премия" : "премий"} на ${formatTenge(pendingAmount)}. Премии попадут в ведомость как корректировки — проводки сделает ведомость.`
                : "Все премии по программе уже начислены."
              : results.reason}
          </p>
          {results.accruable && pending.length > 0 && !(canPayroll && canProgram) ? (
            <p className="text-caption text-muted-foreground">{!canPayroll ? "Нужно право «Начисления и удержания — изменение»." : "Программа требует утверждения: нужно право утверждать мотивационные программы."}</p>
          ) : null}
        </div>
        {canPayroll && canProgram ? (
          <Button onClick={() => setConfirming(true)} disabled={!canAccrue || busy}>
            Начислить премии
          </Button>
        ) : null}
      </div>
      {results.rows.length ? (
        <DataTable caption="Результаты программы" columns={columns} rows={results.rows} getRowId={(row) => row.employeeId} />
      ) : (
        <div className="rounded-card border border-border bg-card">
          <OfficeStatePage state={{ kind: "empty", title: "Нет участников", description: "В ресторане нет активных сотрудников, подходящих под условия программы." }} />
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Начислить премии по ${program.number}?`}
        description={`Будет создано премий: ${pending.length} на ${formatTenge(pendingAmount)}. Они войдут в ведомость зарплаты ресторана за период программы.`}
        confirmLabel="Начислить"
        cancelLabel="Не начислять"
        submitting={busy}
        error={confirming ? error : null}
        onConfirm={run}
      />
    </div>
  )
}
