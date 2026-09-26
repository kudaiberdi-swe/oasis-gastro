import { ArrowLeft, Plus, Search } from "lucide-react"
import { useEffect, useId, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { SaveStatus, UnsavedChangesDialog } from "@/office/components/unsaved-changes"
import { PlatformErrorBoundary, usePlatformScope } from "@/office/features/platform/data/use-platform"
import { useDebounced } from "@/office/features/stock/data/use-stock-master"
import { useUnsavedChanges } from "@/office/hooks/use-unsaved-changes"
import { Banner, Button, Combobox, ConfirmDialog, DataTable, EmptyState, Field, FilterTabs, Input, loadMoreFromPaginated, Select, StatusPill, Textarea, TonePill, useToast, type Column } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { recordCount } from "@/shared/lib/plural"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import { usePosEmployees } from "../data/use-office-workforce"
import { useRestaurantFilter } from "../data/use-restaurant-filter"
import { useExpiringMedical, useMedicalList, useMedicalMutations, useMedicalRecord, useMedicalSettings, W3_PAGE_SIZE, type MedicalAction, type MedicalRecord, type MedicalRow, type MedicalStatus } from "../data/use-workforce-w3"
import { formatBusinessDate } from "../model/modules"
import { DOCUMENT_TYPE_LABEL, DOCUMENT_TYPE_OPTIONS, expiryNote, MEDICAL_TABS, medicalArgs, medicalDraftOf, todayAlmaty, validateMedical, type DocumentType, type MedicalDraft, type MedicalErrors } from "../model/w3"
import { ExpiryBanner } from "./expiry-banner"
import { CardSection, ReadOnlyField, SwitchRow } from "./w3-parts"

// «Медкнижки и анализы» (W3-HR-08): /office/medical-records — the register (§3.5 approval) with the
// expiry banner; /office/medical-records/:id — the card, «new» creates one. The document number and the
// comment are personal data: the server masks them without «Персональные данные сотрудников».

const SECTION = "/office/medical-records"
const WITHIN_DAYS = 30

export function MedicalRecordsWorkspace() {
  const { id } = useParams()
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={`${id ?? "list"}-${attempt}`} onRetry={() => setAttempt((value) => value + 1)}>
      {id ? <MedicalEditor externalId={id === "new" ? null : id} /> : <MedicalRegister />}
    </PlatformErrorBoundary>
  )
}

function ExpiryCell({ row }: { row: Pick<MedicalRow, "expiresAt" | "status"> }) {
  const note = expiryNote(row.expiresAt)
  return (
    <div className="flex flex-col">
      <span className="whitespace-nowrap">{formatBusinessDate(row.expiresAt)}</span>
      {row.status === "approved" && note.tone !== "neutral" ? <span className={note.tone === "danger" ? "text-caption text-destructive" : "text-caption text-warning"}>{note.text}</span> : null}
    </div>
  )
}

/** Columns per OFFICE-DESIGN §5; no «Стоимость документа» (L-10). */
export function medicalColumns(restaurantName: (externalId: string) => string | undefined): Column<MedicalRow>[] {
  return [
    { key: "number", header: "Номер", cell: (row) => <span className="font-semibold whitespace-nowrap">{row.number}</span> },
    {
      key: "employee",
      header: "Сотрудник",
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold text-foreground">{row.employeeName}</span>
          <span className="truncate text-caption text-muted-foreground">{[restaurantName(row.restaurantExternalId), `код ${row.employeeCode}`].filter(Boolean).join(" · ")}</span>
        </div>
      ),
    },
    {
      key: "document",
      header: "Документ",
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate">{DOCUMENT_TYPE_LABEL[row.documentType]}</span>
          <span className="truncate text-caption text-muted-foreground">{row.fitForWork ? "Допущен к работе" : "Не допущен"}</span>
        </div>
      ),
    },
    { key: "issuedAt", header: "Выдан", cell: (row) => <span className="whitespace-nowrap">{formatBusinessDate(row.issuedAt)}</span> },
    { key: "expiresAt", header: "Действует до", cell: (row) => <ExpiryCell row={row} /> },
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.status} /> },
  ]
}

function MedicalRegister() {
  const navigate = useNavigate()
  const canEdit = useCan("office.medical-records.edit")
  const restaurants = useRestaurantFilter()
  const scope = usePlatformScope()
  const panelId = useId()
  const [tab, setTab] = useState<"all" | MedicalStatus>("all")
  const [expiringOnly, setExpiringOnly] = useState(false)
  const [searchText, setSearchText] = useState("")
  const search = useDebounced(searchText)
  const expiring = useExpiringMedical(restaurants.restaurantExternalId, !restaurants.loading)
  const list = useMedicalList({
    status: expiringOnly || tab === "all" ? undefined : tab,
    search: expiringOnly ? "" : search,
    restaurantExternalId: restaurants.restaurantExternalId,
    expiringWithinDays: expiringOnly ? WITHIN_DAYS : undefined,
    enabled: !restaurants.loading,
  })
  const restaurantName = restaurants.restaurantName
  const columns = useMemo(() => medicalColumns((externalId) => restaurantName(externalId)), [restaurantName])
  const loading = list.status === "LoadingFirstPage"
  const unfiltered = tab === "all" && !expiringOnly && !search.trim() && !restaurants.restaurantExternalId
  const create = () => navigate(`${SECTION}/new`)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm text-muted-foreground">Медицинские книжки, анализы и допуски: номер, срок и допуск к работе — без диагнозов.</p>
        {canEdit ? (
          <Button onClick={create}>
            <Plus aria-hidden />
            Новая запись
          </Button>
        ) : null}
      </div>
      <FilterTabs
        aria-label="Статус документов"
        value={tab}
        onValueChange={(value) => {
          setTab(value as typeof tab)
          setExpiringOnly(false)
        }}
        panelId={panelId}
        items={MEDICAL_TABS}
      />
      <div id={panelId} role="tabpanel" aria-label={MEDICAL_TABS.find((item) => item.value === tab)?.label} className="flex flex-col gap-4">
        <ExpiryBanner expiring={expiring} filtered={expiringOnly} onToggle={() => setExpiringOnly((value) => !value)} />
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative w-full sm:w-[420px]">
            <span className="sr-only">Поиск: медкнижки и анализы</span>
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" value={searchText} disabled={expiringOnly} onChange={(event) => setSearchText(event.target.value)} placeholder="Поиск: медкнижки и анализы" className="pl-9" />
          </label>
          {restaurants.visible ? <Select aria-label="Ресторан" className="w-full sm:w-64" value={restaurants.value} onValueChange={restaurants.setValue} options={restaurants.options} /> : null}
          {expiringOnly ? <TonePill tone="warning">{`Истекают в ближайшие ${WITHIN_DAYS} дней`}</TonePill> : null}
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
                description: "Внесите медкнижку или анализ сотрудника: дату выдачи, срок и допуск к работе.",
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
            caption="Медкнижки и анализы"
            columns={columns}
            rows={list.results}
            getRowId={(row) => row.externalId}
            onRowClick={(row) => navigate(`${SECTION}/${encodeURIComponent(row.externalId)}`)}
            empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Ничего не найдено по выбранным фильтрам</p>}
            loadMore={loadMoreFromPaginated(list, W3_PAGE_SIZE)}
          />
        )}
        {canEdit && scope.network ? <ExpirySettings /> : null}
      </div>
    </div>
  )
}

/** Network-wide: the daily job's warning window and whether it takes the admission away. */
function ExpirySettings() {
  const settings = useMedicalSettings()
  const { saveSettings } = useMedicalMutations()
  const toast = useToast()
  const [draft, setDraft] = useState<{ revoke: boolean; days: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  if (settings === undefined) return null
  const value = draft ?? { revoke: settings.revokeAdmissionOnExpiry, days: String(settings.notifyWithinDays) }
  const dirty = value.revoke !== settings.revokeAdmissionOnExpiry || value.days !== String(settings.notifyWithinDays)

  async function submit() {
    const days = Number(value.days)
    if (!(value.days !== "" && Number.isInteger(days) && days >= 0 && days <= 60)) {
      setError("Предупреждать — от 0 до 60 дней")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await saveSettings({ revokeAdmissionOnExpiry: value.revoke, notifyWithinDays: days })
      setDraft(null)
      toast("Настройки сохранены", "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить настройки"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <CardSection title="Контроль сроков" description="Каждую ночь система предупреждает кассы ресторана о документах, срок которых подходит к концу, и отмечает истёкшие.">
      <div className="grid gap-4 md:grid-cols-2">
        <SwitchRow label="Снимать допуск по истечении" hint="Истёкший и не продлённый документ снимает отметку «Допущен к работе» в карточке сотрудника" checked={value.revoke} onChange={(revoke) => setDraft({ ...value, revoke })} />
        <Field label="Предупреждать на кассе за, дней" hint="0 — не предупреждать" error={error}>
          {(control) => <Input {...control} inputMode="numeric" autoComplete="off" value={value.days} onChange={(event) => setDraft({ ...value, days: event.target.value.replace(/\D/g, "").slice(0, 2) })} />}
        </Field>
      </div>
      <div className="flex justify-end">
        <Button variant="secondary" onClick={() => void submit()} disabled={!dirty || saving}>
          {saving ? "Сохранение…" : "Сохранить настройки"}
        </Button>
      </div>
    </CardSection>
  )
}

function MedicalEditor({ externalId }: { externalId: string | null }) {
  const record = useMedicalRecord(externalId)
  const navigate = useNavigate()
  const back = () => navigate(SECTION)
  if (externalId && record === undefined) {
    return (
      <div className="px-6 py-5 xl:px-8">
        <OfficeStatePage state={{ kind: "loading" }} />
      </div>
    )
  }
  if (externalId && !record) {
    return (
      <div className="px-6 py-5 xl:px-8">
        <EmptyState
          title="Запись не найдена"
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
  return <MedicalForm key={record ? `${record.externalId}:${record.version}` : "new"} record={record ?? null} onBack={back} />
}

const ACTION_DONE: Record<MedicalAction, string> = { submit: "Отправлено на согласование", approve: "Документ согласован", cancel: "Запись отменена" }

function MedicalForm({ record, onBack }: { record: MedicalRecord | null; onBack: () => void }) {
  const canEdit = useCan("office.medical-records.edit")
  const canApprove = useCan("office.medical-records.approve")
  const canCancel = useCan("office.medical-records.cancel")
  const scope = usePlatformScope()
  const { save, transition } = useMedicalMutations()
  const navigate = useNavigate()
  const toast = useToast()
  const defaultRestaurant = scope.restaurants.length === 1 ? scope.restaurants[0].externalId : undefined
  const [baseline, setBaseline] = useState<MedicalDraft>(() => medicalDraftOf(record, { restaurantExternalId: defaultRestaurant }))
  const [draft, setDraft] = useState<MedicalDraft>(baseline)
  const [errors, setErrors] = useState<MedicalErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<"save" | MedicalAction | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const editable = canEdit && (record ? record.status === "draft" : true)
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline])
  const blocker = useUnsavedChanges(dirty && editable)
  const set = (patch: Partial<MedicalDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch)) delete next[key as keyof MedicalErrors]
      if ("restaurantExternalId" in patch) delete next.restaurant
      if ("employeeId" in patch) delete next.employee
      return next
    })
  }

  useEffect(() => {
    if (!record && defaultRestaurant && !draft.restaurantExternalId) {
      setDraft((current) => ({ ...current, restaurantExternalId: defaultRestaurant }))
      setBaseline((current) => ({ ...current, restaurantExternalId: defaultRestaurant }))
    }
  }, [record, defaultRestaurant, draft.restaurantExternalId])

  useEffect(() => {
    if (createdId) navigate(`${SECTION}/${encodeURIComponent(createdId)}`, { replace: true })
  }, [createdId, navigate])

  async function persist() {
    const found = validateMedical(record, draft)
    setErrors(found)
    if (Object.keys(found).length > 0) return null
    const externalId = await save(medicalArgs(record, draft))
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
      toast(record ? "Запись сохранена" : "Запись создана", "success")
      if (!record) setCreatedId(externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить запись"))
    } finally {
      setBusy(null)
    }
  }

  async function run(action: MedicalAction, reason?: string) {
    if (!record || busy) return
    setBusy(action)
    setError(null)
    try {
      if (action === "submit" && dirty) {
        const saved = await persist()
        if (saved === null) return
        await transition({ externalId: record.externalId, action })
      } else {
        await transition({ externalId: record.externalId, action, expectedVersion: record.version, ...(reason ? { reason } : {}) })
      }
      setCancelling(false)
      toast(ACTION_DONE[action], "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось выполнить действие"))
    } finally {
      setBusy(null)
    }
  }

  const status = record?.status
  const restaurantName = scope.restaurantName(draft.restaurantExternalId) ?? draft.restaurantExternalId
  const title = record ? `Документ ${record.number}` : "Новый медицинский документ"
  const meta = record ? [record.employeeName, restaurantName, DOCUMENT_TYPE_LABEL[record.documentType]].filter(Boolean).join(" · ") : "Черновик — действует после согласования"
  const note = record && status === "approved" ? expiryNote(record.expiresAt, todayAlmaty()) : null
  const piiHidden = record?.piiHidden ?? false

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
              <Button variant={record ? "secondary" : "primary"} onClick={() => void handleSave()} disabled={!dirty || busy !== null}>
                {busy === "save" ? "Сохранение…" : "Сохранить"}
              </Button>
            ) : null}
            {record && status === "draft" && canEdit ? (
              <Button onClick={() => void run("submit")} disabled={busy !== null}>
                {busy === "submit" ? "Отправка…" : "Отправить на согласование"}
              </Button>
            ) : null}
            {record && status === "pending-approval" && canApprove ? (
              <Button onClick={() => void run("approve")} disabled={busy !== null}>
                {busy === "approve" ? "Согласование…" : "Согласовать"}
              </Button>
            ) : null}
            {record && status !== "cancelled" && canCancel ? (
              <Button variant="danger" onClick={() => setCancelling(true)} disabled={busy !== null}>
                Отменить запись
              </Button>
            ) : null}
          </div>
        </header>

        {status === "approved" && note ? (
          <Banner tone={note.tone === "danger" ? "danger" : note.tone === "warning" ? "warning" : "info"} title={`Согласовано — действует до ${formatBusinessDate(record!.expiresAt)}`}>
            {note.tone === "danger" ? "Срок истёк: внесите новый документ и согласуйте его." : `Сейчас ${note.text}. Допуск к работе в карточке сотрудника включается вручную.`}
          </Banner>
        ) : null}
        {status === "pending-approval" ? (
          <Banner tone="info" title="На согласовании — только чтение">
            Согласованный документ учитывается в контроле сроков и допуске к работе.
          </Banner>
        ) : null}
        {status === "cancelled" ? (
          <Banner tone="warning" title="Запись отменена">
            Отменённый документ не учитывается в контроле сроков.
          </Banner>
        ) : null}
        {piiHidden ? (
          <Banner tone="info" title="Персональные данные скрыты">
            Номер документа и комментарий видны с правом «Персональные данные сотрудников». При сохранении они не изменятся.
          </Banner>
        ) : null}
        {error ? (
          <Banner tone="danger" title="Не удалось выполнить действие">
            {error}
          </Banner>
        ) : null}

        <CardSection title="Основные реквизиты">
          <div className="grid gap-4 md:grid-cols-2">
            {record ? (
              <ReadOnlyField label="Ресторан" value={restaurantName} />
            ) : (
              <Field label="Ресторан" error={errors.restaurant}>
                {(control) => <Select {...control} value={draft.restaurantExternalId || undefined} onValueChange={(restaurantExternalId) => set({ restaurantExternalId, employeeId: "" })} options={restaurantSelectOptions(scope.restaurants)} placeholder="Выберите ресторан" />}
              </Field>
            )}
            {record ? <ReadOnlyField label="Сотрудник" value={`${record.employeeName} · код ${record.employeeCode}`} /> : <EmployeePicker draft={draft} error={errors.employee} onChange={(employeeId) => set({ employeeId })} />}
            {editable ? (
              <Field label="Тип документа">
                {(control) => <Select {...control} value={draft.documentType} onValueChange={(documentType) => set({ documentType: documentType as DocumentType })} options={DOCUMENT_TYPE_OPTIONS} />}
              </Field>
            ) : (
              <ReadOnlyField label="Тип документа" value={DOCUMENT_TYPE_LABEL[draft.documentType]} />
            )}
            {editable && !piiHidden ? (
              <Field label="Номер" error={errors.documentNumber}>
                {(control) => <Input {...control} autoComplete="off" maxLength={60} value={draft.documentNumber} onChange={(event) => set({ documentNumber: event.target.value })} />}
              </Field>
            ) : (
              <ReadOnlyField label="Номер" value={record?.documentNumber || "—"} />
            )}
            {editable ? (
              <Field label="Дата выдачи" error={errors.issuedAt}>
                {(control) => <Input {...control} type="date" max={todayAlmaty()} value={draft.issuedAt} onChange={(event) => set({ issuedAt: event.target.value })} />}
              </Field>
            ) : (
              <ReadOnlyField label="Дата выдачи" value={formatBusinessDate(draft.issuedAt)} />
            )}
            {editable ? (
              <Field label="Действует до" error={errors.expiresAt} hint="Последний день действия, позже даты выдачи">
                {(control) => <Input {...control} type="date" min={draft.issuedAt || undefined} value={draft.expiresAt} onChange={(event) => set({ expiresAt: event.target.value })} />}
              </Field>
            ) : (
              <ReadOnlyField label="Действует до" value={formatBusinessDate(draft.expiresAt)} />
            )}
            {editable ? (
              <Field label="Кем выдан" error={errors.issuer} className="md:col-span-2">
                {(control) => <Input {...control} autoComplete="off" value={draft.issuer} onChange={(event) => set({ issuer: event.target.value })} placeholder="Поликлиника, лаборатория или СЭС" />}
              </Field>
            ) : (
              <ReadOnlyField label="Кем выдан" value={draft.issuer || "—"} className="md:col-span-2" />
            )}
            <SwitchRow className="md:col-span-2" label="Допущен к работе" hint="По этому документу сотрудник может работать с продуктами" checked={draft.fitForWork} disabled={!editable} onChange={(fitForWork) => set({ fitForWork })} />
            {editable && !piiHidden ? (
              <Field label="Комментарий" className="md:col-span-2" hint="Без диагнозов и медицинских подробностей">
                {(control) => <Textarea {...control} maxLength={500} value={draft.comment} onChange={(event) => set({ comment: event.target.value })} />}
              </Field>
            ) : (
              <ReadOnlyField label="Комментарий" value={piiHidden ? "Скрыт" : record?.comment || "—"} className="md:col-span-2" />
            )}
          </div>
        </CardSection>
      </div>

      {editable ? (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-6 py-3 shadow-panel xl:px-8">
          <p className="text-caption text-muted-foreground">Документ учитывается в контроле сроков после согласования.</p>
          <Button variant="secondary" onClick={() => setDraft(baseline)} disabled={!dirty || busy !== null}>
            Отменить изменения
          </Button>
        </footer>
      ) : null}

      {record ? (
        <ConfirmDialog
          open={cancelling}
          onOpenChange={setCancelling}
          title={`Отменить запись ${record.number}?`}
          description="Отменённый документ не учитывается в контроле сроков. Действие необратимо."
          confirmLabel="Отменить запись"
          cancelLabel="Не отменять"
          reasonLabel={status === "approved" ? "Причина отмены" : undefined}
          danger
          submitting={busy === "cancel"}
          error={cancelling ? error : null}
          onConfirm={(reason) => run("cancel", reason)}
        />
      ) : null}
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}

function EmployeePicker({ draft, error, onChange }: { draft: MedicalDraft; error?: string; onChange: (employeeId: string) => void }) {
  const canSeeEmployees = useCan("office.employees.view")
  const { employees } = usePosEmployees(canSeeEmployees)
  const options = employees
    .filter((employee) => employee.active && employee.restaurants.some((restaurant) => restaurant.externalId === draft.restaurantExternalId))
    .map((employee) => ({ value: employee._id, label: employee.displayName, hint: `код ${employee.code}` }))
  return (
    <Field label="Сотрудник" error={error} hint={!canSeeEmployees ? "Нужно право просматривать сотрудников" : draft.restaurantExternalId ? undefined : "Сначала выберите ресторан"}>
      {(control) => (
        <Combobox
          {...control}
          value={draft.employeeId || undefined}
          onValueChange={onChange}
          options={options}
          disabled={!draft.restaurantExternalId}
          placeholder="Выберите сотрудника"
          searchPlaceholder="ФИО или код"
          emptyText="В этом ресторане нет активных сотрудников"
        />
      )}
    </Field>
  )
}
