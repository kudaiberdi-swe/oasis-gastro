import { useCan } from "@/office/components/can"
import { KpiCard, Skeleton } from "@/shared/components/ui"
import { formatQuantity } from "@/shared/lib/format"

import { useGuestSummary } from "../data/use-office-loyalty"
import { useReservationSummary } from "../data/use-reservations"

/**
 * KPI of «Гости» (office/54, OFFICE-DESIGN §5 guests): active guests and published programs from
 * guestSummary, upcoming reservations (W2-LOY-07) for a role that sees «Банкеты и резервы».
 */
export function LoyaltySummary() {
  const summary = useGuestSummary()
  const canReservations = useCan("office.reservations.view")
  const reservations = useReservationSummary(undefined, canReservations)
  const columns = canReservations ? "md:grid-cols-3" : "md:grid-cols-2"
  if (summary === undefined) {
    return (
      <div className={`grid gap-4 ${columns}`} aria-busy="true">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        {canReservations ? <Skeleton className="h-24 w-full" /> : null}
      </div>
    )
  }
  return (
    <div className={`grid gap-4 ${columns}`}>
      <KpiCard label="Активных гостей" value={formatQuantity(summary.activeGuests)} hint={summary.activeGuests >= 100_000 ? "Показано не больше 100 000" : undefined} />
      <KpiCard label="Опубликовано программ" value={formatQuantity(summary.publishedPrograms)} />
      {canReservations ? <KpiCard label="Предстоящих резервов" value={reservations === undefined ? "—" : formatQuantity(reservations.upcoming)} /> : null}
    </div>
  )
}
