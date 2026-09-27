import { ExternalLink } from "lucide-react"

import { Button } from "@/shared/components/ui"

import { kitchenHref } from "../model/kitchen-link"

/** «Открыть экран кухни ↗»: a new tab with /kitchen?terminal=…, where the kitchen signs in by PIN. */
export function KitchenBoardLink({ terminalExternalId, restaurantName }: { terminalExternalId: string; restaurantName: string }) {
  return (
    <Button asChild variant="secondary">
      <a href={kitchenHref(terminalExternalId)} target="_blank" rel="noopener noreferrer" aria-label={`Открыть экран кухни · ${restaurantName} (в новой вкладке)`}>
        Открыть экран кухни
        <ExternalLink aria-hidden />
      </a>
    </Button>
  )
}
