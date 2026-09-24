import { Banner } from "@/shared/components/ui"
import { formatAlmatyDate } from "@/shared/lib/almaty-time"

export interface PeriodLockedBannerProps {
  /** The last locked day (epoch ms). Documents on or before it are read-only. */
  lockedUntil: number
  /** Whether the lock is preliminary (can be lifted by an administrator) or final. */
  kind?: "preliminary" | "final"
}

/** Contract only in W0 — the period-close domain (W1) supplies `lockedUntil`. */
export function PeriodLockedBanner({ lockedUntil, kind = "final" }: PeriodLockedBannerProps) {
  return (
    <Banner tone="warning" title={`Период закрыт до ${formatAlmatyDate(lockedUntil)}`}>
      {kind === "preliminary" ? "Предварительное закрытие: изменения может разрешить администратор." : "Документ доступен только для чтения."}
    </Banner>
  )
}
