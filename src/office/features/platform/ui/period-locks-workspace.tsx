import { Lock } from "lucide-react"
import { useId, useMemo, useState, type FormEvent } from "react"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { findOfficeItem } from "@/office/model/navigation"
import {
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FilterTabs,
  Input,
  loadMoreFromPaginated,
  SegmentedControl,
  Select,
  Switch,
  Textarea,
  TonePill,
  useToast,
  type Column,
} from "@/shared/components/ui"
import { almatyBusinessDate } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import { CAPABILITY_CATALOG } from "../../../../../convex/lib/capabilities"
import {
  formatBusinessDate,
  PLATFORM_PAGE_SIZE,
  PlatformErrorBoundary,
  usePeriodLocks,
  usePlatformMutations,
  usePlatformScope,
  type CreatePeriodLockArgs,
  type PeriodLockRow,
} from "../data/use-platform"

const ALL = "all"
const DAY_MS = 24 * 60 * 60 * 1000

type StatusTab = "all" | "active" | "reopened"
type LockKind = CreatePeriodLockArgs["kind"]

const TABS: { value: StatusTab; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "active", label: "Действующие" },
  { value: "reopened", label: "Снятые" },
]

export const LOCK_KIND_LABELS: Record<LockKind, string> = { preliminary: "Предварительная", final: "Окончательная" }

const KIND_OPTIONS = (Object.keys(LOCK_KIND_LABELS) as LockKind[]).map((value) => ({ value, label: LOCK_KIND_LABELS[value] }))

/** Sections a lock can target: the ones with posted documents (the server checks the id against the catalog). */
const MODULE_OPTIONS = CAPABILITY_CATALOG.filter((section) => section.actions.includes("post")).map((section) => ({
  value: section.id,
  label: findOfficeItem(section.id)?.label ?? section.id,
}))

export const moduleLabel = (moduleId: string | undefined) => (moduleId ? (findOfficeItem(moduleId)?.label ?? moduleId) : "Все разделы")

/** «Закрытие периода» (/office/document-locks, W1-ADM-03): preliminary and final period locks. */
export function PeriodLocksWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <PeriodLocksContent />
    </PlatformErrorBoundary>
  )
}

function PeriodLocksContent() {
  const [tab, setTab] = useState<StatusTab>("all")
  const [creating, setCreating] = useState(false)
  const [reopening, setReopening] = useState<PeriodLockRow | null>(null)
  const [reopenError, setReopenError] = useState<string | null>(null)
  const [reopenSubmitting, setReopenSubmitting] = useState(false)
  const scope = usePlatformScope()
  const canPost = useCan("office.document-locks.post")
  const canReverse = useCan("office.document-locks.reverse")
  const { reopenPeriodLock } = usePlatformMutations()
  const toast = useToast()
  const panelId = useId()
  const list = usePeriodLocks({ status: tab === "all" ? undefined : tab })
  const loading = list.status === "LoadingFirstPage"

  const columns = useMemo<Column<PeriodLockRow>[]>(() => {
    const base: Column<PeriodLockRow>[] = [
      {
        key: "lockedThrough",
        header: "Период до",
        cell: (row) => <span className="font-semibold tabular-nums">{formatBusinessDate(row.lockedThroughDate)}</span>,
        sortValue: (row) => row.lockedThroughDate,
      },
      { key: "level", header: "Уровень", cell: (row) => scope.restaurantName(row.restaurantExternalId) ?? "Вся организация" },
      { key: "kind", header: "Тип", cell: (row) => LOCK_KIND_LABELS[row.kind] },
      { key: "module", header: "Модуль", cell: (row) => moduleLabel(row.moduleId) },
      { key: "reason", header: "Причина", cell: (row) => <span className="line-clamp-2">{row.reason}</span> },
      {
        key: "status",
        header: "Статус",
        cell: (row) =>
          row.active ? (
            <TonePill tone="success">Действует</TonePill>
          ) : (
            <span title={row.reopenReason ? `Причина снятия: ${row.reopenReason}` : undefined}>
              <TonePill tone="neutral">Снят</TonePill>
            </span>
          ),
      },
    ]
    if (!canReverse) return base
    return [
      ...base,
      {
        key: "actions",
        header: <span className="sr-only">Действия</span>,
        cell: (row) =>
          row.active ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setReopenError(null)
                setReopening(row)
              }}
            >
              Открыть период
            </Button>
          ) : null,
      },
    ]
  }, [scope, canReverse])

  async function confirmReopen(reason: string) {
    if (!reopening) return
    if (reason.length < 3) {
      setReopenError("Укажите причину повторного открытия")
      return
    }
    setReopenSubmitting(true)
    setReopenError(null)
    try {
      await reopenPeriodLock({ externalId: reopening.externalId, reopenReason: reason })
      toast("Период открыт повторно", "success")
      setReopening(null)
    } catch (caught) {
      setReopenError(errorMessage(caught, "Не удалось открыть период"))
    } finally {
      setReopenSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      {canPost ? (
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)}>
            <Lock aria-hidden />
            Закрыть период
          </Button>
        </div>
      ) : null}
      <FilterTabs aria-label="Статус блокировки" value={tab} onValueChange={(value) => setTab(value as StatusTab)} items={TABS} panelId={panelId} />
      <div id={panelId} role="tabpanel" aria-label={TABS.find((item) => item.value === tab)?.label} className="flex flex-col gap-4">
        {loading ? (
          <OfficeStatePage state={{ kind: "loading" }} />
        ) : list.results.length === 0 && tab === "all" && list.status === "Exhausted" ? (
          <OfficeStatePage state={{ kind: "empty", title: "Закрытых периодов нет", description: "Закройте период, чтобы запретить изменения документов задним числом." }} />
        ) : (
          <DataTable
            caption="Закрытие периода"
            columns={columns}
            rows={list.results}
            getRowId={(row) => row.externalId}
            empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Записей нет</p>}
            loadMore={loadMoreFromPaginated(list, PLATFORM_PAGE_SIZE)}
          />
        )}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        {creating ? <CreateLockDialog network={scope.network} restaurants={scope.restaurants} onDone={() => setCreating(false)} /> : null}
      </Dialog>

      <ConfirmDialog
        open={reopening !== null}
        onOpenChange={(open) => {
          if (!open) setReopening(null)
        }}
        title="Открыть период повторно?"
        description={
          reopening
            ? `${LOCK_KIND_LABELS[reopening.kind]} блокировка по ${formatBusinessDate(reopening.lockedThroughDate)} (${scope.restaurantName(reopening.restaurantExternalId) ?? "вся организация"}) будет снята — документы этого периода снова можно будет менять.`
            : undefined
        }
        confirmLabel="Открыть период"
        reasonLabel="Причина повторного открытия"
        danger
        submitting={reopenSubmitting}
        error={reopenError}
        onConfirm={confirmReopen}
      />
    </div>
  )
}

type FormErrors = Partial<Record<"lockedThrough" | "restaurant" | "reason", string>>

function CreateLockDialog({ network, restaurants, onDone }: { network: boolean; restaurants: { externalId: string; name: string }[]; onDone: () => void }) {
  const { createPeriodLock } = usePlatformMutations()
  const toast = useToast()
  const today = almatyBusinessDate(Date.now())
  const [kind, setKind] = useState<LockKind>("preliminary")
  const [lockedThrough, setLockedThrough] = useState(() => almatyBusinessDate(Date.now() - DAY_MS))
  const [wholeOrganization, setWholeOrganization] = useState(network)
  const [restaurant, setRestaurant] = useState<string | undefined>(restaurants[0]?.externalId)
  const [moduleId, setModuleId] = useState(ALL)
  const [reason, setReason] = useState("")
  const [errors, setErrors] = useState<FormErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function validate(): FormErrors {
    const next: FormErrors = {}
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lockedThrough)) next.lockedThrough = "Укажите дату закрытия"
    else if (lockedThrough > today) next.lockedThrough = "Нельзя закрыть будущий период"
    if (!wholeOrganization && !restaurant) next.restaurant = "Выберите ресторан"
    if (reason.trim().length < 3) next.reason = "Укажите причину закрытия — не короче 3 символов"
    return next
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    setError(null)
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setSubmitting(true)
    try {
      await createPeriodLock({
        kind,
        lockedThrough,
        ...(wholeOrganization ? {} : { restaurantExternalId: restaurant! }),
        ...(moduleId === ALL ? {} : { moduleId }),
        reason: reason.trim(),
      })
      toast(`Период закрыт по ${formatBusinessDate(lockedThrough)}`, "success")
      onDone()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось закрыть период"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Закрыть период</DialogTitle>
        <DialogDescription>Документы по выбранную дату включительно станут только для чтения.</DialogDescription>
      </DialogHeader>
      <form id="period-lock-form" aria-label="Закрытие периода" noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-body-sm font-medium text-muted-foreground">Вид блокировки</span>
          <SegmentedControl aria-label="Вид блокировки" value={kind} onValueChange={setKind} options={KIND_OPTIONS} />
        </div>
        <Field label="Закрыть по дату" error={errors.lockedThrough}>
          {(control) => <Input {...control} type="date" max={today} value={lockedThrough} onChange={(event) => setLockedThrough(event.target.value)} />}
        </Field>
        {network ? (
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="period-lock-organization" className="text-body-sm font-medium text-foreground">
              Вся организация
            </label>
            <Switch id="period-lock-organization" checked={wholeOrganization} onCheckedChange={setWholeOrganization} />
          </div>
        ) : null}
        {!wholeOrganization ? (
          <Field label="Ресторан" error={errors.restaurant}>
            {(control) => (
              <Select {...control} value={restaurant} onValueChange={setRestaurant} placeholder="Выберите ресторан" options={restaurantSelectOptions(restaurants)} />
            )}
          </Field>
        ) : null}
        <Field label="Модуль" hint="Пусто — все разделы">
          {(control) => <Select {...control} value={moduleId} onValueChange={setModuleId} options={[{ value: ALL, label: "Все разделы" }, ...MODULE_OPTIONS]} />}
        </Field>
        <Field label="Причина" error={errors.reason}>
          {(control) => <Textarea {...control} value={reason} onChange={(event) => setReason(event.target.value)} />}
        </Field>
        {error ? (
          <p role="alert" className="text-body-sm text-destructive">
            {error}
          </p>
        ) : null}
      </form>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone} disabled={submitting}>
          Отмена
        </Button>
        <Button type="submit" form="period-lock-form" disabled={submitting}>
          {submitting ? "Сохранение…" : "Закрыть период"}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
