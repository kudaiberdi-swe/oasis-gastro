import { Plus, Search } from "lucide-react"
import { useId, useState, type ReactNode } from "react"

import { OfficeStatePage } from "@/office/components/state-page"
import { statusTabs } from "@/office/engine/module-config"
import { Button, ConfirmDialog, DataTable, FilterTabs, Input, StatusPill, useToast, type Column } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { recordCount } from "@/shared/lib/plural"

import type { ListStatus } from "../data/use-workforce-w2"

// Shared parts of the W2 references «Должности» and «Типы смен» (OFFICE-DESIGN §3.5, lifecycle master).

export const MASTER_TABS = statusTabs("master").map((tab) => ({ value: tab.key, label: tab.label }))

export const statusOfTab = (tab: string): ListStatus => (tab === "active" || tab === "inactive" ? tab : undefined)

export interface ReferenceRegisterProps<T> {
  caption: string
  rows: T[] | undefined
  columns: Column<T>[]
  getRowId: (row: T) => string
  /** Client-side search text of a row (the lists are small, ≤ 200). */
  searchText: (row: T) => string
  searchLabel: string
  tab: string
  onTabChange: (tab: string) => void
  selectedId: string | null
  onSelect: (id: string) => void
  createLabel?: string
  onCreate?: () => void
  /** The card's «Сохранить» is the one primary while it is open. */
  formOpen: boolean
  description: string
  emptyTitle: string
  emptyDescription: string
}

export function ReferenceRegister<T>({
  caption,
  rows,
  columns,
  getRowId,
  searchText,
  searchLabel,
  tab,
  onTabChange,
  selectedId,
  onSelect,
  createLabel,
  onCreate,
  formOpen,
  description,
  emptyTitle,
  emptyDescription,
}: ReferenceRegisterProps<T>) {
  const panelId = useId()
  const [search, setSearch] = useState("")
  const needle = search.trim().toLocaleLowerCase("ru")
  const visible = rows && needle ? rows.filter((row) => searchText(row).toLocaleLowerCase("ru").includes(needle)) : rows
  const unfiltered = tab === "all" && !needle

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm text-muted-foreground">{description}</p>
        {createLabel && onCreate ? (
          <Button variant={formOpen ? "secondary" : "primary"} onClick={onCreate}>
            <Plus aria-hidden />
            {createLabel}
          </Button>
        ) : null}
      </div>
      <FilterTabs aria-label={`Статус: ${caption.toLocaleLowerCase("ru")}`} value={tab} onValueChange={onTabChange} panelId={panelId} items={MASTER_TABS} />
      <div id={panelId} role="tabpanel" aria-label={MASTER_TABS.find((item) => item.value === tab)?.label} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative w-full sm:w-[420px]">
            <span className="sr-only">{searchLabel}</span>
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={searchLabel} className="pl-9" />
          </label>
          <span className="ml-auto text-caption text-muted-foreground">{visible ? recordCount(visible.length) : ""}</span>
        </div>
        {visible === undefined ? (
          <OfficeStatePage state={{ kind: "loading" }} />
        ) : visible.length === 0 && unfiltered ? (
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
          <DataTable
            caption={caption}
            columns={columns}
            rows={visible}
            getRowId={getRowId}
            selectedId={selectedId}
            onRowClick={(row) => onSelect(getRowId(row))}
            empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Ничего не найдено по выбранным фильтрам</p>}
          />
        )}
      </div>
    </div>
  )
}

/** A titled block of the card: «Основные реквизиты / Параметры / Аудит». */
export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-body-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  )
}

export function ReadOnlyField({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="flex flex-col gap-1.5">
        <span className="text-body-sm font-medium text-muted-foreground">{label}</span>
        <span className="text-body-sm text-foreground">{value}</span>
      </div>
    </div>
  )
}

/** «Статус и аудит» with «Отключить» (confirmed) / «Включить»; the action is hidden without the edit right. */
export function ReferenceStatus({
  record,
  canEdit,
  disabled,
  confirmTitle,
  confirmDescription,
  onSetActive,
}: {
  record: { active: boolean; version: number; createdAt: number; updatedAt: number }
  canEdit: boolean
  disabled?: boolean
  confirmTitle: string
  confirmDescription: string
  onSetActive: (active: boolean) => Promise<unknown>
}) {
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(active: boolean) {
    setBusy(true)
    setError(null)
    try {
      await onSetActive(active)
      toast(active ? "Запись включена" : "Запись отключена", "success")
      setConfirming(false)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось изменить статус"))
    } finally {
      setBusy(false)
    }
  }

  const rows: [string, ReactNode][] = [
    ["Статус", <StatusPill domain="document" status={record.active ? "active" : "inactive"} />],
    ["Создано", formatAlmatyDateTime(record.createdAt)],
    ["Изменено", formatAlmatyDateTime(record.updatedAt)],
    ["Версия", `v${record.version}`],
  ]

  return (
    <FormSection title="Статус и аудит">
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-body-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      {canEdit ? (
        <div className="flex flex-col gap-2">
          {record.active ? (
            <Button type="button" variant="danger" size="sm" className="self-start" disabled={busy || disabled} onClick={() => setConfirming(true)}>
              Отключить
            </Button>
          ) : (
            <Button type="button" variant="secondary" size="sm" className="self-start" disabled={busy || disabled} onClick={() => void run(true)}>
              Включить
            </Button>
          )}
          {error && !confirming ? (
            <p role="alert" className="text-body-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
      <ConfirmDialog open={confirming} onOpenChange={setConfirming} title={confirmTitle} description={confirmDescription} confirmLabel="Отключить" submitting={busy} error={error} onConfirm={() => run(false)} />
    </FormSection>
  )
}
