import { useState } from "react"

import { useCan } from "@/office/components/can"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { useMasterSelection } from "@/office/features/stock/ui/master-panel"
import { Select, StatusPill, TonePill, type Column } from "@/shared/components/ui"
import { formatAmount } from "@/shared/lib/format"

import { useFinanceRecord, useFinanceReferences, useFinanceRestaurantFilter, type FinanceRecord } from "../data/use-finance-records"
import { bankLineOf, bankName, shortIban, MATCH_STATUS_LABELS, MATCH_STATUS_TONES } from "../model/bank-lines"
import { DOCUMENT_TABS, formatBusinessDate } from "../model/modules"
import { BankImportPanel } from "./bank-import-panel"
import { BankMatchPanel } from "./bank-match-panel"
import { FinanceRegister } from "./finance-register"
import { RecordPanelFallback } from "./record-editor"

const MODULE = "bank-statements"

/** «Банковские выписки» (/office/bank-statements/:id?, W3-FIN-11): CSV import, matching to payments and obligations, posting. */
export function BankStatementsWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <BankStatements />
    </PlatformErrorBoundary>
  )
}

function BankStatements() {
  const canEdit = useCan(`office.${MODULE}.edit`)
  const selection = useMasterSelection(MODULE)
  const references = useFinanceReferences(MODULE)
  const record = useFinanceRecord(MODULE, selection.selectedId)
  const restaurants = useFinanceRestaurantFilter()

  const columns: Column<FinanceRecord>[] = [
    { key: "number", header: "Номер", cell: (row) => <span className="font-semibold whitespace-nowrap">{row.number}</span> },
    { key: "date", header: "Дата", cell: (row) => <span className="whitespace-nowrap">{formatBusinessDate(row.businessDate)}</span>, sortValue: (row) => row.businessDate },
    {
      key: "bank",
      header: "Банк",
      cell: (row) => {
        const line = bankLineOf(row)
        return (
          <div className="flex min-w-0 flex-col">
            <span className="font-semibold">{bankName(line.bank)}</span>
            <span className="truncate text-caption text-muted-foreground">{line.counterparty || row.name}</span>
          </div>
        )
      },
    },
    { key: "account", header: "Счёт", cell: (row) => <span title={bankLineOf(row).accountIban} className="whitespace-nowrap">{shortIban(bankLineOf(row).accountIban)}</span> },
    { key: "incoming", header: "Приход, ₸", numeric: true, cell: (row) => (bankLineOf(row).direction === "incoming" ? formatAmount(row.amount) : ""), sortValue: (row) => (bankLineOf(row).direction === "incoming" ? row.amount : 0) },
    { key: "outgoing", header: "Расход, ₸", numeric: true, cell: (row) => (bankLineOf(row).direction === "outgoing" ? formatAmount(row.amount) : ""), sortValue: (row) => (bankLineOf(row).direction === "outgoing" ? row.amount : 0) },
    {
      key: "matched",
      header: "Сопоставлено",
      cell: (row) => {
        const line = bankLineOf(row)
        const number = line.matchStatus === "suggested" ? line.suggestedNumber : line.matchedNumber
        return (
          <div className="flex flex-col items-start gap-0.5">
            <TonePill tone={MATCH_STATUS_TONES[line.matchStatus]}>{MATCH_STATUS_LABELS[line.matchStatus]}</TonePill>
            {number ? <span className="text-caption text-muted-foreground">{number}</span> : null}
          </div>
        )
      },
    },
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.status} /> },
  ]

  const panelProps = { onClose: selection.close, onSaved: selection.select }
  return (
    <div className="flex min-h-0 flex-1">
      <FinanceRegister
        moduleId={MODULE}
        caption="Банковские выписки"
        tabs={DOCUMENT_TABS}
        columns={columns}
        searchPlaceholder="Поиск: банковские выписки"
        formOpen={selection.selectedId !== null}
        selectedId={selection.selectedId}
        onSelect={selection.select}
        emptyTitle="Выписок пока нет"
        emptyDescription={canEdit ? "Загрузите CSV-выписку банка выше — строки появятся здесь, их можно сопоставить с платежами и обязательствами." : "Строки выписок появятся после импорта CSV."}
        restaurantExternalId={restaurants.loading ? undefined : restaurants.restaurantExternalId}
        toolbar={restaurants.visible ? <Select aria-label="Ресторан" className="w-full sm:w-56" value={restaurants.value} onValueChange={restaurants.setValue} options={restaurants.options} /> : null}
        kpis={canEdit && !restaurants.loading ? <BankImportPanel restaurants={restaurants.restaurants} defaultRestaurantExternalId={restaurants.restaurantExternalId} /> : null}
      />
      {selection.selectedId !== null && record && references ? <BankMatchPanel key={record.externalId} record={record} references={references} {...panelProps} /> : null}
      {selection.selectedId !== null && (!record || !references) ? <RecordPanelFallback title="Строка выписки" missing={record === null} missingTitle="Строка не найдена" onClose={selection.close} /> : null}
    </div>
  )
}
