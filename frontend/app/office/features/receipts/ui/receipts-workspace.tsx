import { useState } from "react"
import { useParams } from "react-router"

import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"

import { ReceiptEditor } from "./receipt-editor"
import { ReceiptsRegister } from "./receipts-register"

/** /office/receipts — the register; /office/receipts/:id — the receipt editor. */
export function ReceiptsWorkspace() {
  const { id } = useParams()
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={`${id ?? "list"}-${attempt}`} onRetry={() => setAttempt((value) => value + 1)}>
      {id ? <ReceiptEditor externalId={id} /> : <ReceiptsRegister />}
    </PlatformErrorBoundary>
  )
}
