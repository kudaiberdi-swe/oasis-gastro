import { useState } from "react"

import { useCan } from "@/office/components/can"
import { LoyaltyRegister } from "@/office/features/loyalty/ui/loyalty-register"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { useDebounced } from "@/office/features/stock/data/use-stock-master"
import { useMasterSelection } from "@/office/features/stock/ui/master-panel"
import { loadMoreFromPaginated, StatusPill, TonePill, type Column } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { formatQuantity } from "@/shared/lib/format"

import { CARDS_PAGE_SIZE, useIntegrationCards, type CardRow } from "../data/use-integration-cards"
import { CARD_SECTIONS, CARD_TABS, MODE_LABELS, type CardModuleId, type CardStatus, type CardTab } from "../model/cards"
import { IntegrationCardEditor } from "./integration-card-editor"

// «Обмен и интеграции» sections with a provider card (W3-INT-01, office/70, 72, 84–88): the publish
// Register with the §5 columns, the card in the right panel. One workspace per section id.

export function IntegrationCardsWorkspace({ moduleId }: { moduleId: CardModuleId }) {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={`${moduleId}:${attempt}`} onRetry={() => setAttempt((value) => value + 1)}>
      <IntegrationCards key={moduleId} moduleId={moduleId} />
    </PlatformErrorBoundary>
  )
}

function IntegrationCards({ moduleId }: { moduleId: CardModuleId }) {
  const section = CARD_SECTIONS[moduleId]
  const canEdit = useCan(`office.${moduleId}.edit`)
  const selection = useMasterSelection(moduleId)
  const [tab, setTab] = useState<CardTab>("all")
  const [searchText, setSearchText] = useState("")
  const search = useDebounced(searchText).trim()
  const list = useIntegrationCards(moduleId, { ...(tab === "all" ? {} : { status: tab as CardStatus }), ...(search ? { search } : {}) })
  const panelOpen = (selection.isNew && canEdit) || selection.selectedId !== null

  const columns: Column<CardRow>[] = [
    {
      key: "name",
      header: "Название",
      cell: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-semibold">{row.name}</span>
          <span className="text-caption whitespace-nowrap text-muted-foreground">{row.number}</span>
        </span>
      ),
    },
    { key: "provider", header: "Провайдер", cell: (row) => row.provider },
    { key: "mode", header: "Режим", cell: (row) => <TonePill tone={row.mode === "production" ? "info" : "neutral"}>{MODE_LABELS[row.mode]}</TonePill> },
    { key: "sync", header: "Последняя синхронизация", cell: (row) => (row.lastSyncAt ? <span className="whitespace-nowrap tabular-nums">{formatAlmatyDateTime(row.lastSyncAt)}</span> : <span className="text-muted-foreground">—</span>) },
    {
      key: "errors",
      header: "Ошибок",
      numeric: true,
      cell: (row) => (row.errors ? <span className="font-medium text-destructive">{row.errorsCapped ? `${formatQuantity(row.errors)}+` : formatQuantity(row.errors)}</span> : <span className="text-muted-foreground">0</span>),
    },
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.status} /> },
  ]

  return (
    <div className="flex min-h-0 flex-1">
      <LoyaltyRegister
        caption={section.label}
        tabs={CARD_TABS}
        tab={tab}
        onTabChange={(value) => setTab(value as CardTab)}
        search={searchText}
        onSearchChange={setSearchText}
        searchPlaceholder={`Поиск: ${section.label}`}
        createLabel={canEdit ? "Подключение" : undefined}
        onCreate={selection.openNew}
        formOpen={panelOpen}
        columns={columns}
        rows={list.status === "LoadingFirstPage" ? undefined : list.results}
        getRowId={(row) => row.externalId}
        selectedId={selection.selectedId}
        onSelect={(row) => selection.select(row.externalId)}
        loadMore={loadMoreFromPaginated(list, CARDS_PAGE_SIZE)}
        unfiltered={tab === "all" && !search}
        emptyTitle="Подключений пока нет"
        emptyDescription="Добавьте карточку провайдера: режим, endpoint и имя переменной окружения с секретом. Сам секрет в карточке не хранится."
      />
      {panelOpen ? <IntegrationCardEditor key={selection.selectedId ?? "new"} moduleId={moduleId} externalId={selection.selectedId} onClose={selection.close} onSaved={selection.select} /> : null}
    </div>
  )
}
