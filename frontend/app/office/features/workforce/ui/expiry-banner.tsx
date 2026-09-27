import { Banner, Button } from "@/shared/components/ui"

import type { ExpiringMedical } from "../data/use-workforce-w3"

// The medical-records panel above the search (W3-HR-08, as bahandi's ExpiryPanel): documents ending in
// the next 30 days, with a jump to the filter; documents already ended without a renewal as danger.

export function ExpiryBanner({ expiring, filtered, onToggle }: { expiring: ExpiringMedical | undefined; filtered: boolean; onToggle: () => void }) {
  if (expiring === undefined) return null
  const more = expiring.truncated ? "+" : ""
  return (
    <div className="flex flex-col gap-2">
      <Banner
        tone="warning"
        title={`Документы с истечением в ближайшие ${expiring.withinDays} дней: ${expiring.count}${more}`}
        action={
          expiring.count > 0 || filtered ? (
            <Button variant="secondary" size="sm" onClick={onToggle}>
              {filtered ? "Показать все" : "Показать"}
            </Button>
          ) : undefined
        }
      >
        {expiring.count > 0 ? `Ближайший: ${expiring.rows[0].employeeName}, до ${expiring.rows[0].expiresAt.split("-").reverse().join(".")}.` : "Согласованные документы действуют дольше этого срока."}
      </Banner>
      {expiring.expiredCount > 0 ? (
        <Banner tone="danger" title={`Истекли и не продлены: ${expiring.expiredCount}${more}`}>
          {expiring.expired
            .slice(0, 3)
            .map((row) => `${row.employeeName} (${row.expiresAt.split("-").reverse().join(".")})`)
            .join(", ")}
          {expiring.expiredCount > 3 ? " и другие" : ""}. Внесите новый документ и согласуйте его.
        </Banner>
      ) : null}
    </div>
  )
}
