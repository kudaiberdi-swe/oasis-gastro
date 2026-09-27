import { useId, useState } from "react"
import { useParams, useSearchParams } from "react-router"

import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { FilterTabs } from "@/shared/components/ui"

import { PRODUCTION_TYPES, type ProductionDocType } from "../model/production"
import { ActEditor } from "./act-editor"
import { ActsRegister } from "./acts-register"
import { PreparationEditor } from "./preparation-editor"
import { PreparationsList } from "./preparations-list"

/** /office/<section> — the register; /office/<section>/:id (or /new) — the document editor. */
export function ProductionDocumentsWorkspace({ type }: { type: ProductionDocType }) {
  const { id } = useParams()
  const [attempt, setAttempt] = useState(0)
  const config = PRODUCTION_TYPES[type]
  return (
    <PlatformErrorBoundary key={`${type}-${id ?? "list"}-${attempt}`} onRetry={() => setAttempt((value) => value + 1)}>
      {id ? <ActEditor config={config} externalId={id} /> : <ActsRegister key={type} config={config} />}
    </PlatformErrorBoundary>
  )
}

const PRODUCTION_TABS = [
  { value: "acts", label: "Акты приготовления" },
  { value: "preparations", label: "Заготовки" },
]

/**
 * /office/production: tabs «Акты приготовления / Заготовки» (?tab=preparations keeps the tab on F5);
 * /office/production/:id — an act; /office/production/preparations/:productId — a preparation card.
 */
export function ProductionWorkspace() {
  const { id, subId } = useParams()
  const [params, setParams] = useSearchParams()
  const [attempt, setAttempt] = useState(0)
  const panelId = useId()
  const tab = params.get("tab") === "preparations" ? "preparations" : "acts"
  const retry = () => setAttempt((value) => value + 1)
  if (id === "preparations" && subId) {
    return (
      <PlatformErrorBoundary key={`preparation-${subId}-${attempt}`} onRetry={retry}>
        <PreparationEditor productExternalId={subId} />
      </PlatformErrorBoundary>
    )
  }
  if (id) {
    return (
      <PlatformErrorBoundary key={`act-${id}-${attempt}`} onRetry={retry}>
        <ActEditor config={PRODUCTION_TYPES.production} externalId={id} />
      </PlatformErrorBoundary>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FilterTabs
        aria-label="Производство"
        className="mx-6 mt-4 xl:mx-8"
        value={tab}
        onValueChange={(value) => setParams(value === "preparations" ? { tab: "preparations" } : {}, { replace: true })}
        items={PRODUCTION_TABS}
        panelId={panelId}
      />
      <div id={panelId} role="tabpanel" aria-label={PRODUCTION_TABS.find((item) => item.value === tab)?.label} className="flex min-h-0 flex-1 flex-col">
        <PlatformErrorBoundary key={`${tab}-${attempt}`} onRetry={retry}>
          {tab === "preparations" ? <PreparationsList /> : <ActsRegister config={PRODUCTION_TYPES.production} />}
        </PlatformErrorBoundary>
      </div>
    </div>
  )
}

export const ProcessingActsWorkspace = () => <ProductionDocumentsWorkspace type="processing" />
export const AssemblyActsWorkspace = () => <ProductionDocumentsWorkspace type="assembly" />
export const SalesActsWorkspace = () => <ProductionDocumentsWorkspace type="sales" />
export const InternalOrdersWorkspace = () => <ProductionDocumentsWorkspace type="internal-order" />
export const PurchaseOrdersWorkspace = () => <ProductionDocumentsWorkspace type="purchase-order" />
