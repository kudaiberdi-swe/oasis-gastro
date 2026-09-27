import { KpiCard, Skeleton } from "@/shared/components/ui"
import { cn } from "@/shared/lib/utils"

import type { DeliveryKpis as DeliveryKpisValue } from "../data/use-delivery"

/** «Активные / Опаздывают / В пути / Доставлено сегодня» over the delivery register (office/59, office/62). */
export function DeliveryKpis({ kpis }: { kpis: DeliveryKpisValue | undefined }) {
  if (kpis === undefined) {
    return (
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-busy="true">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-[104px] w-full" />
        ))}
      </div>
    )
  }
  const late = kpis.late > 0
  return (
    <div role="group" aria-label="Показатели доставки" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <KpiCard label="Активные" value={<span className="tabular-nums">{kpis.active}</span>} />
      <KpiCard
        label="Опаздывают"
        value={<span className={cn("tabular-nums", late && "text-warning")}>{kpis.late}</span>}
        hint={late ? "Обещанное время прошло" : undefined}
        className={late ? "border-warning/50" : undefined}
      />
      <KpiCard label="В пути" value={<span className="tabular-nums">{kpis.onWay}</span>} />
      <KpiCard label="Доставлено сегодня" value={<span className="tabular-nums">{kpis.deliveredToday}</span>} />
    </div>
  )
}
