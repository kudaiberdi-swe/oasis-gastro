import { useState } from "react"
import { useParams } from "react-router"

import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"

import { DOCUMENT_TYPES, type StockDocumentType } from "../model/document-types"
import { DocumentEditor } from "./document-editor"
import { DocumentsRegister } from "./documents-register"

/** /office/<section> — the register; /office/<section>/:id — the document editor. */
export function StockDocumentsWorkspace({ type }: { type: StockDocumentType }) {
  const { id } = useParams()
  const [attempt, setAttempt] = useState(0)
  const config = DOCUMENT_TYPES[type]
  return (
    <PlatformErrorBoundary key={`${type}-${id ?? "list"}-${attempt}`} onRetry={() => setAttempt((value) => value + 1)}>
      {id ? <DocumentEditor config={config} externalId={id} /> : <DocumentsRegister key={type} config={config} />}
    </PlatformErrorBoundary>
  )
}

export const InventoriesWorkspace = () => <StockDocumentsWorkspace type="inventory" />
export const TransfersWorkspace = () => <StockDocumentsWorkspace type="transfer" />
export const WriteoffsWorkspace = () => <StockDocumentsWorkspace type="writeoff" />
export const OutgoingInvoicesWorkspace = () => <StockDocumentsWorkspace type="outgoing-invoice" />
export const SupplierReturnsWorkspace = () => <StockDocumentsWorkspace type="supplier-return" />
