import { useState } from "react"

import { useCan } from "@/office/components/can"
import { PlatformErrorBoundary, usePlatformScope } from "@/office/features/platform/data/use-platform"
import { useDebounced } from "@/office/features/stock/data/use-stock-master"
import { useMasterSelection } from "@/office/features/stock/ui/master-panel"
import { loadMoreFromPaginated, StatusPill, type Column } from "@/shared/components/ui"
import { formatQuantity } from "@/shared/lib/format"
import { plural } from "@/shared/lib/plural"

import { CAMPAIGNS_PAGE_SIZE, useCampaignReferences, useCampaigns, type CampaignRow } from "../data/use-campaigns"
import { ALL_RESTAURANTS, CAMPAIGN_TABS, CHANNEL_LABELS, formatCampaignPeriod, type CampaignStatus, type CampaignTab } from "../model/campaigns"
import { CampaignEditor } from "./campaign-editor"
import { LoyaltyRegister } from "./loyalty-register"

const SECTION = "campaigns"

/** «Рассылки и акции» (/office/campaigns/:id?, W3-LOY-08): approval register, card in the right panel. */
export function CampaignsWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <Campaigns />
    </PlatformErrorBoundary>
  )
}

function Campaigns() {
  const canEdit = useCan("office.campaigns.edit")
  const selection = useMasterSelection(SECTION)
  const scope = usePlatformScope()
  const references = useCampaignReferences()
  const [tab, setTab] = useState<CampaignTab>("all")
  const [searchText, setSearchText] = useState("")
  const search = useDebounced(searchText).trim()
  const list = useCampaigns({ ...(tab === "all" ? {} : { status: tab as CampaignStatus }), ...(search ? { search } : {}) })
  const panelOpen = (selection.isNew && canEdit) || selection.selectedId !== null
  const categoryName = (id: string | undefined) => (id ? (references?.categories.find((row) => row.externalId === id)?.name ?? "Категория") : "Все гости")
  const restaurantsLine = (ids: string[]) => (ids.includes(ALL_RESTAURANTS) ? "Вся сеть" : ids.length === 1 ? (scope.restaurantName(ids[0]) ?? ids[0]) : `${ids.length} ${plural(ids.length, ["ресторан", "ресторана", "ресторанов"])}`)

  const columns: Column<CampaignRow>[] = [
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
    { key: "channel", header: "Канал", cell: (row) => CHANNEL_LABELS[row.channel] },
    {
      key: "audience",
      header: "Аудитория",
      cell: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{categoryName(row.categoryExternalId)}</span>
          <span className="text-caption text-muted-foreground">{restaurantsLine(row.restaurantExternalIds)}</span>
        </span>
      ),
    },
    {
      key: "sent",
      header: "Отправлено",
      numeric: true,
      cell: (row) =>
        row.status === "draft" || row.status === "pending-approval" ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="flex flex-col items-end tabular-nums">
            <span className="font-medium">
              {formatQuantity(row.sentCount)} из {formatQuantity(row.audienceCount)}
            </span>
            {row.failedCount ? <span className="text-caption text-destructive">ошибок: {formatQuantity(row.failedCount)}</span> : null}
          </span>
        ),
    },
    {
      key: "period",
      header: "Период",
      cell: (row) => {
        const period = formatCampaignPeriod(row)
        return (
          <span className="flex flex-col whitespace-nowrap tabular-nums">
            <span>{period.launch}</span>
            <span className="text-caption text-muted-foreground">окно {period.window}</span>
          </span>
        )
      },
    },
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.status} /> },
  ]

  return (
    <div className="flex min-h-0 flex-1">
      <LoyaltyRegister
        caption="Рассылки и акции"
        tabs={CAMPAIGN_TABS}
        tab={tab}
        onTabChange={(value) => setTab(value as CampaignTab)}
        search={searchText}
        onSearchChange={setSearchText}
        searchPlaceholder="Поиск: рассылки и акции"
        createLabel={canEdit ? "Новая запись" : undefined}
        onCreate={selection.openNew}
        formOpen={panelOpen}
        columns={columns}
        rows={list.status === "LoadingFirstPage" ? undefined : list.results}
        getRowId={(row) => row.externalId}
        selectedId={selection.selectedId}
        onSelect={(row) => selection.select(row.externalId)}
        loadMore={loadMoreFromPaginated(list, CAMPAIGNS_PAGE_SIZE)}
        unfiltered={tab === "all" && !search}
        emptyTitle="Кампаний пока нет"
        emptyDescription="Создайте SMS- или email-рассылку: сообщения получат только гости с действующим согласием, в заданное окно времени."
      />
      {panelOpen ? <CampaignEditor key={selection.selectedId ?? "new"} externalId={selection.selectedId} onClose={selection.close} onSaved={selection.select} /> : null}
    </div>
  )
}
