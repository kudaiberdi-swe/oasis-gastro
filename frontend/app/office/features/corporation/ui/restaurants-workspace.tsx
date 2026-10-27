import { ArrowUpRight, Plus } from "lucide-react"
import { useId, useMemo, useState, type FormEvent } from "react"
import { Link } from "react-router"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { OfficeStatePage } from "@/office/components/state-page"
import {
  Banner,
  Button,
  buttonVariants,
  DataTable,
  Field,
  FilterTabs,
  Input,
  SegmentedControl,
  Select,
  StatusPill,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
  type Column,
} from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

import { useCorporationScope, useRestaurantMutations, useRestaurants, type RestaurantRow, type ScopeOption } from "../data/use-corporation"
import {
  CURRENCY_LABELS,
  isFromIiko,
  isServiceMode,
  MASTER_TABS,
  matchesSearch,
  matchesStatus,
  MAX_BUSINESS_DAY_CUTOFF_MINUTES,
  minutesToTime,
  recordCount,
  SERVICE_MODE_LABELS,
  timeToMinutes,
  timezoneOptions,
  type Currency,
  type ServiceMode,
  type StatusTab,
} from "../model/corporation"
import { ActiveSwitch, EditorBlock, Facts, IIKO_READ_ONLY_HINT, SearchBox, WithErrorBoundary } from "./corporation-parts"

const ALL = "all"
const INHERIT = "inherit"

const SERVICE_MODE_OPTIONS = (Object.keys(SERVICE_MODE_LABELS) as ServiceMode[]).map((value) => ({ value, label: SERVICE_MODE_LABELS[value] }))
const CURRENCY_OPTIONS = [{ value: INHERIT, label: "Как у организации" }, ...(Object.keys(CURRENCY_LABELS) as Currency[]).map((value) => ({ value, label: CURRENCY_LABELS[value] }))]
const MAX_CUTOFF = minutesToTime(MAX_BUSINESS_DAY_CUTOFF_MINUTES)

const COLUMNS: Column<RestaurantRow>[] = [
  { key: "name", header: "Название", cell: (row) => <span className="font-semibold">{row.name}</span>, sortValue: (row) => row.name },
  { key: "city", header: "Город", cell: (row) => row.city ?? "—", sortValue: (row) => row.city },
  { key: "address", header: "Адрес", cell: (row) => <span className="text-muted-foreground">{row.address || "—"}</span> },
  { key: "terminals", header: "Терминалов", numeric: true, cell: (row) => row.terminalCount, sortValue: (row) => row.terminalCount },
  { key: "warehouses", header: "Складов", numeric: true, cell: (row) => row.warehouseCount, sortValue: (row) => row.warehouseCount },
  { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.active ? "active" : "inactive"} /> },
]

/** «Рестораны» (/office/restaurants, W2-ADM-07): the register of canonical restaurants (L-10), master lifecycle. */
export function RestaurantsWorkspace() {
  return <WithErrorBoundary>{() => <RestaurantsContent />}</WithErrorBoundary>
}

type Selection = { kind: "new" } | { kind: "edit"; externalId: string } | null

function RestaurantsContent() {
  const [tab, setTab] = useState<StatusTab>("all")
  const [search, setSearch] = useState("")
  const [organization, setOrganization] = useState(ALL)
  const [selection, setSelection] = useState<Selection>(null)
  const canEdit = useCan("office.restaurants.edit")
  const scope = useCorporationScope()
  const panelId = useId()
  const list = useRestaurants({ organizationExternalId: organization === ALL ? undefined : organization })
  const rows = useMemo(() => (list ?? []).filter((row) => matchesStatus(row.active, tab) && matchesSearch(search, row.name, row.city, row.address, row.externalId)), [list, tab, search])
  const selected = selection?.kind === "edit" ? list?.find((row) => row.externalId === selection.externalId) : undefined
  const panelOpen = selection?.kind === "new" || selected !== undefined
  const canCreate = canEdit && scope.organizations.length > 0
  const openNew = () => setSelection({ kind: "new" })
  const tabs = MASTER_TABS.map((item) => ({ ...item, count: list ? list.filter((row) => matchesStatus(row.active, item.value)).length : undefined }))

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
        {canCreate ? (
          <div className="flex justify-end">
            <Button variant={panelOpen ? "secondary" : "primary"} onClick={openNew}>
              <Plus aria-hidden />
              Новый ресторан
            </Button>
          </div>
        ) : null}
        <FilterTabs aria-label="Статус ресторана" value={tab} onValueChange={(value) => setTab(value as StatusTab)} items={tabs} panelId={panelId} />
        <div id={panelId} role="tabpanel" aria-label={MASTER_TABS.find((item) => item.value === tab)?.label} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <SearchBox label="Поиск ресторанов" placeholder="Поиск: название, город, адрес" value={search} onChange={setSearch} />
            {scope.organizations.length > 1 ? (
              <Select
                aria-label="Организация"
                className="w-full sm:w-64"
                value={organization}
                onValueChange={setOrganization}
                options={[{ value: ALL, label: "Все организации" }, ...scope.organizations.map((item) => ({ value: item.externalId, label: item.name }))]}
              />
            ) : null}
            <span className="ml-auto text-caption text-muted-foreground">{list ? recordCount(rows.length) : ""}</span>
          </div>
          {list === undefined ? (
            <OfficeStatePage state={{ kind: "loading" }} />
          ) : list.length === 0 && organization === ALL ? (
            <OfficeStatePage
              state={{
                kind: "empty",
                title: "Ресторанов пока нет",
                description: "Рестораны приходят из iiko или создаются здесь.",
                action: canCreate ? (
                  <Button variant="secondary" onClick={openNew}>
                    Новый ресторан
                  </Button>
                ) : undefined,
              }}
            />
          ) : (
            <DataTable
              caption="Рестораны"
              columns={COLUMNS}
              rows={rows}
              getRowId={(row) => row.externalId}
              onRowClick={(row) => setSelection({ kind: "edit", externalId: row.externalId })}
              selectedId={selected?.externalId ?? null}
              empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Нет ресторанов по выбранным фильтрам</p>}
            />
          )}
        </div>
      </div>
      <RightPanel
        open={panelOpen}
        onOpenChange={(open) => {
          if (!open) setSelection(null)
        }}
        title={selected ? selected.name : "Новый ресторан"}
        footer={
          canEdit ? (
            <Button type="submit" form="restaurant-editor">
              Сохранить
            </Button>
          ) : undefined
        }
      >
        {panelOpen ? (
          <RestaurantEditor
            key={selected ? `${selected.externalId}:${selected.version ?? 0}` : "new"}
            restaurant={selected ?? null}
            organizations={scope.organizations}
            organizationName={scope.organizationName}
            defaultOrganization={organization === ALL ? scope.organizations[0]?.externalId : organization}
            canEdit={canEdit}
            onCreated={(externalId) => setSelection({ kind: "edit", externalId })}
          />
        ) : null}
      </RightPanel>
    </div>
  )
}

type FieldErrors = Partial<Record<"name" | "organization" | "cutoff", string>>

export function RestaurantEditor({
  restaurant,
  organizations,
  organizationName,
  defaultOrganization,
  canEdit,
  onCreated,
}: {
  restaurant: RestaurantRow | null
  organizations: ScopeOption[]
  organizationName: (externalId: string | undefined | null) => string | undefined
  defaultOrganization: string | undefined
  canEdit: boolean
  onCreated: (externalId: string) => void
}) {
  const { saveRestaurant, setRestaurantActive } = useRestaurantMutations()
  const canViewExchange = useCan("office.data-exchange.view")
  const toast = useToast()
  const [organizationExternalId, setOrganizationExternalId] = useState<string | undefined>(restaurant?.organizationExternalId ?? defaultOrganization)
  const [name, setName] = useState(restaurant?.name ?? "")
  const [address, setAddress] = useState(restaurant?.address ?? "")
  const [city, setCity] = useState(restaurant?.city ?? "")
  const [timezone, setTimezone] = useState(restaurant?.timezone ?? "Asia/Almaty")
  const [currency, setCurrency] = useState(restaurant?.currency ?? INHERIT)
  const [serviceMode, setServiceMode] = useState<ServiceMode>(isServiceMode(restaurant?.serviceMode) ? restaurant.serviceMode : "table-service")
  const [cutoff, setCutoff] = useState(minutesToTime(restaurant?.businessDayCutoffMinutes))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const readOnly = !canEdit
  const fromIiko = isFromIiko(restaurant)
  const sourceLocked = readOnly || fromIiko
  const sourceHint = fromIiko ? IIKO_READ_ONLY_HINT : undefined
  const organizationOptions =
    restaurant && !organizations.some((item) => item.externalId === restaurant.organizationExternalId)
      ? [{ externalId: restaurant.organizationExternalId, name: organizationName(restaurant.organizationExternalId) ?? restaurant.organizationExternalId }, ...organizations]
      : organizations
  const currencyOptions = currency !== INHERIT && !CURRENCY_OPTIONS.some((option) => option.value === currency) ? [...CURRENCY_OPTIONS, { value: currency, label: currency }] : CURRENCY_OPTIONS

  function validate(): FieldErrors {
    const next: FieldErrors = {}
    if (!name.trim()) next.name = "Укажите название ресторана"
    if (!organizationExternalId) next.organization = "Выберите организацию"
    if (timeToMinutes(cutoff) === null) next.cutoff = `Время ЧЧ:ММ от 00:00 до ${MAX_CUTOFF}`
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
      const externalId = await saveRestaurant({
        ...(restaurant ? { externalId: restaurant.externalId, expectedVersion: restaurant.version ?? 0 } : {}),
        organizationExternalId: organizationExternalId!,
        name: name.trim(),
        address: address.trim(),
        city: city.trim() || undefined,
        timezone,
        currency: currency === INHERIT ? undefined : currency,
        serviceMode,
        businessDayCutoffMinutes: timeToMinutes(cutoff)!,
      })
      toast(restaurant ? "Ресторан сохранён" : "Ресторан создан, основной склад добавлен", "success")
      if (!restaurant) onCreated(externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить ресторан"))
    } finally {
      setSubmitting(false)
    }
  }

  const form = (
    <form id="restaurant-editor" aria-label="Ресторан" noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-6">
      {fromIiko ? (
        <Banner tone="info" title="Ресторан из iiko">
          Название, адрес, часовой пояс и организация приходят из iiko и здесь не меняются. Здесь настраиваются город, валюта, концепция и отсечка бизнес-дня.
        </Banner>
      ) : null}
      {error ? (
        <Banner tone="danger" title="Не удалось сохранить">
          {error}
        </Banner>
      ) : null}

      <EditorBlock title="Основные реквизиты">
        {restaurant ? <Field label="Код ресторана">{(control) => <Input {...control} value={restaurant.externalId} readOnly />}</Field> : null}
        <Field label="Организация" error={errors.organization} hint={sourceHint}>
          {(control) => (
            <Select
              {...control}
              value={organizationExternalId}
              onValueChange={setOrganizationExternalId}
              disabled={sourceLocked}
              placeholder="Выберите организацию"
              options={organizationOptions.map((item) => ({ value: item.externalId, label: item.name }))}
            />
          )}
        </Field>
        <Field label="Название" error={errors.name} hint={sourceHint}>
          {(control) => <Input {...control} value={name} onChange={(event) => setName(event.target.value)} disabled={sourceLocked} autoComplete="off" />}
        </Field>
        <Field label="Адрес" hint={sourceHint}>
          {(control) => <Input {...control} value={address} onChange={(event) => setAddress(event.target.value)} disabled={sourceLocked} autoComplete="off" />}
        </Field>
        <Field label="Город">
          {(control) => <Input {...control} value={city} onChange={(event) => setCity(event.target.value)} disabled={readOnly} autoComplete="off" placeholder="Алматы" />}
        </Field>
      </EditorBlock>

      <EditorBlock title="Параметры">
        <Field label="Часовой пояс" hint={sourceHint}>
          {(control) => <Select {...control} value={timezone} onValueChange={setTimezone} disabled={sourceLocked} options={timezoneOptions(restaurant?.timezone)} />}
        </Field>
        <Field label="Валюта">
          {(control) => <Select {...control} value={currency} onValueChange={setCurrency} disabled={readOnly} options={currencyOptions} />}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-body-sm font-medium text-muted-foreground">Концепция</span>
          {readOnly ? (
            <p className="text-body-sm text-foreground">{SERVICE_MODE_LABELS[serviceMode]}</p>
          ) : (
            <SegmentedControl aria-label="Концепция" value={serviceMode} onValueChange={setServiceMode} options={SERVICE_MODE_OPTIONS} />
          )}
        </div>
        <Field label="Отсечка бизнес-дня" error={errors.cutoff} hint={`Продажи до этого времени относятся к предыдущему бизнес-дню. От 00:00 до ${MAX_CUTOFF}`}>
          {(control) => (
            <Input {...control} type="time" step={60} min="00:00" max={MAX_CUTOFF} value={cutoff} onChange={(event) => setCutoff(event.target.value)} disabled={readOnly} className="w-40 tabular-nums" />
          )}
        </Field>
        {restaurant ? (
          <ActiveSwitch
            id="restaurant-active"
            label="Ресторан активен"
            active={restaurant.active}
            disabled={readOnly}
            confirmTitle="Отключить ресторан?"
            confirmDescription={`«${restaurant.name}» пропадёт из кассы и выбора в документах. Ресторан с открытой сменой отключить нельзя.`}
            onChange={async (active) => {
              await setRestaurantActive({ externalId: restaurant.externalId, active })
              toast(active ? "Ресторан включён" : "Ресторан отключён", "success")
            }}
          />
        ) : null}
      </EditorBlock>

      {restaurant ? (
        <EditorBlock title="Проведение и аудит">
          <Facts
            items={[
              ["Источник", fromIiko ? "iiko" : "OASIS Gastro"],
              ["Терминалов", <span className="tabular-nums">{restaurant.terminalCount}</span>],
              ["Складов", <span className="tabular-nums">{restaurant.warehouseCount}</span>],
              ["Версия записи", <span className="tabular-nums">{restaurant.version ?? 0}</span>],
            ]}
          />
        </EditorBlock>
      ) : (
        <p className="text-caption text-muted-foreground">Новый ресторан сразу получит основной склад и попадёт в ваш доступ.</p>
      )}
      {submitting ? (
        <p className="sr-only" role="status">
          Сохранение…
        </p>
      ) : null}
    </form>
  )

  if (!restaurant) return form

  return (
    <Tabs defaultValue="main">
      <TabsList aria-label="Карточка ресторана">
        <TabsTrigger value="main">Основное</TabsTrigger>
        <TabsTrigger value="iiko">Сопоставление iiko</TabsTrigger>
      </TabsList>
      {/* forceMount keeps the form in the DOM, so «Сохранить» in the panel footer works from either tab. */}
      <TabsContent value="main" forceMount className="data-[state=inactive]:hidden">
        {form}
      </TabsContent>
      <TabsContent value="iiko" className="flex flex-col gap-4">
        <p className="text-body-sm text-foreground">
          Связь ресторана с подразделением iiko задаётся в разделе «Корпорация → Обмен данными с iiko». Данные iiko только читаются — OASIS Gastro ничего не записывает в iiko.
        </p>
        {canViewExchange ? (
          <Link to="/office/data-exchange" className={buttonVariants({ variant: "secondary" })}>
            Открыть сопоставление
            <ArrowUpRight aria-hidden />
          </Link>
        ) : (
          <p className="text-caption text-muted-foreground">Нет права на раздел «Обмен данными с iiko».</p>
        )}
      </TabsContent>
    </Tabs>
  )
}
