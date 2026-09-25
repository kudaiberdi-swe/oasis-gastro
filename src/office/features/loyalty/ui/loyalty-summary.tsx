import { KpiCard, Skeleton } from "@/shared/components/ui"
import { formatQuantity } from "@/shared/lib/format"

import { useGuestSummary } from "../data/use-office-loyalty"

/**
 * KPI of «Гости» (office/54): active guests and published programs from guestSummary. «Резервов и
 * банкетов» comes with the reservations section (W2), the query does not count them yet.
 */
export function LoyaltySummary() {
  const summary = useGuestSummary()
  if (summary === undefined) {
    return (
      <div className="grid gap-4 md:grid-cols-2" aria-busy="true">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <KpiCard label="Активных гостей" value={formatQuantity(summary.activeGuests)} hint={summary.activeGuests >= 100_000 ? "Показано не больше 100 000" : undefined} />
      <KpiCard label="Опубликовано программ" value={formatQuantity(summary.publishedPrograms)} />
    </div>
  )
}
