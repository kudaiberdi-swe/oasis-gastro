import { useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router"

import { CashOperationsJournal } from "@/office/features/retail/ui/cash-operations-journal"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui"

import { RetailSettingsWorkspace } from "./retail-settings-workspace"

type CashOperationsTab = "journal" | "types"

/**
 * «Внесения и изъятия» (/office/cash-operations, W1-RTL-04): «Журнал операций» (cash in / out of the
 * shifts) and «Типы операций» (the versioned reference). /office/cash-operations/:externalId opens a
 * type in the right panel, so an id in the URL always shows the types tab; `?tab=types` links to it.
 */
export function CashOperationsWorkspace() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<CashOperationsTab>(() => (id || searchParams.get("tab") === "types" ? "types" : "journal"))
  const navigate = useNavigate()
  const active: CashOperationsTab = id ? "types" : tab
  const change = (value: string) => {
    setTab(value as CashOperationsTab)
    // Leaving an open type for the journal closes its panel (the unsaved-changes guard still asks).
    if (value === "journal" && id) navigate("/office/cash-operations")
  }

  return (
    <Tabs value={active} onValueChange={change} className="flex min-h-0 flex-1 flex-col">
      <TabsList aria-label="Внесения и изъятия" className="shrink-0 px-6 xl:px-8">
        <TabsTrigger value="journal">Журнал операций</TabsTrigger>
        <TabsTrigger value="types">Типы операций</TabsTrigger>
      </TabsList>
      <TabsContent value="journal" className="min-h-0 flex-1 overflow-y-auto px-6 py-5 xl:px-8">
        <CashOperationsJournal />
      </TabsContent>
      <TabsContent value="types" className="flex min-h-0 flex-1 pt-0">
        <RetailSettingsWorkspace kind="cash-operation-type" />
      </TabsContent>
    </Tabs>
  )
}
