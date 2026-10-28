import { Printer } from "lucide-react"
import { useId, useState, type ReactNode } from "react"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { useFinanceRestaurantFilter } from "@/office/features/finance/data/use-finance-records"
import { formatBusinessDate } from "@/office/features/finance/model/modules"
import { AcceptShiftDialog } from "@/office/features/finance/ui/accept-shift-dialog"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { buildZReportHtml } from "@/pos/features/shifts/model/z-report"
import { printHtml } from "@/pos/features/print/print-document"
import { Button, EmptyState, FilterTabs, Input, Money, Select, StatusPill, TonePill, useToast } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { formatTenge } from "@/shared/lib/format"

import { RETAIL_OFFICE_PAGE_SIZE, useAcceptShift, useIikoShifts, useLoadZReport, useOfficeShifts, useShiftAcceptanceAccounts, type IikoShiftRow, type SalesSource, type ShiftCard, type ShiftStatusTab } from "../data/use-retail-office"
import { canAcceptShift, iikoShiftStatusLabel, SHIFT_TABS, shiftCandidate, SOURCE_OPTIONS, Z_REPORT_MISSING } from "../model/retail-office"

/** «Кассовые смены» (/office/cash-shifts, W1-RTL-06): shift cards with sales, refunds, cash and acceptance. */
export function CashShiftsWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <CashShifts />
    </PlatformErrorBoundary>
  )
}

function CashShifts() {
  const canAccept = useCan("office.shift-acceptance.post")
  const canReadAccounts = useCan("office.shift-acceptance.view")
  const restaurants = useFinanceRestaurantFilter()
  const accounts = useShiftAcceptanceAccounts(canAccept && canReadAccounts)
  const accept = useAcceptShift()
  const toast = useToast()
  const panelId = useId()
  const [tab, setTab] = useState<ShiftStatusTab>("all")
  const [note, setNote] = useState("")
  const [accepting, setAccepting] = useState<ShiftCard | null>(null)
  const [source, setSource] = useState<SalesSource>("own")
  const list = useOfficeShifts({ status: tab, restaurantExternalId: restaurants.restaurantExternalId }, !restaurants.loading && source === "own")
  // Across several restaurants the server returns the latest shifts of each in one page.
  const bounded = restaurants.restaurantExternalId === undefined && restaurants.options.length > 2

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      {source === "own" ? <FilterTabs aria-label="Статус смен" value={tab} onValueChange={(value) => setTab(value as ShiftStatusTab)} items={SHIFT_TABS} panelId={panelId} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
          <Select aria-label="Источник" className="w-full sm:w-40" value={source} onValueChange={(value) => setSource(value as SalesSource)} options={SOURCE_OPTIONS} />
          {restaurants.visible ? <Select aria-label="Ресторан" className="w-full sm:w-56" value={restaurants.value} onValueChange={restaurants.setValue} options={restaurants.options} /> : null}
        </div>
        {canAccept && source === "own" ? (
          <Input aria-label="Комментарий при принятии" placeholder="Комментарий при принятии" className="w-full sm:w-[360px]" value={note} onChange={(event) => setNote(event.target.value)} />
        ) : null}
      </div>
      {source === "iiko" ? (
        <IikoShifts restaurantExternalId={restaurants.restaurantExternalId} enabled={!restaurants.loading} />
      ) : (
        <div id={panelId} role="tabpanel" aria-label={SHIFT_TABS.find((candidate) => candidate.value === tab)?.label} className="flex flex-col gap-4">
          {restaurants.loading || list.status === "LoadingFirstPage" ? (
            <OfficeStatePage state={{ kind: "loading" }} />
          ) : list.results.length === 0 ? (
            <div className="rounded-card border border-border bg-card">
              <EmptyState
                title={tab === "all" ? "Смен пока нет" : tab === "open" ? "Открытых смен нет" : "Закрытых смен нет"}
                description="Кассовые смены появятся здесь сразу после открытия на кассе."
              />
            </div>
          ) : (
            <>
              <ul aria-label="Кассовые смены" className="flex flex-col gap-4">
                {list.results.map((shift) => (
                  <li key={shift._id}>
                    <ShiftCardView shift={shift} canAccept={canAccept} onAccept={() => setAccepting(shift)} />
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-3 text-caption text-muted-foreground">
                <span>Загружено смен: {list.results.length}</span>
                {list.status === "CanLoadMore" || list.status === "LoadingMore" ? (
                  <Button variant="ghost" size="sm" onClick={() => list.loadMore(RETAIL_OFFICE_PAGE_SIZE)} disabled={list.status === "LoadingMore"}>
                    {list.status === "LoadingMore" ? "Загрузка…" : "Показать ещё"}
                  </Button>
                ) : bounded ? (
                  <span>Показаны последние смены каждого ресторана. Чтобы листать дальше, выберите ресторан.</span>
                ) : null}
              </div>
            </>
          )}
        </div>
      )}
      {accepting ? (
        <AcceptShiftDialog
          shift={shiftCandidate(accepting)}
          accounts={accounts ?? []}
          defaultNote={note.trim()}
          onOpenChange={(open) => {
            if (!open) setAccepting(null)
          }}
          onAccept={async (args) => {
            await accept(args)
            toast(`Смена №${accepting.number} принята`, "success")
          }}
        />
      ) : null}
    </div>
  )
}

/** iiko shifts (W2-RTL-01, D7): read-only cards — no acceptance, no Z print; the manager only by code. */
function IikoShifts({ restaurantExternalId, enabled }: { restaurantExternalId: string | undefined; enabled: boolean }) {
  const list = useIikoShifts(restaurantExternalId, enabled)
  if (!enabled || list.status === "LoadingFirstPage") return <OfficeStatePage state={{ kind: "loading" }} />
  if (list.results.length === 0) {
    return (
      <div className="rounded-card border border-border bg-card">
        <EmptyState title="Смен iiko нет" description="Смены появятся после импорта продаж из iiko для филиалов, сопоставленных в «Обмен данными»." />
      </div>
    )
  }
  return (
    <>
      <ul aria-label="Кассовые смены iiko" className="flex flex-col gap-4">
        {list.results.map((shift) => (
          <li key={shift._id}>
            <IikoShiftCard shift={shift} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3 text-caption text-muted-foreground">
        <span>Загружено смен: {list.results.length}</span>
        {list.status === "CanLoadMore" || list.status === "LoadingMore" ? (
          <Button variant="ghost" size="sm" onClick={() => list.loadMore(RETAIL_OFFICE_PAGE_SIZE)} disabled={list.status === "LoadingMore"}>
            {list.status === "LoadingMore" ? "Загрузка…" : "Показать ещё"}
          </Button>
        ) : null}
      </div>
    </>
  )
}

function IikoShiftCard({ shift }: { shift: IikoShiftRow }) {
  const title = `Смена №${shift.number}${shift.cashRegisterNumber !== null ? ` · касса ${shift.cashRegisterNumber}` : ""}`
  return (
    <article aria-label={title} className="flex flex-col gap-4 rounded-card border border-border bg-card p-4 shadow-panel">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-body font-semibold text-foreground">{title}</h3>
          <p className="text-caption text-muted-foreground">{[shift.restaurantName, "iiko", "только чтение"].join(" · ")}</p>
        </div>
        <TonePill tone={shift.status === "OPEN" ? "info" : "neutral"}>{iikoShiftStatusLabel(shift.status)}</TonePill>
      </header>
      <dl className="grid gap-3 sm:grid-cols-3">
        <Metric label="Оплачено заказов">
          <Money value={shift.ordersTotal} size="lg" />
        </Metric>
        <Metric label="Наличные / карта">
          <span className="text-body font-semibold tabular-nums">
            {formatTenge(shift.salesCash)} / {formatTenge(shift.salesCard)}
          </span>
        </Metric>
        <Metric label="Расхождение">
          <Money value={shift.cashDiff} size="lg" signed />
        </Metric>
      </dl>
      <dl className="grid gap-x-8 gap-y-2 rounded-card bg-muted p-3 text-body-sm sm:grid-cols-2">
        <Detail label="Открыта">{formatAlmatyDateTime(shift.openedAt)}</Detail>
        <Detail label="Закрыта">{shift.closedAt ? formatAlmatyDateTime(shift.closedAt) : "—"}</Detail>
        <Detail label="Менеджер (код iiko)">{shift.managerCode ?? "—"}</Detail>
        <Detail label="В долг / прочее">{formatTenge(shift.salesCredit)}</Detail>
        <Detail label="Внесения">{formatTenge(shift.payIn)}</Detail>
        <Detail label="Изъятия">{formatTenge(shift.payOut)}</Detail>
      </dl>
    </article>
  )
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-border p-3">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{children}</dd>
    </div>
  )
}

/** One shift (POS-DESIGN §11.4.2: cards, as in bahandi `office/04`). «Принять смену» is the card's one primary. */
export function ShiftCardView({ shift, canAccept, onAccept }: { shift: ShiftCard; canAccept: boolean; onAccept: () => void }) {
  const hintId = useId()
  const title = `Смена №${shift.number} · ${shift.terminalName}`
  const closed = shift.status !== "open"

  return (
    <article aria-label={title} className="flex flex-col gap-4 rounded-card border border-border bg-card p-4 shadow-panel">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-body font-semibold text-foreground">{title}</h3>
          <p className="text-caption text-muted-foreground">
            {[shift.restaurantName, formatBusinessDate(shift.businessDate), shift.zReportNumber].filter(Boolean).join(" · ")}
          </p>
        </div>
        <StatusPill domain="shift" status={shift.status} />
      </header>

      <dl className="grid gap-3 sm:grid-cols-3">
        <Metric label="Продажи">
          <Money value={shift.sales} size="lg" />
        </Metric>
        <Metric label="Возвраты">
          <Money value={shift.refunds} size="lg" />
        </Metric>
        <Metric label="Расхождение">{shift.variance === null ? <span className="text-title text-muted-foreground">—</span> : <Money value={shift.variance} size="lg" signed />}</Metric>
      </dl>

      <dl className="grid gap-x-8 gap-y-2 rounded-card bg-muted p-3 text-body-sm sm:grid-cols-2">
        <Detail label="Открыл">
          {shift.openedByName ?? "—"}
          <span className="block text-caption font-normal text-muted-foreground">{formatAlmatyDateTime(shift.openedAt)}</span>
        </Detail>
        <Detail label="Закрыл">
          {shift.closedByName ?? "—"}
          {shift.closedAt ? <span className="block text-caption font-normal text-muted-foreground">{formatAlmatyDateTime(shift.closedAt)}</span> : null}
        </Detail>
        <Detail label="Ожидается">{shift.expectedCash === null ? "—" : formatTenge(shift.expectedCash)}</Detail>
        <Detail label="Фактически">{shift.countedCash === null ? "—" : formatTenge(shift.countedCash)}</Detail>
        {shift.acceptance ? (
          <>
            <Detail label="Дата приёмки">{formatAlmatyDateTime(shift.acceptance.acceptedAt)}</Detail>
            <Detail label="Пересчитано в офисе">{formatTenge(shift.acceptance.recountedCash)}</Detail>
            {shift.acceptance.note ? (
              <div className="flex flex-col gap-0.5 sm:col-span-2">
                <dt className="text-muted-foreground">Комментарий при принятии</dt>
                <dd>{shift.acceptance.note}</dd>
              </div>
            ) : null}
          </>
        ) : null}
      </dl>

      {closed ? (
        <div className="flex flex-wrap items-center gap-2">
          {canAccept && canAcceptShift(shift) ? (
            <Button onClick={onAccept} aria-label={`Принять смену №${shift.number} · ${shift.terminalName}`}>
              Принять смену
            </Button>
          ) : null}
          {shift.zReportId ? (
            <PrintZButton zReportId={shift.zReportId} label={`Печать Z · смена №${shift.number}`} />
          ) : (
            <>
              <Button variant="secondary" aria-disabled="true" aria-describedby={hintId} title={Z_REPORT_MISSING} className="cursor-not-allowed opacity-45 hover:bg-card" onClick={(event) => event.preventDefault()}>
                <Printer aria-hidden />
                Печать Z
              </Button>
              <span id={hintId} className="sr-only">
                {Z_REPORT_MISSING}
              </span>
            </>
          )}
        </div>
      ) : null}
    </article>
  )
}

/** «Печать Z»: the saved report (retail/office.getZReport) on the POS 80 mm print form. */
function PrintZButton({ zReportId, label }: { zReportId: NonNullable<ShiftCard["zReportId"]>; label: string }) {
  const loadZReport = useLoadZReport()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function print() {
    setBusy(true)
    try {
      const report = await loadZReport(zReportId)
      if (!report) toast("Z-отчёт не найден или относится к ресторану вне вашего доступа", "error")
      else if (!printHtml(buildZReportHtml(report, { restaurantName: report.restaurantName, terminalName: report.terminalName }))) toast("Браузер не может напечатать Z-отчёт", "error")
    } catch (caught) {
      toast(errorMessage(caught, "Не удалось загрузить Z-отчёт"), "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="secondary" aria-label={label} disabled={busy} onClick={() => void print()}>
      <Printer aria-hidden />
      {busy ? "Готовим…" : "Печать Z"}
    </Button>
  )
}
