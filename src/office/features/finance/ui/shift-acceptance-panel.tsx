import { useState } from "react"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { Button, Select, SkeletonRows, useToast } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { formatTenge } from "@/shared/lib/format"
import { cn } from "@/shared/lib/utils"

import { FINANCE_PAGE_SIZE, useFinanceReferences, useFinanceRestaurantFilter, useShiftAcceptanceMutations, useShiftCandidates, type ShiftCandidate } from "../data/use-finance-records"
import { formatBusinessDate } from "../model/modules"
import { AcceptShiftDialog } from "./accept-shift-dialog"

/**
 * «Закрытые смены к приёмке» (W1-FIN-06, fixes L-12): closed shifts of the user's restaurants without an
 * acceptance, straight from `shifts` — not an empty list. «Принять» opens the recount dialog.
 */
export function ShiftAcceptancePanel() {
  const canPost = useCan("office.shift-acceptance.post")
  const restaurants = useFinanceRestaurantFilter()
  const references = useFinanceReferences("shift-acceptance")
  const candidates = useShiftCandidates(restaurants.restaurantExternalId, !restaurants.loading)
  const { accept } = useShiftAcceptanceMutations()
  const toast = useToast()
  const [accepting, setAccepting] = useState<ShiftCandidate | null>(null)
  const loading = restaurants.loading || candidates.status === "LoadingFirstPage"

  return (
    <section aria-labelledby="shift-candidates-title" className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="shift-candidates-title" className="font-display text-title-sm font-semibold">
            Закрытые смены к приёмке
          </h2>
          <p className="text-caption text-muted-foreground">Примите смену после пересчёта наличности. Расхождение проводится в журнал.</p>
        </div>
        {restaurants.visible ? <Select aria-label="Ресторан смен" className="w-full sm:w-56" value={restaurants.value} onValueChange={restaurants.setValue} options={restaurants.options} /> : null}
      </div>
      {loading ? (
        <SkeletonRows rows={2} />
      ) : candidates.results.length === 0 ? (
        <OfficeStatePage state={{ kind: "empty", title: "Все смены приняты", description: "Закрытые кассовые смены появятся здесь сразу после закрытия на кассе." }} />
      ) : (
        <>
          <ul aria-label="Смены к приёмке" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {candidates.results.map((shift) => (
              <li key={shift.shiftId} className="flex flex-col gap-3 rounded-card border border-border p-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-body-sm font-semibold text-foreground">
                    №{shift.shiftNumber} · {shift.terminalName}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {shift.restaurantName} · {formatBusinessDate(shift.businessDate)}
                    {shift.closedAt ? ` · закрыта ${formatAlmatyDateTime(shift.closedAt)}` : ""}
                    {shift.closedByName ? ` · ${shift.closedByName}` : ""}
                  </span>
                </div>
                <dl className="grid grid-cols-3 gap-2 text-body-sm">
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-caption text-muted-foreground">Ожидалось</dt>
                    <dd className="tabular-nums">{formatTenge(shift.expectedCash)}</dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-caption text-muted-foreground">Пересчитано</dt>
                    <dd className="tabular-nums">{formatTenge(shift.countedCash)}</dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-caption text-muted-foreground">Расхождение</dt>
                    <dd className={cn("tabular-nums", shift.variance === 0 ? "text-foreground" : "font-semibold text-destructive")}>{formatTenge(shift.variance, { explicitPlus: true })}</dd>
                  </div>
                </dl>
                {canPost ? (
                  <Button variant="secondary" size="sm" className="self-start" onClick={() => setAccepting(shift)} aria-label={`Принять смену №${shift.shiftNumber} · ${shift.terminalName}`}>
                    Принять
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {candidates.status === "CanLoadMore" || candidates.status === "LoadingMore" ? (
            <Button variant="ghost" size="sm" className="self-start" onClick={() => candidates.loadMore(FINANCE_PAGE_SIZE)} disabled={candidates.status === "LoadingMore"}>
              {candidates.status === "LoadingMore" ? "Загрузка…" : "Показать ещё"}
            </Button>
          ) : null}
        </>
      )}
      {accepting ? (
        <AcceptShiftDialog
          shift={accepting}
          accounts={references?.accounts ?? []}
          onOpenChange={(open) => {
            if (!open) setAccepting(null)
          }}
          onAccept={async (args) => {
            await accept(args)
            toast(`Смена №${accepting.shiftNumber} принята`, "success")
          }}
        />
      ) : null}
    </section>
  )
}
