import { Plus } from "lucide-react"
import { useId, useMemo, useState, type FormEvent } from "react"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { OfficeStatePage } from "@/office/components/state-page"
import { Banner, Button, DataTable, Field, FilterTabs, Input, SegmentedControl, Select, StatusPill, Switch, useToast, type Column } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

import { useCorporationScope, useOrganizationMutations, useOrganizations, type OrganizationRow } from "../data/use-corporation"
import {
  CURRENCY_LABELS,
  isCurrency,
  isFromIiko,
  isValidKzBin,
  JURISDICTION_LABELS,
  MASTER_TABS,
  matchesSearch,
  matchesStatus,
  recordCount,
  timezoneOptions,
  type Currency,
  type Jurisdiction,
  type StatusTab,
} from "../model/corporation"
import { ActiveSwitch, EditorBlock, Facts, IIKO_READ_ONLY_HINT, SearchBox, WithErrorBoundary } from "./corporation-parts"

const CURRENCY_OPTIONS = (Object.keys(CURRENCY_LABELS) as Currency[]).map((value) => ({ value, label: CURRENCY_LABELS[value] }))
const JURISDICTION_OPTIONS = (Object.keys(JURISDICTION_LABELS) as Jurisdiction[]).map((value) => ({ value, label: JURISDICTION_LABELS[value] }))

const COLUMNS: Column<OrganizationRow>[] = [
  {
    key: "name",
    header: "Название",
    cell: (row) => (
      <span className="flex flex-col">
        <span className="font-semibold">{row.name}</span>
        {row.legalName && row.legalName !== row.name ? <span className="text-caption text-muted-foreground">{row.legalName}</span> : null}
      </span>
    ),
    sortValue: (row) => row.name,
  },
  { key: "bin", header: "БИН", cell: (row) => <span className="tabular-nums">{row.bin ?? "—"}</span>, sortValue: (row) => row.bin },
  { key: "currency", header: "Валюта", cell: (row) => row.currency },
  { key: "timezone", header: "Часовой пояс", cell: (row) => row.timezone },
  {
    key: "restaurants",
    header: "Ресторанов",
    numeric: true,
    cell: (row) => (
      <span title={`Активных: ${row.activeRestaurantCount} из ${row.restaurantCount}`}>
        {row.activeRestaurantCount === row.restaurantCount ? row.restaurantCount : `${row.activeRestaurantCount} из ${row.restaurantCount}`}
      </span>
    ),
    sortValue: (row) => row.restaurantCount,
  },
  { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.active ? "active" : "inactive"} /> },
]

/** «Организации» (/office/organizations, W2-ADM-06): Domain template, master lifecycle, card in the side panel. */
export function OrganizationsWorkspace() {
  return <WithErrorBoundary>{() => <OrganizationsContent />}</WithErrorBoundary>
}

type Selection = { kind: "new" } | { kind: "edit"; externalId: string } | null

function OrganizationsContent() {
  const [tab, setTab] = useState<StatusTab>("all")
  const [search, setSearch] = useState("")
  const [selection, setSelection] = useState<Selection>(null)
  const canEdit = useCan("office.organizations.edit")
  const scope = useCorporationScope()
  const panelId = useId()
  const list = useOrganizations()
  const rows = useMemo(() => (list ?? []).filter((row) => matchesStatus(row.active, tab) && matchesSearch(search, row.name, row.legalName, row.bin, row.externalId)), [list, tab, search])
  const selected = selection?.kind === "edit" ? list?.find((row) => row.externalId === selection.externalId) : undefined
  const panelOpen = selection?.kind === "new" || selected !== undefined
  // Only a network user may create an organization (the server checks it too).
  const canCreate = canEdit && scope.network
  const openNew = () => setSelection({ kind: "new" })
  const tabs = MASTER_TABS.map((item) => ({ ...item, count: list ? list.filter((row) => matchesStatus(row.active, item.value)).length : undefined }))

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
        {canCreate ? (
          <div className="flex justify-end">
            <Button variant={panelOpen ? "secondary" : "primary"} onClick={openNew}>
              <Plus aria-hidden />
              Новая организация
            </Button>
          </div>
        ) : null}
        <FilterTabs aria-label="Статус организации" value={tab} onValueChange={(value) => setTab(value as StatusTab)} items={tabs} panelId={panelId} />
        <div id={panelId} role="tabpanel" aria-label={MASTER_TABS.find((item) => item.value === tab)?.label} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <SearchBox label="Поиск организаций" placeholder="Поиск: название, БИН" value={search} onChange={setSearch} />
            <span className="ml-auto text-caption text-muted-foreground">{list ? recordCount(rows.length) : ""}</span>
          </div>
          {list === undefined ? (
            <OfficeStatePage state={{ kind: "loading" }} />
          ) : list.length === 0 ? (
            <OfficeStatePage
              state={{
                kind: "empty",
                title: "Организаций пока нет",
                description: "Организации приходят из iiko или создаются здесь.",
                action: canCreate ? (
                  <Button variant="secondary" onClick={openNew}>
                    Новая организация
                  </Button>
                ) : undefined,
              }}
            />
          ) : (
            <DataTable
              caption="Организации"
              columns={COLUMNS}
              rows={rows}
              getRowId={(row) => row.externalId}
              onRowClick={(row) => setSelection({ kind: "edit", externalId: row.externalId })}
              selectedId={selected?.externalId ?? null}
              empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Нет организаций по выбранным фильтрам</p>}
            />
          )}
        </div>
      </div>
      <RightPanel
        open={panelOpen}
        onOpenChange={(open) => {
          if (!open) setSelection(null)
        }}
        title={selected ? selected.name : "Новая организация"}
        footer={
          canEdit ? (
            <Button type="submit" form="organization-editor">
              Сохранить
            </Button>
          ) : undefined
        }
      >
        {panelOpen ? (
          <OrganizationEditor
            key={selected ? `${selected.externalId}:${selected.version ?? 0}` : "new"}
            organization={selected ?? null}
            canEdit={canEdit}
            onCreated={(externalId) => setSelection({ kind: "edit", externalId })}
          />
        ) : null}
      </RightPanel>
    </div>
  )
}

type FieldErrors = Partial<Record<"name" | "bin", string>>

export function OrganizationEditor({ organization, canEdit, onCreated }: { organization: OrganizationRow | null; canEdit: boolean; onCreated: (externalId: string) => void }) {
  const { saveOrganization, setOrganizationActive } = useOrganizationMutations()
  const toast = useToast()
  const [name, setName] = useState(organization?.name ?? "")
  const [legalName, setLegalName] = useState(organization?.legalName ?? "")
  const [bin, setBin] = useState(organization?.bin ?? "")
  const [currency, setCurrency] = useState<Currency>(isCurrency(organization?.currency) ? organization.currency : "KZT")
  const [timezone, setTimezone] = useState(organization?.timezone ?? "Asia/Almaty")
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>(organization?.jurisdiction ?? "KZ")
  const [vatPayer, setVatPayer] = useState(organization?.vatPayer ?? false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const readOnly = !canEdit
  const fromIiko = isFromIiko(organization)
  const sourceLocked = readOnly || fromIiko
  const sourceHint = fromIiko ? IIKO_READ_ONLY_HINT : undefined

  function validate(): FieldErrors {
    const next: FieldErrors = {}
    if (!name.trim()) next.name = "Укажите название организации"
    const trimmed = bin.trim()
    if (trimmed && jurisdiction === "KZ" && !isValidKzBin(trimmed)) next.bin = "БИН / ИИН — 12 цифр, контрольная цифра не сходится"
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
      const externalId = await saveOrganization({
        ...(organization ? { externalId: organization.externalId, expectedVersion: organization.version ?? 0 } : {}),
        name: name.trim(),
        legalName: legalName.trim() || undefined,
        bin: bin.trim() || undefined,
        currency,
        timezone,
        jurisdiction,
        vatPayer,
      })
      toast("Организация сохранена", "success")
      if (!organization) onCreated(externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить организацию"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form id="organization-editor" aria-label="Организация" noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-6">
      {fromIiko ? (
        <Banner tone="info" title="Организация из iiko">
          Название, валюта и часовой пояс приходят из iiko и здесь не меняются. Здесь заполняются БИН, юридическое название, юрисдикция и НДС.
        </Banner>
      ) : null}
      {error ? (
        <Banner tone="danger" title="Не удалось сохранить">
          {error}
        </Banner>
      ) : null}

      <EditorBlock title="Основные реквизиты">
        {organization ? <Field label="Код организации">{(control) => <Input {...control} value={organization.externalId} readOnly />}</Field> : null}
        <Field label="Название" error={errors.name} hint={sourceHint}>
          {(control) => <Input {...control} value={name} onChange={(event) => setName(event.target.value)} disabled={sourceLocked} autoComplete="off" />}
        </Field>
        <Field label="Юридическое название">
          {(control) => <Input {...control} value={legalName} onChange={(event) => setLegalName(event.target.value)} disabled={readOnly} autoComplete="off" placeholder="ТОО «…»" />}
        </Field>
        <Field label="БИН / ИИН" error={errors.bin} hint={jurisdiction === "KZ" ? "12 цифр с контрольной цифрой" : undefined}>
          {(control) => (
            <Input
              {...control}
              value={bin}
              onChange={(event) => setBin(event.target.value.replace(/\s+/g, ""))}
              disabled={readOnly}
              inputMode="numeric"
              maxLength={12}
              autoComplete="off"
              className="tabular-nums"
            />
          )}
        </Field>
      </EditorBlock>

      <EditorBlock title="Параметры">
        <Field label="Валюта" hint={sourceHint}>
          {(control) => <Select {...control} value={currency} onValueChange={(value) => setCurrency(value as Currency)} disabled={sourceLocked} options={CURRENCY_OPTIONS} />}
        </Field>
        <Field label="Часовой пояс" hint={sourceHint}>
          {(control) => (
            <Select {...control} value={timezone} onValueChange={setTimezone} disabled={sourceLocked} options={timezoneOptions(organization?.timezone)} />
          )}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-body-sm font-medium text-muted-foreground">Юрисдикция</span>
          {readOnly ? (
            <p className="text-body-sm text-foreground">{JURISDICTION_LABELS[jurisdiction]}</p>
          ) : (
            <SegmentedControl aria-label="Юрисдикция" value={jurisdiction} onValueChange={setJurisdiction} options={JURISDICTION_OPTIONS} />
          )}
        </div>
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="organization-vat" className="flex flex-col text-body-sm font-medium text-foreground">
            Плательщик НДС
            <span className="text-caption font-normal text-muted-foreground">Себестоимость прихода считается без НДС</span>
          </label>
          <Switch id="organization-vat" checked={vatPayer} disabled={readOnly} onCheckedChange={setVatPayer} />
        </div>
        {organization ? (
          <ActiveSwitch
            id="organization-active"
            label="Организация активна"
            active={organization.active}
            disabled={readOnly}
            confirmTitle="Отключить организацию?"
            confirmDescription={`«${organization.name}» пропадёт из выбора в новых документах. Сначала нужно отключить её рестораны.`}
            onChange={async (active) => {
              await setOrganizationActive({ externalId: organization.externalId, active })
              toast(active ? "Организация включена" : "Организация отключена", "success")
            }}
          />
        ) : null}
      </EditorBlock>

      {organization ? (
        <EditorBlock title="Проведение и аудит">
          <Facts
            items={[
              ["Источник", fromIiko ? "iiko" : "OASIS Gastro"],
              ["Ресторанов", `${organization.activeRestaurantCount} активных из ${organization.restaurantCount}`],
              ["Версия записи", <span className="tabular-nums">{organization.version ?? 0}</span>],
            ]}
          />
        </EditorBlock>
      ) : null}
      {submitting ? (
        <p className="sr-only" role="status">
          Сохранение…
        </p>
      ) : null}
    </form>
  )
}
