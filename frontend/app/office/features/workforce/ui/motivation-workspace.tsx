import { ArrowLeft, Plus, Search } from "lucide-react"
import { useEffect, useId, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { SaveStatus, UnsavedChangesDialog } from "@/office/components/unsaved-changes"
import { PlatformErrorBoundary, usePlatformScope } from "@/office/features/platform/data/use-platform"
import { useDebounced } from "@/office/features/stock/data/use-stock-master"
import { useUnsavedChanges } from "@/office/hooks/use-unsaved-changes"
import { Banner, Button, Chip, DataTable, EmptyState, Field, FilterTabs, Input, loadMoreFromPaginated, MoneyInput, Select, StatusPill, Tabs, TabsContent, TabsList, TabsTrigger, useToast, type Column } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatTenge } from "@/shared/lib/format"
import { recordCount } from "@/shared/lib/plural"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import { usePosEmployees } from "../data/use-office-workforce"
import { useRestaurantFilter } from "../data/use-restaurant-filter"
import { usePositions } from "../data/use-workforce-w2"
import { useMotivationList, useMotivationMutations, useMotivationProgram, W3_PAGE_SIZE, type MotivationAction, type MotivationProgram, type MotivationRow, type MotivationStatus } from "../data/use-workforce-w3"
import {
  formatMetricValue,
  formatPeriod,
  formatReward,
  isEditableProgram,
  isMoneyMetric,
  METRIC_HINT,
  METRIC_LABEL,
  METRIC_OPTIONS,
  MOTIVATION_TABS,
  motivationArgs,
  motivationDraftOf,
  parseDecimal,
  REWARD_TYPE_LABEL,
  REWARD_TYPE_OPTIONS,
  validateProgram,
  type Metric,
  type MotivationDraft,
  type MotivationErrors,
  type RewardType,
} from "../model/w3"
import { formatBusinessDate } from "../model/modules"
import { MotivationResultsPanel } from "./motivation-results"
import { CardSection, ReadOnlyField, SwitchRow } from "./w3-parts"

// «Мотивационные программы» (W3-HR-07): /office/motivation — the register (§3.5 publish);
// /office/motivation/:id — the card with the «Результаты» tab, «new» creates a program.

const SECTION = "/office/motivation"

export function MotivationWorkspace() {
  const { id } = useParams()
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={`${id ?? "list"}-${attempt}`} onRetry={() => setAttempt((value) => value + 1)}>
      {id ? <MotivationEditor externalId={id === "new" ? null : id} /> : <MotivationRegister />}
    </PlatformErrorBoundary>
  )
}

/** Columns per OFFICE-DESIGN §5: the threshold and the reward carry their units, never a bare «₸» (L-10). */
export function motivationColumns(restaurantName: (externalId: string) => string | undefined): Column<MotivationRow>[] {
  return [
    { key: "number", header: "Номер", cell: (row) => <span className="font-semibold whitespace-nowrap">{row.number}</span> },
    {
      key: "name",
      header: "Название",
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold text-foreground">{row.name}</span>
          <span className="truncate text-caption text-muted-foreground">{[restaurantName(row.restaurantExternalId), `премия ${formatReward(row)}`].filter(Boolean).join(" · ")}</span>
        </div>
      ),
    },
    {
      key: "metric",
      header: "Показатель",
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate">{METRIC_LABEL[row.metric]}</span>
          <span className="truncate text-caption text-muted-foreground">{`порог ${row.metric === "kitchen-time" ? "≤" : "≥"} ${formatMetricValue(row.metric, row.threshold)}`}</span>
        </div>
      ),
    },
    { key: "period", header: "Период", cell: (row) => <span className="whitespace-nowrap">{formatPeriod(row.startsAt, row.endsAt)}</span> },
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.status} /> },
  ]
}

function MotivationRegister() {
  const navigate = useNavigate()
  const canEdit = useCan("office.motivation.edit")
  const restaurants = useRestaurantFilter()
  const panelId = useId()
  const [tab, setTab] = useState<"all" | MotivationStatus>("all")
  const [searchText, setSearchText] = useState("")
  const search = useDebounced(searchText)
  const list = useMotivationList({ status: tab === "all" ? undefined : tab, search, restaurantExternalId: restaurants.restaurantExternalId, enabled: !restaurants.loading })
  const restaurantName = restaurants.restaurantName
  const columns = useMemo(() => motivationColumns((externalId) => restaurantName(externalId)), [restaurantName])
  const loading = list.status === "LoadingFirstPage"
  const unfiltered = tab === "all" && !search.trim() && !restaurants.restaurantExternalId
  const create = () => navigate(`${SECTION}/new`)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm text-muted-foreground">Премии за продажи, средний чек, время кухни и дисциплину. Начисление попадает в ведомость зарплаты как премия.</p>
        {canEdit ? (
          <Button onClick={create}>
            <Plus aria-hidden />
            Новая запись
          </Button>
        ) : null}
      </div>
      <FilterTabs aria-label="Статус программ" value={tab} onValueChange={(value) => setTab(value as typeof tab)} panelId={panelId} items={MOTIVATION_TABS} />
      <div id={panelId} role="tabpanel" aria-label={MOTIVATION_TABS.find((item) => item.value === tab)?.label} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative w-full sm:w-[420px]">
            <span className="sr-only">Поиск: мотивационные программы</span>
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Поиск: мотивационные программы" className="pl-9" />
          </label>
          {restaurants.visible ? <Select aria-label="Ресторан" className="w-full sm:w-64" value={restaurants.value} onValueChange={restaurants.setValue} options={restaurants.options} /> : null}
          <span className="ml-auto text-caption text-muted-foreground">{loading ? "" : recordCount(list.results.length)}</span>
        </div>
        {loading ? (
          <OfficeStatePage state={{ kind: "loading" }} />
        ) : list.results.length === 0 && unfiltered && list.status === "Exhausted" ? (
          <div className="rounded-card border border-border bg-card">
            <OfficeStatePage
              state={{
                kind: "empty",
                title: "Записей пока нет",
                description: "Создайте программу: показатель, порог и премию за период — например, «План продаж месяца».",
                action: canEdit ? (
                  <Button variant="secondary" onClick={create}>
                    Новая запись
                  </Button>
                ) : undefined,
              }}
            />
          </div>
        ) : (
          <DataTable
            caption="Мотивационные программы"
            columns={columns}
            rows={list.results}
            getRowId={(row) => row.externalId}
            onRowClick={(row) => navigate(`${SECTION}/${encodeURIComponent(row.externalId)}`)}
            empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Ничего не найдено по выбранным фильтрам</p>}
            loadMore={loadMoreFromPaginated(list, W3_PAGE_SIZE)}
          />
        )}
      </div>
    </div>
  )
}

function MotivationEditor({ externalId }: { externalId: string | null }) {
  const program = useMotivationProgram(externalId)
  const navigate = useNavigate()
  const back = () => navigate(SECTION)
  if (externalId && program === undefined) {
    return (
      <div className="px-6 py-5 xl:px-8">
        <OfficeStatePage state={{ kind: "loading" }} />
      </div>
    )
  }
  if (externalId && !program) {
    return (
      <div className="px-6 py-5 xl:px-8">
        <EmptyState
          title="Программа не найдена"
          description="Возможно, она относится к ресторану вне вашего доступа или ссылка устарела."
          action={
            <Button variant="secondary" onClick={back}>
              <ArrowLeft aria-hidden />К списку
            </Button>
          }
        />
      </div>
    )
  }
  return <MotivationForm key={program ? `${program.externalId}:${program.version}` : "new"} program={program ?? null} onBack={back} />
}

const ACTION_DONE: Record<MotivationAction, string> = { publish: "Программа опубликована", deactivate: "Программа отключена", expire: "Программа завершена" }

function MotivationForm({ program, onBack }: { program: MotivationProgram | null; onBack: () => void }) {
  const canEdit = useCan("office.motivation.edit")
  const scope = usePlatformScope()
  const { save, transition } = useMotivationMutations()
  const navigate = useNavigate()
  const toast = useToast()
  const defaultRestaurant = scope.restaurants.length === 1 ? scope.restaurants[0].externalId : undefined
  const [baseline, setBaseline] = useState<MotivationDraft>(() => motivationDraftOf(program, { restaurantExternalId: defaultRestaurant }))
  const [draft, setDraft] = useState<MotivationDraft>(baseline)
  const [errors, setErrors] = useState<MotivationErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<"save" | MotivationAction | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [tab, setTab] = useState("card")
  const editable = canEdit && (program ? isEditableProgram(program.status) && !program.accruedAt : true)
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline])
  const blocker = useUnsavedChanges(dirty && editable)
  const set = (patch: Partial<MotivationDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch)) delete next[key as keyof MotivationErrors]
      if ("restaurantExternalId" in patch) delete next.restaurant
      if ("metric" in patch) delete next.rewardType
      return next
    })
  }

  // The restaurants load after the first render: preselect the only one.
  useEffect(() => {
    if (!program && defaultRestaurant && !draft.restaurantExternalId) {
      setDraft((current) => ({ ...current, restaurantExternalId: defaultRestaurant }))
      setBaseline((current) => ({ ...current, restaurantExternalId: defaultRestaurant }))
    }
  }, [program, defaultRestaurant, draft.restaurantExternalId])

  useEffect(() => {
    if (createdId) navigate(`${SECTION}/${encodeURIComponent(createdId)}`, { replace: true })
  }, [createdId, navigate])

  async function persist() {
    const found = validateProgram(draft)
    setErrors(found)
    if (Object.keys(found).length > 0) return null
    const externalId = await save(motivationArgs(program, draft))
    setBaseline(draft)
    return externalId
  }

  async function handleSave() {
    if (!editable || busy) return
    setBusy("save")
    setError(null)
    try {
      const externalId = await persist()
      if (externalId === null) return
      toast(program ? "Программа сохранена" : "Программа создана", "success")
      if (!program) setCreatedId(externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить программу"))
    } finally {
      setBusy(null)
    }
  }

  async function run(action: MotivationAction) {
    if (!program || busy) return
    setBusy(action)
    setError(null)
    try {
      if (action === "publish" && dirty) {
        const saved = await persist()
        if (saved === null) return
        // The save bumped the version: publish without the stale expectation.
        await transition({ externalId: program.externalId, action })
      } else {
        await transition({ externalId: program.externalId, action, expectedVersion: program.version })
      }
      toast(ACTION_DONE[action], "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось выполнить действие"))
    } finally {
      setBusy(null)
    }
  }

  const status = program?.status
  const restaurantName = scope.restaurantName(draft.restaurantExternalId) ?? draft.restaurantExternalId
  const title = program ? `Программа ${program.number}` : "Новая мотивационная программа"
  const meta = program ? [program.name, restaurantName, formatPeriod(program.startsAt, program.endsAt)].filter(Boolean).join(" · ") : "Черновик — начнёт действовать после публикации"

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5 xl:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-title font-semibold">{title}</h2>
              {status ? <StatusPill domain="document" status={status} /> : null}
            </div>
            <p className="text-body-sm text-muted-foreground">{meta}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {editable ? <SaveStatus state={busy === "save" ? "saving" : dirty ? "dirty" : "clean"} /> : null}
            <Button variant="secondary" onClick={onBack}>
              <ArrowLeft aria-hidden />К списку
            </Button>
            {editable ? (
              <Button variant={program && (status === "draft" || status === "inactive") ? "secondary" : "primary"} onClick={() => void handleSave()} disabled={!dirty || busy !== null}>
                {busy === "save" ? "Сохранение…" : "Сохранить"}
              </Button>
            ) : null}
            {program && canEdit && (status === "draft" || status === "inactive") ? (
              <Button onClick={() => void run("publish")} disabled={busy !== null}>
                {busy === "publish" ? "Публикация…" : "Опубликовать"}
              </Button>
            ) : null}
            {program && canEdit && status === "published" ? (
              <>
                <Button variant="secondary" onClick={() => void run("deactivate")} disabled={busy !== null}>
                  Отключить
                </Button>
                <Button variant="secondary" onClick={() => void run("expire")} disabled={busy !== null}>
                  Завершить
                </Button>
              </>
            ) : null}
          </div>
        </header>

        {status === "published" ? (
          <Banner tone="info" title="Программа опубликована — только чтение">
            Чтобы изменить условия, отключите программу. После начисления премий условия не меняются.
          </Banner>
        ) : null}
        {program?.accruedAt ? (
          <Banner tone="info" title="Премии начислены">
            Начислено по программе: {formatTenge(program.accruedAmount ?? 0)}. Премии войдут в ведомость зарплаты за период.
          </Banner>
        ) : null}
        {error ? (
          <Banner tone="danger" title="Не удалось выполнить действие">
            {error}
          </Banner>
        ) : null}

        {program ? (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList aria-label="Разделы программы">
              <TabsTrigger value="card">Карточка</TabsTrigger>
              <TabsTrigger value="results">Результаты</TabsTrigger>
            </TabsList>
            <TabsContent value="card" className="flex flex-col gap-5">
              <ProgramCard draft={draft} errors={errors} editable={editable} program={program} restaurantName={restaurantName} set={set} />
            </TabsContent>
            <TabsContent value="results">
              <MotivationResultsPanel program={program} />
            </TabsContent>
          </Tabs>
        ) : (
          <ProgramCard draft={draft} errors={errors} editable={editable} program={null} restaurantName={restaurantName} set={set} />
        )}
      </div>

      {editable ? (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-6 py-3 shadow-panel xl:px-8">
          <p className="text-caption text-muted-foreground">Результаты считаются по опубликованной программе; премии начисляются после окончания периода.</p>
          <Button variant="secondary" onClick={() => setDraft(baseline)} disabled={!dirty || busy !== null}>
            Отменить изменения
          </Button>
        </footer>
      ) : null}
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}

function ProgramCard({ draft, errors, editable, program, restaurantName, set }: { draft: MotivationDraft; errors: MotivationErrors; editable: boolean; program: MotivationProgram | null; restaurantName: string; set: (patch: Partial<MotivationDraft>) => void }) {
  const scope = usePlatformScope()
  const money = isMoneyMetric(draft.metric)
  const thresholdUnit = money ? "₸" : draft.metric === "attendance" ? "%" : "мин"
  const threshold = parseDecimal(draft.threshold)
  const reward = parseDecimal(draft.rewardValue)
  return (
    <>
      <CardSection title="Основные реквизиты">
        <div className="grid gap-4 md:grid-cols-2">
          {program ? <ReadOnlyField label="Номер" value={program.number} /> : null}
          {program || !editable ? (
            <ReadOnlyField label="Ресторан" value={restaurantName || "—"} />
          ) : (
            <Field label="Ресторан" error={errors.restaurant}>
              {(control) => <Select {...control} value={draft.restaurantExternalId || undefined} onValueChange={(restaurantExternalId) => set({ restaurantExternalId, employeeCodes: [] })} options={restaurantSelectOptions(scope.restaurants)} placeholder="Выберите ресторан" />}
            </Field>
          )}
          {editable ? (
            <Field label="Название" error={errors.name} className="md:col-span-2">
              {(control) => <Input {...control} autoComplete="off" value={draft.name} onChange={(event) => set({ name: event.target.value })} placeholder="Например, «План продаж сентября»" />}
            </Field>
          ) : (
            <ReadOnlyField label="Название" value={draft.name} className="md:col-span-2" />
          )}
          {editable ? (
            <Field label="Начало" error={errors.startsAt}>
              {(control) => <Input {...control} type="date" value={draft.startsAt} onChange={(event) => set({ startsAt: event.target.value })} />}
            </Field>
          ) : (
            <ReadOnlyField label="Начало" value={formatBusinessDate(draft.startsAt)} />
          )}
          {editable ? (
            <Field label="Окончание" error={errors.endsAt} hint="Последний день периода, включительно">
              {(control) => <Input {...control} type="date" value={draft.endsAt} min={draft.startsAt || undefined} onChange={(event) => set({ endsAt: event.target.value })} />}
            </Field>
          ) : (
            <ReadOnlyField label="Окончание" value={formatBusinessDate(draft.endsAt)} />
          )}
        </div>
      </CardSection>

      <CardSection title="Правило" description={METRIC_HINT[draft.metric]}>
        <div className="grid gap-4 md:grid-cols-2">
          {editable ? (
            <Field label="Показатель">
              {(control) => <Select {...control} value={draft.metric} onValueChange={(metric) => set({ metric: metric as Metric, ...(metric !== "sales" ? { rewardType: "fixed" as const } : {}) })} options={METRIC_OPTIONS} />}
            </Field>
          ) : (
            <ReadOnlyField label="Показатель" value={METRIC_LABEL[draft.metric]} />
          )}
          {editable ? (
            <Field label={`Порог, ${thresholdUnit}`} error={errors.threshold} hint={draft.metric === "kitchen-time" ? "Не больше этого значения" : "Не меньше этого значения"}>
              {(control) =>
                money ? (
                  <MoneyInput {...control} value={threshold} onValueChange={(value) => set({ threshold: value === null ? "" : String(value) })} />
                ) : (
                  <Input {...control} inputMode="decimal" autoComplete="off" value={draft.threshold} onChange={(event) => set({ threshold: event.target.value.replace(/[^\d.,]/g, "").slice(0, 8) })} />
                )
              }
            </Field>
          ) : (
            <ReadOnlyField label="Порог" value={`${draft.metric === "kitchen-time" ? "≤" : "≥"} ${formatMetricValue(draft.metric, threshold) ?? "—"}`} />
          )}
          {editable ? (
            <Field label="Вознаграждение" error={errors.rewardType} hint={draft.metric === "sales" ? "Процент — от продаж сотрудника за период" : "Для этого показателя — только фиксированная сумма"}>
              {(control) => <Select {...control} value={draft.rewardType} onValueChange={(rewardType) => set({ rewardType: rewardType as RewardType, rewardValue: "" })} options={draft.metric === "sales" ? REWARD_TYPE_OPTIONS : REWARD_TYPE_OPTIONS.filter((option) => option.value === "fixed")} />}
            </Field>
          ) : (
            <ReadOnlyField label="Вознаграждение" value={REWARD_TYPE_LABEL[draft.rewardType]} />
          )}
          {editable ? (
            <Field label={draft.rewardType === "fixed" ? "Значение, ₸" : "Значение, %"} error={errors.rewardValue}>
              {(control) =>
                draft.rewardType === "fixed" ? (
                  <MoneyInput {...control} value={reward} onValueChange={(value) => set({ rewardValue: value === null ? "" : String(value) })} />
                ) : (
                  <Input {...control} inputMode="decimal" autoComplete="off" value={draft.rewardValue} onChange={(event) => set({ rewardValue: event.target.value.replace(/[^\d.,]/g, "").slice(0, 5) })} />
                )
              }
            </Field>
          ) : (
            <ReadOnlyField label="Значение" value={reward === null ? "—" : formatReward({ rewardType: draft.rewardType, rewardValue: reward })} />
          )}
          <SwitchRow
            className="md:col-span-2"
            label="Требует утверждения"
            hint="Начислить премии сможет только пользователь с правом утверждать мотивационные программы"
            checked={draft.requiresApproval}
            disabled={!editable}
            onChange={(requiresApproval) => set({ requiresApproval })}
          />
        </div>
      </CardSection>

      <ParticipantsSection draft={draft} editable={editable} set={set} />
    </>
  )
}

/** «Участники»: positions and employees of the restaurant; nothing chosen — every active employee. */
function ParticipantsSection({ draft, editable, set }: { draft: MotivationDraft; editable: boolean; set: (patch: Partial<MotivationDraft>) => void }) {
  const canSeePositions = useCan("office.positions.view")
  const canSeeEmployees = useCan("office.employees.view")
  const positions = usePositions("active", canSeePositions)
  const { employees } = usePosEmployees(canSeeEmployees)
  const staff = employees.filter((employee) => employee.active && employee.restaurants.some((restaurant) => restaurant.externalId === draft.restaurantExternalId))
  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value])
  const everyone = draft.positionExternalIds.length === 0 && draft.employeeCodes.length === 0
  const positionName = new Map((positions ?? []).map((position) => [position.externalId, position.name]))
  const employeeName = new Map(staff.map((employee) => [employee.code, employee.displayName]))

  return (
    <CardSection title="Участники" description={everyone ? "Не выбрано — участвуют все активные сотрудники ресторана." : "Участвуют сотрудники выбранных должностей и выбранные сотрудники."}>
      <div className="flex flex-col gap-2">
        <span className="text-body-sm font-medium text-muted-foreground">Должности</span>
        {!canSeePositions ? (
          <p className="text-caption text-muted-foreground">Нет права просматривать должности{draft.positionExternalIds.length ? `: выбрано ${draft.positionExternalIds.length}` : ""}.</p>
        ) : positions === undefined ? (
          <p className="text-caption text-muted-foreground">Загрузка…</p>
        ) : editable ? (
          positions.length ? (
            <div className="flex flex-wrap gap-2">
              {positions.map((position) => (
                <Chip key={position.externalId} active={draft.positionExternalIds.includes(position.externalId)} onClick={() => set({ positionExternalIds: toggle(draft.positionExternalIds, position.externalId) })}>
                  {position.name}
                </Chip>
              ))}
            </div>
          ) : (
            <p className="text-caption text-muted-foreground">Должностей пока нет</p>
          )
        ) : (
          <p className="text-body-sm">{draft.positionExternalIds.map((id) => positionName.get(id) ?? id).join(", ") || "—"}</p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-body-sm font-medium text-muted-foreground">Сотрудники</span>
        {!canSeeEmployees ? (
          <p className="text-caption text-muted-foreground">Нет права просматривать сотрудников{draft.employeeCodes.length ? `: выбрано ${draft.employeeCodes.length}` : ""}.</p>
        ) : !draft.restaurantExternalId ? (
          <p className="text-caption text-muted-foreground">Сначала выберите ресторан</p>
        ) : editable ? (
          staff.length ? (
            <div className="flex max-h-60 flex-wrap gap-2 overflow-y-auto">
              {staff.map((employee) => (
                <Chip key={employee.code} active={draft.employeeCodes.includes(employee.code)} onClick={() => set({ employeeCodes: toggle(draft.employeeCodes, employee.code) })}>
                  {employee.displayName}
                </Chip>
              ))}
            </div>
          ) : (
            <p className="text-caption text-muted-foreground">В этом ресторане нет активных сотрудников</p>
          )
        ) : (
          <p className="text-body-sm">{draft.employeeCodes.map((code) => employeeName.get(code) ?? `код ${code}`).join(", ") || "—"}</p>
        )}
      </div>
    </CardSection>
  )
}
