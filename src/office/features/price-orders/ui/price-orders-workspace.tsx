import { useState } from "react"
import { useParams } from "react-router"

import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"

import { PriceOrderEditor } from "./price-order-editor"
import { PriceOrdersRegister } from "./price-orders-register"

/** /office/price-orders — the register; /office/price-orders/:externalId — the order editor. */
export function PriceOrdersWorkspace() {
  const { id } = useParams()
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={`${id ?? "list"}-${attempt}`} onRetry={() => setAttempt((value) => value + 1)}>
      {id ? <PriceOrderEditor externalId={id} /> : <PriceOrdersRegister />}
    </PlatformErrorBoundary>
  )
}
