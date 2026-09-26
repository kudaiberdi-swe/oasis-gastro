import { useState } from "react"
import { Printer } from "lucide-react"

import { useShiftHistory, type ShiftHistoryRow } from "@/pos/features/shifts/data/use-shifts"
import { Button, EmptyState, Money, SkeletonRows, StatusPill } from "@/shared/components/ui"
import { posErrorMessage, useT } from "@/pos/i18n"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"

/**
 * «История кассовых смен» (W1-POS-19): shifts of this terminal with their saved Z-reports. A closed
 * shift prints its Z-report, the open one an X-report.
 */
export function ShiftHistoryPanel({ sessionToken, onPrintX, onPrintZ }: { sessionToken: string; onPrintX: () => Promise<unknown>; onPrintZ: (shiftId: string) => Promise<unknown> }) {
  const t = useT()
  const history = useShiftHistory(sessionToken)
  const [printingId, setPrintingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function print(shift: ShiftHistoryRow) {
    setPrintingId(shift._id)
    setError(null)
    try {
      if (shift.status === "open") await onPrintX()
      else await onPrintZ(shift._id)
    } catch (caught) {
      setError(posErrorMessage(t, caught, t("shiftHistory.failed")))
    } finally {
      setPrintingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-body-sm text-muted-foreground">{t("shiftHistory.description")}</p>
      {error && (
        <p role="alert" className="text-body-sm font-semibold text-destructive">
          {error}
        </p>
      )}
      {history.status === "LoadingFirstPage" ? (
        <SkeletonRows rows={4} />
      ) : history.shifts.length === 0 ? (
        <EmptyState title={t("shiftHistory.empty")} />
      ) : (
        <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto" aria-label={t("shiftHistory.list")}>
          {history.shifts.map((shift) => {
            const closed = shift.status === "closed"
            const canPrint = !closed || Boolean(shift.zReportId)
            return (
              <li key={shift._id} aria-label={t("header.shift", { number: shift.number })} className="grid grid-cols-[150px_1fr_auto_auto] items-center gap-3 rounded-card border border-border bg-card p-3">
                <div>
                  <p className="text-body font-semibold">{t("header.shift", { number: shift.number })}</p>
                  <p className="text-body-sm text-muted-foreground">{shift.businessDate}</p>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusPill domain="shift" status={shift.status} />
                    <span className="truncate text-body-sm font-medium">{shift.openedByName}</span>
                  </div>
                  <p className="mt-1 truncate text-body-sm text-muted-foreground">
                    {formatAlmatyDateTime(shift.openedAt, t.intl)}
                    {shift.closedAt ? ` — ${formatAlmatyDateTime(shift.closedAt, t.intl)}` : ""}
                    {shift.zReportNumber ? ` · ${shift.zReportNumber}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  {/* A cashier's open shift has no revenue until it is closed (blind count, shifts.history). */}
                  {shift.summary.netSales === null ? <span className="text-body-sm text-muted-foreground">—</span> : <Money value={shift.summary.netSales} size="sm" />}
                  {closed && (
                    <p className="text-body-sm">
                      {t("close.variance")} <Money value={shift.variance ?? 0} size="sm" signed className="text-body-sm" />
                    </p>
                  )}
                </div>
                <Button variant="secondary" onClick={() => void print(shift)} disabled={!canPrint || printingId !== null} aria-label={closed ? t("shiftHistory.printZ", { number: shift.number }) : t("shiftHistory.printX", { number: shift.number })}>
                  <Printer /> {printingId === shift._id ? t("common.printing") : closed ? t("shift.zReport") : t("shift.xReport")}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      {history.status === "CanLoadMore" || history.status === "LoadingMore" ? (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={history.loadMore} disabled={history.status === "LoadingMore"}>
            {history.status === "LoadingMore" ? t("common.loadingEllipsis") : t("common.showMore")}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
