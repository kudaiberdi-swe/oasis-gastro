import { Plus } from "lucide-react"
import { useId, useState, type ReactNode } from "react"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { OfficeStatePage } from "@/office/components/state-page"
import { useDebounced } from "@/office/features/stock/data/use-stock-master"
import { Button, ConfirmDialog, DataTable, EmptyState, FilterTabs, Input, loadMoreFromPaginated, Select, useToast, type Column } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { recordCount } from "@/shared/lib/plural"

import { PLATFORM_RECORDS_PAGE_SIZE, usePlatformRecordMutations, usePlatformRecords, type PlatformModuleId, type PlatformRecord, type PlatformStatus } from "../data/use-platform-records"

// The Domain register (OFFICE-DESIGN §3.5) of the platform modules: lifecycle tabs, server search, a
// scope filter, the module's own columns, and the status actions of a card.

export type PlatformTab = { value: string; label: string; status?: PlatformStatus }

/** publish: «Все / Черновики / Опубликованные / Неактивные». */
export const PUBLISH_TABS: PlatformTab[] = [
  { value: "all", label: "Все" },
  { value: "draft", label: "Черновики", status: "draft" },
  { value: "published", label: "Опубликованные", status: "published" },
  { value: "inactive", label: "Неактивные", status: "inactive" },
]

/** master: «Все / Активные / Неактивные». */
export const MASTER_TABS: PlatformTab[] = [
  { value: "all", label: "Все" },
  { value: "active", label: "Активные", status: "active" },
  { value: "inactive", label: "Неактивные", status: "inactive" },
]

export const ALL_SCOPES = "all"

export interface PlatformRegisterProps {
  moduleId: PlatformModuleId
  caption: string
  tabs: PlatformTab[]
  columns: Column<PlatformRecord>[]
  searchPlaceholder: string
  createLabel?: string
  onCreate?: () => void
  formOpen: boolean
  selectedId: string | null
  onSelect: (externalId: string) => void
  emptyTitle: string
  emptyDescription: string
  /** «Область» filter: «Все» + organizations and restaurants in scope. */
  scopes: { value: string; label: string }[]
}

export function PlatformRegister({ moduleId, caption, tabs, columns, searchPlaceholder, createLabel, onCreate, formOpen, selectedId, onSelect, emptyTitle, emptyDescription, scopes }: PlatformRegisterProps) {
  const panelId = useId()
  const [tab, setTab] = useState(tabs[0].value)
  const [scope, setScope] = useState(ALL_SCOPES)
  const [searchText, setSearchText] = useState("")
  const search = useDebounced(searchText)
  const active = tabs.find((candidate) => candidate.value === tab) ?? tabs[0]
  const list = usePlatformRecords(moduleId, { status: active.status, search, restaurantExternalId: scope === ALL_SCOPES ? undefined : scope })
  const unfiltered = !active.status && !search.trim() && scope === ALL_SCOPES

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Input type="search" aria-label="Поиск" placeholder={searchPlaceholder} className="w-full sm:w-[420px]" value={searchText} onChange={(event) => setSearchText(event.target.value)} />
          {scopes.length > 1 ? <Select aria-label="Область" className="w-64" value={scope} onValueChange={setScope} options={[{ value: ALL_SCOPES, label: "Все области" }, ...scopes]} /> : null}
        </div>
        {createLabel && onCreate ? (
          <Button variant={formOpen ? "secondary" : "primary"} onClick={onCreate}>
            <Plus aria-hidden />
            {createLabel}
          </Button>
        ) : null}
      </div>
      <FilterTabs aria-label="Статус записей" value={tab} onValueChange={setTab} items={tabs.map(({ value, label }) => ({ value, label }))} panelId={panelId} />
      <div id={panelId} role="tabpanel" aria-label={active.label} className="flex flex-col gap-4">
        {list.status === "LoadingFirstPage" ? (
          <OfficeStatePage state={{ kind: "loading" }} />
        ) : list.results.length === 0 && unfiltered && list.status === "Exhausted" ? (
          <div className="rounded-card border border-border bg-card">
            <OfficeStatePage
              state={{
                kind: "empty",
                title: emptyTitle,
                description: emptyDescription,
                action:
                  createLabel && onCreate ? (
                    <Button variant="secondary" onClick={onCreate}>
                      {createLabel}
                    </Button>
                  ) : undefined,
              }}
            />
          </div>
        ) : (
          <>
            <p className="text-caption text-muted-foreground">{recordCount(list.results.length)}</p>
            <DataTable
              caption={caption}
              columns={columns}
              rows={list.results}
              getRowId={(row) => row.externalId}
              selectedId={selectedId}
              onRowClick={(row) => onSelect(row.externalId)}
              empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Ничего не найдено по выбранным фильтрам</p>}
              loadMore={loadMoreFromPaginated(list, PLATFORM_RECORDS_PAGE_SIZE)}
            />
          </>
        )}
      </div>
    </div>
  )
}

/** The card while the record loads, or when it is missing / outside the scope. */
export function MissingRecordPanel({ title, missing, onClose }: { title: string; missing: boolean; onClose: () => void }) {
  return (
    <RightPanel
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={title}
    >
      {missing ? <EmptyState title="Запись не найдена" description="Возможно, она относится к ресторану вне вашего доступа или ссылка устарела." /> : <OfficeStatePage state={{ kind: "loading" }} />}
    </RightPanel>
  )
}

const ACTION_TEXT: Record<PlatformAction, { label: string; done: string }> = {
  publish: { label: "Опубликовать", done: "Опубликовано" },
  deactivate: { label: "Отключить", done: "Запись отключена" },
  activate: { label: "Включить", done: "Запись включена" },
  expire: { label: "Завершить", done: "Завершено" },
}

type PlatformAction = "publish" | "deactivate" | "activate" | "expire"

/**
 * Status actions of a card, hidden without the edit right: publish lifecycle — «Опубликовать» a draft or
 * an inactive version, «Снять с публикации» a published one, «Новая версия» from a published or inactive
 * one; master — «Отключить» / «Включить».
 */
export function PlatformStatusActions({ moduleId, record, disabled, onNewVersion, publishHint }: { moduleId: PlatformModuleId; record: PlatformRecord; disabled?: boolean; onNewVersion?: () => void; publishHint?: ReactNode }) {
  const canEdit = useCan(`office.${moduleId}.edit`)
  const { transition } = usePlatformRecordMutations()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!canEdit) return null

  async function run(action: PlatformAction) {
    setBusy(true)
    setError(null)
    try {
      await transition({ moduleId, externalId: record.externalId, action, expectedVersion: record.version })
      toast(ACTION_TEXT[action].done, "success")
      setConfirming(false)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось изменить статус"))
    } finally {
      setBusy(false)
    }
  }

  const master = record.status === "active" || (record.status === "inactive" && moduleId === "equipment")
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {master ? (
          record.status === "active" ? (
            <Button variant="danger" size="sm" disabled={busy || disabled} onClick={() => setConfirming(true)}>
              Отключить
            </Button>
          ) : (
            <Button variant="secondary" size="sm" disabled={busy || disabled} onClick={() => void run("activate")}>
              Включить
            </Button>
          )
        ) : (
          <>
            {record.status === "draft" || record.status === "inactive" ? (
              <Button variant="secondary" size="sm" disabled={busy || disabled} onClick={() => void run("publish")}>
                {record.status === "inactive" ? "Опубликовать снова" : "Опубликовать"}
              </Button>
            ) : null}
            {record.status === "published" ? (
              <Button variant="danger" size="sm" disabled={busy || disabled} onClick={() => setConfirming(true)}>
                Снять с публикации
              </Button>
            ) : null}
            {onNewVersion && record.status !== "draft" ? (
              <Button variant="ghost" size="sm" disabled={busy || disabled} onClick={onNewVersion}>
                Новая версия
              </Button>
            ) : null}
          </>
        )}
      </div>
      {publishHint && record.status === "draft" ? <p className="text-caption text-muted-foreground">{publishHint}</p> : null}
      {error && !confirming ? (
        <p role="alert" className="text-body-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={master ? "Отключить запись?" : "Снять с публикации?"}
        description={master ? "Отключённое оборудование пропадёт из маршрутизации и списков выбора; история сохранится." : "Касса вернётся к предыдущему правилу: версии другой области или встроенному значению."}
        confirmLabel={master ? "Отключить" : "Снять с публикации"}
        submitting={busy}
        error={error}
        onConfirm={() => run("deactivate")}
      />
    </div>
  )
}
