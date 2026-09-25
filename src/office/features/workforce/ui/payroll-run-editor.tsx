import { ArrowLeft } from "lucide-react"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { usePlatformScope } from "@/office/features/platform/data/use-platform"
import { Banner, Button, ConfirmDialog, DataTable, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, KpiCard, MoneyInput, SegmentedControl, StatusPill, useToast, type Column } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { formatHours, formatTenge } from "@/shared/lib/format"

import { usePayrollMutations, usePayrollRun, type PayrollLine, type PayrollRunCard } from "../data/use-workforce-w2"
import { formatBusinessDate, formatRate } from "../model/modules"
import { accountCode, PAYOUT_METHOD_LABEL, periodLabel, remainingByEmployee } from "../model/w2"

// /office/payroll/:id — a payroll run (Editor §3.4): KPI, lines with every tax, postings, payouts.
// Draft → «Провести»; posted → «Выплатить» and «Сторно» (refused by the server after a payout).

export function PayrollRunEditor({ externalId }: { externalId: string }) {
  const card = usePayrollRun(externalId)
  const navigate = useNavigate()
  const back = () => navigate("/office/payroll")
  if (card === undefined) {
    return (
      <div className="px-6 py-5 xl:px-8">
        <OfficeStatePage state={{ kind: "loading" }} />
      </div>
    )
  }
  if (card === null) {
    return (
      <div className="px-6 py-5 xl:px-8">
        <EmptyState
          title="Ведомость не найдена"
          description="Возможно, она относится к ресторану вне вашего доступа или ссылка устарела."
          action={
            <Button variant="secondary" onClick={back}>
              <ArrowLeft aria-hidden />К списку
            </Button>
          }
        />
      </div>
    )
  }
  return <RunCard card={card} onBack={back} />
}

/** Columns of the run lines: the employee, hours in «ч», the rate with its unit, then every amount in ₸. */
export const PAYROLL_LINE_COLUMNS: Column<PayrollLine>[] = [
  {
    key: "employee",
    header: "Сотрудник",
    cell: (line) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-semibold">{line.employeeName}</span>
        <span className="truncate text-caption text-muted-foreground">код {line.employeeCode}</span>
      </div>
    ),
  },
  { key: "hours", header: "Часы", numeric: true, cell: (line) => formatHours(line.hours) },
  { key: "rate", header: "Ставка", numeric: true, cell: (line) => formatRate(line.rate, line.payType) },
  { key: "adjustments", header: "Премии − штрафы", numeric: true, cell: (line) => (line.adjustments ? formatTenge(line.adjustments, { explicitPlus: true }) : "—") },
  { key: "gross", header: "Начислено", numeric: true, cell: (line) => <span className="font-semibold">{formatTenge(line.gross)}</span> },
  { key: "opv", header: "ОПВ", numeric: true, cell: (line) => formatTenge(line.opv) },
  { key: "vosms", header: "ВОСМС", numeric: true, cell: (line) => formatTenge(line.vosms) },
  { key: "ipn", header: "ИПН", numeric: true, cell: (line) => formatTenge(line.ipn) },
  { key: "net", header: "На руки", numeric: true, cell: (line) => <span className="font-semibold">{formatTenge(line.net)}</span> },
  { key: "advances", header: "Аванс", numeric: true, cell: (line) => (line.advances ? formatTenge(line.advances) : "—") },
  { key: "opvr", header: "ОПВР", numeric: true, cell: (line) => formatTenge(line.opvr) },
  { key: "oosms", header: "ООСМС", numeric: true, cell: (line) => formatTenge(line.oosms) },
  { key: "so", header: "СО", numeric: true, cell: (line) => formatTenge(line.socialContribution) },
  { key: "sn", header: "СН", numeric: true, cell: (line) => formatTenge(line.socialTax) },
]

type Entry = PayrollRunCard["entries"][number]
type Payout = PayrollRunCard["payouts"][number]

const ENTRY_COLUMNS: Column<Entry>[] = [
  { key: "date", header: "Дата", cell: (entry) => formatBusinessDate(entry.businessDate) },
  { key: "debit", header: "Дебет", cell: (entry) => <span className="font-semibold tabular-nums">{accountCode(entry.debitAccountExternalId)}</span> },
  { key: "credit", header: "Кредит", cell: (entry) => <span className="font-semibold tabular-nums">{accountCode(entry.creditAccountExternalId)}</span> },
  { key: "amount", header: "Сумма", numeric: true, cell: (entry) => <span className={entry.reversalOf ? "text-destructive" : undefined}>{formatTenge(entry.reversalOf ? -entry.amount : entry.amount)}</span> },
  { key: "description", header: "Описание", cell: (entry) => <span className="text-muted-foreground">{entry.description}</span> },
]

const PAYOUT_COLUMNS: Column<Payout>[] = [
  { key: "date", header: "Дата", cell: (payout) => formatAlmatyDateTime(payout.createdAt) },
  { key: "method", header: "Способ", cell: (payout) => PAYOUT_METHOD_LABEL[payout.method] },
  { key: "employees", header: "Сотрудников", numeric: true, cell: (payout) => payout.lines.length },
  { key: "amount", header: "Сумма", numeric: true, cell: (payout) => <span className="font-semibold">{formatTenge(payout.amount)}</span> },
  { key: "by", header: "Кто выплатил", cell: (payout) => <span className="text-muted-foreground">{payout.createdBy}</span> },
]

function RunCard({ card, onBack }: { card: PayrollRunCard; onBack: () => void }) {
  const { run, payouts, entries } = card
  const canEdit = useCan("office.payroll.edit")
  const canPost = useCan("office.payroll.post")
  const canReverse = useCan("office.payroll.reverse")
  const scope = usePlatformScope()
  const { calculatePayroll, postPayroll, reversePayroll } = usePayrollMutations()
  const toast = useToast()
  const [busy, setBusy] = useState<"recalculate" | "post" | "reverse" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reversing, setReversing] = useState(false)
  const [paying, setPaying] = useState(false)
  const remaining = useMemo(() => remainingByEmployee(run.lines, payouts), [run.lines, payouts])
  const left = [...remaining.values()].reduce((sum, amount) => sum + amount, 0)
  const restaurantName = scope.restaurantName(run.restaurantExternalId) ?? run.restaurantExternalId
  const primary = run.status === "draft" && canPost ? "post" : run.status === "posted" && canPost && left > 0 ? "pay" : null

  async function act(kind: "recalculate" | "post", action: () => Promise<unknown>, done: string) {
    setBusy(kind)
    setError(null)
    try {
      await action()
      toast(done, "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось выполнить действие"))
    } finally {
      setBusy(null)
    }
  }

  async function reverse(reason: string) {
    setBusy("reverse")
    setError(null)
    try {
      await reversePayroll({ externalId: run.externalId, reason: reason.trim() })
      setReversing(false)
      toast("Ведомость сторнирована", "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сторнировать ведомость"))
    } finally {
      setBusy(null)
    }
  }

  const totals = run.lines.reduce(
    (sum, line) => ({ gross: sum.gross + line.gross, opv: sum.opv + line.opv, vosms: sum.vosms + line.vosms, ipn: sum.ipn + line.ipn, net: sum.net + line.net }),
    { gross: 0, opv: 0, vosms: 0, ipn: 0, net: 0 },
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5 xl:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display text-title font-semibold">Ведомость {run.number}</h2>
            <StatusPill domain="document" status={run.status} />
          </div>
          <p className="text-body-sm text-muted-foreground">{[restaurantName, periodLabel(run.from, run.to), `правила ${run.ruleVersion}`].join(" · ")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={onBack}>
            <ArrowLeft aria-hidden />К списку
          </Button>
          {run.status === "draft" && canEdit ? (
            <Button variant="secondary" disabled={busy !== null} onClick={() => void act("recalculate", () => calculatePayroll({ restaurantExternalId: run.restaurantExternalId, from: run.from, to: run.to }), "Ведомость пересчитана")}>
              {busy === "recalculate" ? "Расчёт…" : "Пересчитать"}
            </Button>
          ) : null}
          {primary === "post" ? (
            <Button disabled={busy !== null} onClick={() => void act("post", () => postPayroll({ externalId: run.externalId }), "Ведомость проведена")}>
              {busy === "post" ? "Проведение…" : "Провести"}
            </Button>
          ) : null}
          {primary === "pay" ? (
            <Button disabled={busy !== null} onClick={() => setPaying(true)}>
              Выплатить
            </Button>
          ) : null}
          {run.status === "posted" && canReverse ? (
            <Button variant="danger" disabled={busy !== null || run.paidAmount > 0} onClick={() => setReversing(true)}>
              Сторно
            </Button>
          ) : null}
        </div>
      </header>

      <RunBanner card={card} />
      {error && !reversing ? (
        <Banner tone="danger" title="Не удалось выполнить действие">
          {error}
        </Banner>
      ) : null}

      <section aria-label="Итоги ведомости" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Начислено" value={formatTenge(run.totals.gross)} hint={`Сотрудников: ${run.lines.length}`} />
        <KpiCard label="Удержано" value={formatTenge(run.totals.employeeTaxes)} hint="ОПВ, ВОСМС, ИПН" />
        <KpiCard label="Налоги работодателя" value={formatTenge(run.totals.employerTaxes)} hint="ОПВР, ООСМС, СО, СН" />
        <KpiCard label="К выплате" value={formatTenge(run.totals.toPay)} hint={run.status === "posted" ? `Выплачено ${formatTenge(run.paidAmount)} · осталось ${formatTenge(left)}` : "За вычетом авансов"} />
      </section>

      <section aria-label="Строки ведомости" className="flex flex-col gap-3">
        <h3 className="text-title-sm font-semibold">Строки ведомости</h3>
        <DataTable caption="Строки ведомости" columns={PAYROLL_LINE_COLUMNS} rows={run.lines} getRowId={(line) => line.employeeCode} empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">За период нет согласованных явок и корректировок</p>} />
        {run.lines.length ? (
          <p className="text-body-sm text-muted-foreground">
            Итого: начислено <span className="font-semibold text-foreground">{formatTenge(totals.gross)}</span> · ОПВ {formatTenge(totals.opv)} · ВОСМС {formatTenge(totals.vosms)} · ИПН {formatTenge(totals.ipn)} · на руки{" "}
            <span className="font-semibold text-foreground">{formatTenge(totals.net)}</span>
          </p>
        ) : null}
      </section>

      <section aria-label="Проводки" className="flex flex-col gap-3">
        <h3 className="text-title-sm font-semibold">Проводки</h3>
        {entries.length ? (
          <DataTable caption="Проводки" columns={ENTRY_COLUMNS} rows={entries} getRowId={(entry) => entry.externalId} />
        ) : (
          <p className="rounded-card border border-border bg-card px-4 py-6 text-body-sm text-muted-foreground">Проводки появятся после проведения: начисление, удержания и налоги работодателя по видам.</p>
        )}
      </section>

      {run.status !== "draft" ? (
        <section aria-label="Выплаты" className="flex flex-col gap-3">
          <h3 className="text-title-sm font-semibold">Выплаты</h3>
          {payouts.length ? (
            <DataTable caption="Выплаты" columns={PAYOUT_COLUMNS} rows={payouts} getRowId={(payout) => payout.externalId} />
          ) : (
            <p className="rounded-card border border-border bg-card px-4 py-6 text-body-sm text-muted-foreground">Выплат по ведомости пока нет.</p>
          )}
        </section>
      ) : null}

      <ConfirmDialog
        open={reversing}
        onOpenChange={setReversing}
        title={`Сторнировать ведомость ${run.number}?`}
        description="Сторнируются все проводки ведомости, включая налоги работодателя, и снимаются налоговые обязательства. После этого ведомость можно пересчитать."
        confirmLabel="Сторнировать"
        reasonLabel="Причина сторно"
        submitting={busy === "reverse"}
        error={reversing ? error : null}
        onConfirm={(reason) => reverse(reason)}
      />
      {paying ? <PayoutDialog card={card} remaining={remaining} onClose={() => setPaying(false)} /> : null}
    </div>
  )
}

function RunBanner({ card }: { card: PayrollRunCard }) {
  const { run } = card
  switch (run.status) {
    case "draft":
      return (
        <Banner tone="info" title="Черновик ведомости">
          Рассчитано по согласованным и закрытым на кассе явкам и корректировкам периода. После изменения явок пересчитайте ведомость.
        </Banner>
      )
    case "posted":
      return run.paidAmount > 0 ? (
        <Banner tone="info" title="Ведомость проведена — только чтение">
          По ведомости есть выплаты, поэтому сторно недоступно.
        </Banner>
      ) : (
        <Banner tone="info" title="Ведомость проведена — только чтение">
          Налоги и взносы переданы в обязательства со сроком уплаты 25 числа следующего месяца. Исправление — через сторно.
        </Banner>
      )
    case "reversed":
      return (
        <Banner tone="warning" title="Ведомость сторнирована">
          {run.reverseReason ? `Причина: ${run.reverseReason}. ` : ""}Рассчитайте период заново, чтобы создать новую ведомость.
        </Banner>
      )
    default:
      return null
  }
}

function PayoutDialog({ card, remaining, onClose }: { card: PayrollRunCard; remaining: Map<string, number>; onClose: () => void }) {
  const { run } = card
  const { createPayout } = usePayrollMutations()
  const toast = useToast()
  const due = run.lines.filter((line) => (remaining.get(line.employeeCode) ?? 0) > 0)
  const [method, setMethod] = useState<"cash" | "bank">("bank")
  const [amounts, setAmounts] = useState<Record<string, number | null>>(() => Object.fromEntries(due.map((line) => [line.employeeCode, remaining.get(line.employeeCode) ?? 0])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const over = due.filter((line) => (amounts[line.employeeCode] ?? 0) > (remaining.get(line.employeeCode) ?? 0))
  const total = due.reduce((sum, line) => sum + (amounts[line.employeeCode] ?? 0), 0)

  async function submit() {
    if (busy || over.length || !total) return
    setBusy(true)
    setError(null)
    try {
      const lines = due.map((line) => ({ employeeCode: line.employeeCode, amount: amounts[line.employeeCode] ?? 0 })).filter((line) => line.amount > 0)
      const result = await createPayout({ runExternalId: run.externalId, method, lines })
      toast(`Выплачено ${formatTenge(result.amount)}`, "success")
      onClose()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось провести выплату"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Выплата по ведомости {run.number}</DialogTitle>
          <DialogDescription>Сумма на руки за вычетом авансов и прошлых выплат. Можно выплатить частично — остаток останется в ведомости.</DialogDescription>
        </DialogHeader>
        <SegmentedControl
          aria-label="Способ выплаты"
          value={method}
          onValueChange={setMethod}
          options={[
            { value: "bank", label: PAYOUT_METHOD_LABEL.bank },
            { value: "cash", label: PAYOUT_METHOD_LABEL.cash },
          ]}
        />
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full text-body-sm" aria-label="Суммы выплаты">
            <thead>
              <tr className="border-b border-border text-caption font-semibold text-muted-foreground">
                <th scope="col" className="px-3 py-2 text-left">
                  Сотрудник
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Осталось
                </th>
                <th scope="col" className="w-44 px-3 py-2 text-right">
                  К выплате
                </th>
              </tr>
            </thead>
            <tbody>
              {due.map((line) => {
                const invalid = (amounts[line.employeeCode] ?? 0) > (remaining.get(line.employeeCode) ?? 0)
                return (
                  <tr key={line.employeeCode} className="border-b border-border last:border-b-0">
                    <th scope="row" className="px-3 py-2 text-left font-semibold">
                      {line.employeeName}
                    </th>
                    <td className="px-3 py-2 text-right tabular-nums">{formatTenge(remaining.get(line.employeeCode) ?? 0)}</td>
                    <td className="px-3 py-1.5">
                      <MoneyInput aria-label={`К выплате: ${line.employeeName}`} aria-invalid={invalid || undefined} value={amounts[line.employeeCode] ?? null} onValueChange={(value) => setAmounts((current) => ({ ...current, [line.employeeCode]: value }))} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-body-sm text-muted-foreground">
          Итого к выплате: <span className="font-semibold text-foreground">{formatTenge(total)}</span> · проводка: расчёты по оплате труда → {method === "cash" ? "касса" : "банк"}
        </p>
        {over.length ? <p role="alert" className="text-body-sm text-destructive">Сумма больше остатка: {over.map((line) => line.employeeName).join(", ")}</p> : null}
        {error ? (
          <Banner tone="danger" title="Не удалось провести выплату">
            {error}
          </Banner>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={() => void submit()} disabled={busy || over.length > 0 || !total}>
            {busy ? "Выплата…" : "Выплатить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
