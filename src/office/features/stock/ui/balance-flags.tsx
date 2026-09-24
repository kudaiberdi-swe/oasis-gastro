import { TonePill } from "@/shared/components/ui"

import type { BalanceRow } from "../data/use-stock-master"

/** Minimum / maximum / negative flags of a balance row (warning, info, danger). */
export function BalanceFlags({ row }: { row: Pick<BalanceRow, "belowMinimum" | "aboveMaximum" | "negative"> }) {
  if (!row.belowMinimum && !row.aboveMaximum && !row.negative) return null
  return (
    <span className="inline-flex flex-wrap justify-end gap-1">
      {row.negative ? <TonePill tone="danger">Отрицательный</TonePill> : null}
      {row.belowMinimum ? <TonePill tone="warning">Ниже минимума</TonePill> : null}
      {row.aboveMaximum ? <TonePill tone="info">Выше максимума</TonePill> : null}
    </span>
  )
}
