import { Plus, Send } from "lucide-react"
import { useId, useMemo, useState, type FormEvent } from "react"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { OfficeStatePage } from "@/office/components/state-page"
import { SearchBox } from "@/office/features/corporation/ui/corporation-parts"
import { PlatformErrorBoundary, usePlatformScope } from "@/office/features/platform/data/use-platform"
import { Banner, Button, Combobox, ConfirmDialog, DataTable, Field, FilterTabs, Input, Select, StatusPill, useToast, type Column } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import { useExternalMenu, useExternalMenuMutations, useExternalMenus, type ExternalMenuCard, type ExternalMenuChannel, type ExternalMenuMode, type ExternalMenuRow } from "../data/use-integrations"
import { CHANNEL_LABELS, EXTERNAL_MENU_TABS, MODE_LABELS, type ExternalMenuTab } from "../model/cloud-api"
import { ExternalMenuVersions } from "./external-menu-versions"

// «Внешнее меню» (/office/external-menu, W3-INT-04, office/73): publication channels of the menu for
// sandyq.kz (decision Г-9) — the Register with lifecycle tabs, the card in the side panel with
// «Опубликовать меню», the version history and a preview of what the website receives.

const FORM_ID = "external-menu-editor"
const ALL_RESTAURANTS = "*"
const CHANNEL_OPTIONS = (Object.keys(CHANNEL_LABELS) as ExternalMenuChannel[]).map((value) => ({ value, label: CHANNEL_LABELS[value] }))
const MODE_OPTIONS = (Object.keys(MODE_LABELS) as ExternalMenuMode[]).map((value) => ({ value, label: MODE_LABELS[value] }))

export function ExternalMenuWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <ExternalMenuContent />
    </PlatformErrorBoundary>
  )
}

type Selection = { kind: "new" } | { kind: "edit"; externalId: string } | null

function ExternalMenuContent() {
  const [tab, setTab] = useState<ExternalMenuTab>("all")
  const [search, setSearch] = useState("")
  const [selection, setSelection] = useState<Selection>(null)
  const panelId = useId()
  const canEdit = useCan("office.external-menu.edit")
  const scope = usePlatformScope()
  const rows = useExternalMenus(tab === "all" ? undefined : tab)
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ru")
    return rows?.filter((row) => !needle || `${row.number} ${row.name}`.toLocaleLowerCase("ru").includes(needle))
  }, [rows, search])

  const restaurantsLabel = (ids: string[]) => (ids.includes(ALL_RESTAURANTS) ? "Все рестораны" : ids.map((id) => scope.restaurantName(id)).join(", "))
  const columns: Column<ExternalMenuRow>[] = [
    { key: "number", header: "Номер", cell: (row) => <span className="font-semibold">{row.number}</span>, sortValue: (row) => row.number },
    { key: "name", header: "Название", cell: (row) => <span className="flex flex-col"><span className="font-medium">{row.name}</span><span className="text-caption text-muted-foreground">{restaurantsLabel(row.restaurantExternalIds)}</span></span>, sortValue: (row) => row.name },
    { key: "channel", header: "Канал", cell: (row) => CHANNEL_LABELS[row.channel] },
    { key: "mode", header: "Режим", cell: (row) => MODE_LABELS[row.mode] },
    { key: "version", header: "Версия меню", cell: (row) => (row.mode === "live" ? <span className="text-muted-foreground">Живое</span> : row.latestVersion ? <code className="font-mono text-caption">{row.latestVersion}</code> : <span className="text-muted-foreground">—</span>) },
    { key: "published", header: "Последняя публикация", numeric: true, cell: (row) => <span className="whitespace-nowrap text-muted-foreground">{row.publishedAt ? formatAlmatyDateTime(row.publishedAt) : "—"}</span>, sortValue: (row) => row.publishedAt ?? 0 },
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.status} /> },
  ]

  const selectedId = selection?.kind === "edit" ? selection.externalId : null
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FilterTabs aria-label="Статус публикации" value={tab} onValueChange={(value) => setTab(value as ExternalMenuTab)} items={EXTERNAL_MENU_TABS.map((item) => ({ value: item.value, label: item.label }))} panelId={panelId} className="overflow-x-auto" />
          {canEdit ? (
            <Button onClick={() => setSelection({ kind: "new" })}>
              <Plus aria-hidden />
              Новая запись
            </Button>
          ) : null}
        </div>
        <div id={panelId} role="tabpanel" aria-label={EXTERNAL_MENU_TABS.find((item) => item.value === tab)?.label} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <SearchBox label="Поиск: внешнее меню" placeholder="Поиск: внешнее меню" value={search} onChange={setSearch} />
            {filtered ? <span className="text-caption text-muted-foreground tabular-nums">{filtered.length} записей</span> : null}
          </div>
          {rows === undefined ? (
            <OfficeStatePage state={{ kind: "loading" }} />
          ) : rows.length === 0 && tab === "all" ? (
            <OfficeStatePage state={{ kind: "empty", title: "Публикаций пока нет", description: "Пока меню не опубликовано, сайт получает живое меню каталога." }} />
          ) : (
            <DataTable
              caption="Внешнее меню"
              columns={columns}
              rows={filtered}
              getRowId={(row) => row.externalId}
              onRowClick={(row) => setSelection({ kind: "edit", externalId: row.externalId })}
              selectedId={selectedId}
              empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Нет записей по выбранным фильтрам</p>}
            />
          )}
        </div>
      </div>
      <ExternalMenuPanel key={selectedId ?? selection?.kind ?? "none"} selection={selection} onClose={() => setSelection(null)} onCreated={(externalId) => setSelection({ kind: "edit", externalId })} />
    </div>
  )
}

function ExternalMenuPanel({ selection, onClose, onCreated }: { selection: Selection; onClose: () => void; onCreated: (externalId: string) => void }) {
  const card = useExternalMenu(selection?.kind === "edit" ? selection.externalId : null)
  const canEdit = useCan("office.external-menu.edit")
  const canApprove = useCan("office.external-menu.approve")
  const { publishExternalMenu, deactivateExternalMenu } = useExternalMenuMutations()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)
  const loading = selection?.kind === "edit" && card === undefined

  async function publish() {
    if (!card) return
    setBusy(true)
    setError(null)
    try {
      const result = await publishExternalMenu({ recordExternalId: card.externalId, expectedVersion: card.version })
      toast(card.mode === "live" ? "Живое меню опубликовано" : `Публикация запущена: ресторанов ${result.restaurants}`, "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось опубликовать меню"))
    } finally {
      setBusy(false)
    }
  }

  async function deactivate() {
    if (!card) return
    try {
      await deactivateExternalMenu({ recordExternalId: card.externalId, expectedVersion: card.version })
      toast("Меню снято с публикации", "success")
      setConfirmDeactivate(false)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось снять меню с публикации"))
      setConfirmDeactivate(false)
    }
  }

  return (
    <RightPanel
      open={selection !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={card ? `${card.number} · ${card.name}` : "Новая публикация"}
      footer={
        <>
          {card && canApprove && card.status === "published" ? (
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmDeactivate(true)}>
              Снять с публикации
            </Button>
          ) : null}
          {canEdit ? (
            <Button variant={card && canApprove ? "secondary" : "primary"} type="submit" form={FORM_ID}>
              Сохранить
            </Button>
          ) : null}
          {card && canApprove ? (
            <Button disabled={busy} onClick={() => void publish()}>
              <Send aria-hidden />
              Опубликовать меню
            </Button>
          ) : null}
        </>
      }
    >
      {loading ? (
        <OfficeStatePage state={{ kind: "loading" }} />
      ) : selection?.kind === "edit" && card === null ? (
        <OfficeStatePage state={{ kind: "empty", title: "Запись не найдена" }} />
      ) : (
        <div className="flex flex-col gap-6">
          {error ? (
            <Banner tone="danger" title="Не удалось выполнить действие">
              {error}
            </Banner>
          ) : null}
          {card ? (
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill domain="document" status={card.status} />
              {card.publishedAt ? <span className="text-caption text-muted-foreground">Опубликовано {formatAlmatyDateTime(card.publishedAt)}{card.publishedBy ? ` · ${card.publishedBy}` : ""}</span> : null}
            </div>
          ) : null}
          <ExternalMenuEditor key={card?.version ?? "new"} card={card ?? null} readOnly={!canEdit} onCreated={onCreated} />
          {card ? <ExternalMenuVersions card={card} /> : null}
        </div>
      )}
      <ConfirmDialog
        open={confirmDeactivate}
        onOpenChange={setConfirmDeactivate}
        title="Снять меню с публикации?"
        description="Сайт перейдёт на живое меню каталога. Версии останутся в истории."
        confirmLabel="Снять с публикации"
        danger
        onConfirm={() => deactivate()}
      />
    </RightPanel>
  )
}

type EditorErrors = Partial<Record<"name" | "restaurants", string>>

function ExternalMenuEditor({ card, readOnly, onCreated }: { card: ExternalMenuCard | null; readOnly: boolean; onCreated: (externalId: string) => void }) {
  const scope = usePlatformScope()
  const { saveExternalMenu } = useExternalMenuMutations()
  const toast = useToast()
  const [name, setName] = useState(card?.name ?? "Публикация sandyq.kz")
  const [channel, setChannel] = useState<ExternalMenuChannel>(card?.channel ?? "website")
  const [mode, setMode] = useState<ExternalMenuMode>(card?.mode ?? "published")
  const [restaurants, setRestaurants] = useState<string[]>(card?.restaurantExternalIds ?? (scope.network ? [ALL_RESTAURANTS] : []))
  const [errors, setErrors] = useState<EditorErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const restaurantOptions = [...(scope.network ? [{ value: ALL_RESTAURANTS, label: "Все рестораны" }] : []), ...restaurantSelectOptions(scope.restaurants)]
  for (const id of restaurants) if (!restaurantOptions.some((option) => option.value === id)) restaurantOptions.push({ value: id, label: id === ALL_RESTAURANTS ? "Все рестораны" : id })

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (readOnly || submitting) return
    const found: EditorErrors = {}
    if (name.trim().length < 3) found.name = "Укажите название публикации"
    if (restaurants.length === 0) found.restaurants = "Выберите рестораны"
    else if (restaurants.includes(ALL_RESTAURANTS) && restaurants.length > 1) found.restaurants = "«Все рестораны» не сочетаются с отдельными ресторанами"
    setErrors(found)
    if (Object.keys(found).length) return
    setSubmitting(true)
    setError(null)
    try {
      const externalId = await saveExternalMenu({ ...(card ? { externalId: card.externalId, expectedVersion: card.version } : {}), name: name.trim(), channel, mode, restaurantExternalIds: restaurants })
      toast("Запись сохранена", "success")
      if (!card) onCreated(externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить запись"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form id={FORM_ID} aria-label="Публикация меню" noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
      {error ? (
        <Banner tone="danger" title="Не удалось сохранить">
          {error}
        </Banner>
      ) : null}
      <Field label="Название" error={errors.name}>
        {(control) => <Input {...control} autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} disabled={readOnly} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Канал" hint="Первый потребитель — сайт sandyq.kz">
          {(control) => <Select {...control} value={channel} onValueChange={(value) => setChannel(value as ExternalMenuChannel)} options={CHANNEL_OPTIONS} disabled={readOnly} />}
        </Field>
        <Field label="Режим" hint={mode === "live" ? "Сайт получает текущий каталог и цены" : "Сайт получает последнюю опубликованную версию"}>
          {(control) => <Select {...control} value={mode} onValueChange={(value) => setMode(value as ExternalMenuMode)} options={MODE_OPTIONS} disabled={readOnly} />}
        </Field>
      </div>
      <Field label="Рестораны" error={errors.restaurants}>
        {(control) => <Combobox {...control} multiple value={restaurants} onValueChange={setRestaurants} options={restaurantOptions} disabled={readOnly} placeholder="Выберите рестораны" searchPlaceholder="Ресторан" />}
      </Field>
    </form>
  )
}
