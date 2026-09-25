import { Plus } from "lucide-react"
import { useId, useState, type FormEvent, type ReactNode } from "react"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { OfficeStatePage } from "@/office/components/state-page"
import {
  Banner,
  Button,
  DataTable,
  Field,
  FilterTabs,
  Input,
  loadMoreFromPaginated,
  SegmentedControl,
  Select,
  StatusPill,
  Switch,
  useToast,
  type Column,
  type SegmentOption,
} from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import { PLATFORM_PAGE_SIZE, PlatformErrorBoundary, usePlatformMutations, usePlatformScope, useTerminals, type TerminalKind, type TerminalRow } from "../data/use-platform"

const ALL = "all"

type StatusTab = "all" | "active" | "inactive"

const TABS: { value: StatusTab; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "active", label: "Активные" },
  { value: "inactive", label: "Неактивные" },
]

export const TERMINAL_KIND_LABELS: Record<TerminalKind, string> = { pos: "Касса", kds: "Экран кухни", office: "Офис", delivery: "Доставка" }

const KIND_OPTIONS: SegmentOption<TerminalKind>[] = (Object.keys(TERMINAL_KIND_LABELS) as TerminalKind[]).map((value) => ({ value, label: TERMINAL_KIND_LABELS[value] }))

const COLUMNS: Column<TerminalRow>[] = [
  { key: "name", header: "Название", cell: (row) => <span className="font-semibold">{row.name}</span>, sortValue: (row) => row.name },
  { key: "restaurant", header: "Ресторан", cell: (row) => row.restaurantName, sortValue: (row) => row.restaurantName },
  { key: "number", header: "Номер", numeric: true, cell: (row) => row.terminalNumber, sortValue: (row) => row.terminalNumber },
  { key: "kind", header: "Назначение", cell: (row) => TERMINAL_KIND_LABELS[row.kind] },
  { key: "lastLogin", header: "Последний вход", cell: (row) => (row.lastLoginAt ? formatAlmatyDateTime(row.lastLoginAt) : "—"), sortValue: (row) => row.lastLoginAt },
  { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.active ? "active" : "inactive"} /> },
]

/** «Терминалы» (/office/terminals, W1-ADM-02): the terminal register on the Domain template, master lifecycle. */
export function TerminalsWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <TerminalsContent />
    </PlatformErrorBoundary>
  )
}

type Selection = { kind: "new" } | { kind: "edit"; externalId: string } | null

function TerminalsContent() {
  const [tab, setTab] = useState<StatusTab>("all")
  const [restaurant, setRestaurant] = useState(ALL)
  const [selection, setSelection] = useState<Selection>(null)
  const scope = usePlatformScope()
  const canEdit = useCan("office.terminals.edit")
  const panelId = useId()
  const list = useTerminals({ restaurantExternalId: restaurant === ALL ? undefined : restaurant, status: tab === "all" ? undefined : tab })
  const loading = list.status === "LoadingFirstPage"
  const selected = selection?.kind === "edit" ? list.results.find((row) => row.externalId === selection.externalId) : undefined
  const panelOpen = selection?.kind === "new" || selected !== undefined
  const unfiltered = tab === "all" && restaurant === ALL
  const openNew = () => setSelection({ kind: "new" })

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
        {canEdit ? (
          <div className="flex justify-end">
            <Button onClick={openNew}>
              <Plus aria-hidden />
              Новый терминал
            </Button>
          </div>
        ) : null}
        <FilterTabs aria-label="Статус терминала" value={tab} onValueChange={(value) => setTab(value as StatusTab)} items={TABS} panelId={panelId} />
        <div id={panelId} role="tabpanel" aria-label={TABS.find((item) => item.value === tab)?.label} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              aria-label="Ресторан"
              className="w-full sm:w-72"
              value={restaurant}
              onValueChange={setRestaurant}
              options={[{ value: ALL, label: "Все рестораны" }, ...restaurantSelectOptions(scope.restaurants)]}
            />
            <span className="ml-auto text-caption text-muted-foreground">{loading ? "" : `Записей: ${list.results.length}`}</span>
          </div>
          {loading ? (
            <OfficeStatePage state={{ kind: "loading" }} />
          ) : list.results.length === 0 && unfiltered && list.status === "Exhausted" ? (
            <OfficeStatePage
              state={{
                kind: "empty",
                title: "Терминалов пока нет",
                description: "Добавьте кассу или экран кухни для ресторана.",
                action: canEdit ? (
                  <Button variant="secondary" onClick={openNew}>
                    Новый терминал
                  </Button>
                ) : undefined,
              }}
            />
          ) : (
            <DataTable
              caption="Терминалы"
              columns={COLUMNS}
              rows={list.results}
              getRowId={(row) => row.externalId}
              onRowClick={(row) => setSelection({ kind: "edit", externalId: row.externalId })}
              selectedId={selected?.externalId ?? null}
              empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Нет терминалов по выбранным фильтрам</p>}
              loadMore={loadMoreFromPaginated(list, PLATFORM_PAGE_SIZE)}
            />
          )}
        </div>
      </div>
      <RightPanel
        open={panelOpen}
        onOpenChange={(open) => {
          if (!open) setSelection(null)
        }}
        title={selected ? selected.name : "Новый терминал"}
        footer={
          canEdit ? (
            <Button type="submit" form="terminal-editor">
              Сохранить
            </Button>
          ) : undefined
        }
      >
        {panelOpen ? (
          <TerminalEditor
            key={selected?.externalId ?? "new"}
            terminal={selected ?? null}
            restaurants={scope.restaurants}
            defaultRestaurant={restaurant === ALL ? scope.restaurants[0]?.externalId : restaurant}
            canEdit={canEdit}
            onCreated={() => setSelection(null)}
          />
        ) : null}
      </RightPanel>
    </div>
  )
}

type FieldErrors = Partial<Record<"name" | "restaurant" | "number", string>>

function TerminalEditor({
  terminal,
  restaurants,
  defaultRestaurant,
  canEdit,
  onCreated,
}: {
  terminal: TerminalRow | null
  restaurants: { externalId: string; name: string }[]
  defaultRestaurant: string | undefined
  canEdit: boolean
  onCreated: () => void
}) {
  const { saveTerminal, setTerminalActive } = usePlatformMutations()
  const toast = useToast()
  const [name, setName] = useState(terminal?.name ?? "")
  const [restaurantExternalId, setRestaurantExternalId] = useState<string | undefined>(terminal?.restaurantExternalId ?? defaultRestaurant)
  const [number, setNumber] = useState(terminal ? String(terminal.terminalNumber) : "")
  const [kind, setKind] = useState<TerminalKind>(terminal?.kind ?? "pos")
  const [appVersion, setAppVersion] = useState(terminal?.appVersion ?? "")
  const [heartbeatUrl, setHeartbeatUrl] = useState(terminal?.heartbeatUrl ?? "")
  const [errors, setErrors] = useState<FieldErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [togglingActive, setTogglingActive] = useState(false)

  const readOnly = !canEdit
  const fromIiko = terminal?.sourceReadOnly ?? false
  const restaurantOptions = terminal && !restaurants.some((item) => item.externalId === terminal.restaurantExternalId)
    ? [{ externalId: terminal.restaurantExternalId, name: terminal.restaurantName }, ...restaurants]
    : restaurants

  function validate(): FieldErrors {
    const next: FieldErrors = {}
    if (!name.trim()) next.name = "Укажите название терминала"
    if (!restaurantExternalId) next.restaurant = "Выберите ресторан"
    const parsed = Number(number)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 999) next.number = "Номер терминала — целое число от 1 до 999"
    return next
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (readOnly || submitting) return
    setError(null)
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setSubmitting(true)
    try {
      await saveTerminal({
        ...(terminal ? { externalId: terminal.externalId, expectedVersion: terminal.version } : {}),
        restaurantExternalId: restaurantExternalId!,
        name: name.trim(),
        terminalNumber: Number(number),
        kind,
        appVersion: appVersion.trim() || undefined,
        heartbeatUrl: heartbeatUrl.trim() || undefined,
      })
      toast("Терминал сохранён", "success")
      if (!terminal) onCreated()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить терминал"))
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleActive(active: boolean) {
    if (!terminal) return
    setTogglingActive(true)
    setError(null)
    try {
      await setTerminalActive({ externalId: terminal.externalId, active })
      toast(active ? "Терминал включён" : "Терминал отключён", "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось изменить статус терминала"))
    } finally {
      setTogglingActive(false)
    }
  }

  return (
    <form id="terminal-editor" aria-label="Терминал" noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-6">
      {fromIiko ? (
        <Banner tone="info" title="Терминал из iiko">
          Название и номер приходят из iiko и меняются только там. Здесь настраиваются назначение и параметры.
        </Banner>
      ) : null}
      {error ? (
        <Banner tone="danger" title="Не удалось сохранить">
          {error}
        </Banner>
      ) : null}

      <EditorBlock title="Основные реквизиты">
        {terminal ? <Field label="Код">{(control) => <Input {...control} value={terminal.externalId} readOnly />}</Field> : null}
        <Field label="Название" error={errors.name}>
          {(control) => <Input {...control} value={name} onChange={(event) => setName(event.target.value)} disabled={readOnly || fromIiko} autoComplete="off" />}
        </Field>
        <Field label="Ресторан" error={errors.restaurant} hint={terminal ? "Ресторан терминала менять нельзя" : undefined}>
          {(control) => (
            <Select
              {...control}
              value={restaurantExternalId}
              onValueChange={setRestaurantExternalId}
              disabled={readOnly || terminal !== null}
              placeholder="Выберите ресторан"
              options={restaurantOptions.map((item) => ({ value: item.externalId, label: item.name }))}
            />
          )}
        </Field>
        <Field label="Номер" error={errors.number}>
          {(control) => (
            <Input
              {...control}
              type="number"
              inputMode="numeric"
              min={1}
              max={999}
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              disabled={readOnly || fromIiko}
              autoComplete="off"
            />
          )}
        </Field>
      </EditorBlock>

      <EditorBlock title="Параметры">
        <div className="flex flex-col gap-1.5">
          <span className="text-body-sm font-medium text-muted-foreground">Назначение</span>
          {readOnly ? (
            <p className="text-body-sm text-foreground">{TERMINAL_KIND_LABELS[kind]}</p>
          ) : (
            <SegmentedControl aria-label="Назначение" value={kind} onValueChange={setKind} options={KIND_OPTIONS} />
          )}
        </div>
        <Field label="Версия приложения">
          {(control) => <Input {...control} value={appVersion} onChange={(event) => setAppVersion(event.target.value)} disabled={readOnly} autoComplete="off" />}
        </Field>
        <Field label="Endpoint диагностики" hint="Адрес, по которому терминал отвечает на проверку связи">
          {(control) => (
            <Input {...control} type="url" value={heartbeatUrl} onChange={(event) => setHeartbeatUrl(event.target.value)} disabled={readOnly} placeholder="https://" autoComplete="off" />
          )}
        </Field>
        {terminal ? (
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="terminal-active" className="text-body-sm font-medium text-foreground">
              Активен
            </label>
            <Switch id="terminal-active" checked={terminal.active} disabled={readOnly || togglingActive} onCheckedChange={(checked) => void toggleActive(checked)} />
          </div>
        ) : null}
      </EditorBlock>

      {terminal ? (
        <EditorBlock title="Аудит">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body-sm">
            <dt className="text-muted-foreground">Последний вход</dt>
            <dd>{terminal.lastLoginAt ? formatAlmatyDateTime(terminal.lastLoginAt) : "—"}</dd>
            <dt className="text-muted-foreground">Версия записи</dt>
            <dd className="tabular-nums">{terminal.version}</dd>
          </dl>
        </EditorBlock>
      ) : null}
      {submitting ? <p className="sr-only" role="status">Сохранение…</p> : null}
    </form>
  )
}

export function EditorBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4" aria-label={title}>
      <h3 className="text-body font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  )
}
