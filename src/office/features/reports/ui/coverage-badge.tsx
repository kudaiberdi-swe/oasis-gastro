import { TonePill } from "@/shared/components/ui"

import type { ReportCoverage } from "../data/use-reports"

/** Honest badge: how many of the 190 reports have a calculator (bahandi showed «190/190», B-23). */
export function CoverageBadge({ coverage }: { coverage: ReportCoverage | undefined }) {
  if (!coverage) return null
  return (
    <div className="flex items-center gap-2 text-caption text-muted-foreground">
      <span>Готовы к работе</span>
      <TonePill tone="info">
        {coverage.implemented} из {coverage.total}
      </TonePill>
    </div>
  )
}
