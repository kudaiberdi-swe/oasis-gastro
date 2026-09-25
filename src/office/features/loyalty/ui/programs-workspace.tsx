import { useEffect, useMemo, useRef, useState } from "react"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { OfficeStatePage } from "@/office/components/state-page"
import { PlatformErrorBoundary, usePlatformScope } from "@/office/features/platform/data/use-platform"
import { SwitchRow } from "@/office/features/stock/ui/master-list"
import { MasterPanel, useMasterSelection } from "@/office/features/stock/ui/master-panel"
import { Banner, Button, Combobox, ConfirmDialog, EmptyState, Field, Input, Select, StatusPill, Switch, useToast, type Column } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatPercent } from "@/shared/lib/format"

import { useCategories, usePrograms, useProgramMutations, type GuestCategory, type LoyaltyProgram, type ProgramOverlap } from "../data/use-office-loyalty"
import { PROGRAM_KIND_LABELS, PROGRAM_TABS, programDraftOf, programPeriod, programSaveArgs, validateProgram, type DraftErrors, type ProgramDraft, type ProgramKind } from "../model/loyalty-model"
import { FormSection } from "./guest-editor"
import { LoyaltyRegister } from "./loyalty-register"

const SECTION = "loyalty-programs"
const ALL_GUESTS = "__all__"

/** «Программы лояльности» (/office/loyalty-programs/:id?, W1-LOY-05): publish lifecycle, overlap warnings. */
export function LoyaltyProgramsWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <Programs />
    </PlatformErrorBoundary>
  )
}

function Programs() {
  const canEdit = useCan("office.loyalty-programs.edit")
  const selection = useMasterSelection(SECTION)
  const scope = usePlatformScope()
  const { programs } = usePrograms()
  const { categories } = useCategories()
  const [tab, setTab] = useState<string>("all")
  const [search, setSearch] = useState("")
  const [template, setTemplate] = useState<LoyaltyProgram | null>(null)
  const [overlaps, setOverlaps] = useState<{
    externalId: string
    overlaps: ProgramOverlap[]
  } | null>(null)
  const formOpen = (selection.isNew && canEdit) || selection.selectedId !== null

  const rows = useMemo(() => {
    if (!programs) return undefined
    const needle = search.trim().toLocaleLowerCase("ru")
    return programs.filter((program) => (tab === "all" || program.status === tab) && (!needle || program.name.toLocaleLowerCase("ru").includes(needle)))
  }, [programs, tab, search])
  const selected = programs?.find((program) => program.externalId === selection.selectedId)
  const categoryName = (externalId: string | undefined) => (externalId ? (categories?.find((row) => row.externalId === externalId)?.name ?? externalId) : "Все гости")
  const restaurantsLabel = (ids: string[]) => (ids.includes("*") ? "Вся сеть" : ids.map((id) => scope.restaurantName(id)).join(", "))

  const columns: Column<LoyaltyProgram>[] = [
    {
      key: "name",
      header: "Название",
      cell: (program) => (
        <span className="flex flex-col">
          <span className="font-semibold">{program.name}</span>
          <span className="text-caption text-muted-foreground">
            {PROGRAM_KIND_LABELS[program.programKind]} · {categoryName(program.categoryExternalId)} · {restaurantsLabel(program.restaurantExternalIds)}
          </span>
        </span>
      ),
    },
    {
      key: "accrual",
      header: "Начисление, %",
      numeric: true,
      cell: (program) => formatPercent(program.accrualPercent),
    },
    {
      key: "redemption",
      header: "Макс. списание, %",
      numeric: true,
      cell: (program) => formatPercent(program.maxRedemptionPercent),
    },
    {
      key: "period",
      header: "Период",
      cell: (program) => <span className="whitespace-nowrap">{programPeriod(program)}</span>,
    },
    {
      key: "priority",
      header: "Приоритет",
      numeric: true,
      cell: (program) => program.priority,
    },
    {
      key: "status",
      header: "Статус",
      cell: (program) => <StatusPill domain="document" status={program.status} />,
    },
  ]

  function openNew(from: LoyaltyProgram | null) {
    setTemplate(from)
    selection.openNew()
  }

  return (
    <div className="flex min-h-0 flex-1">
      <LoyaltyRegister
        caption="Программы лояльности"
        tabs={PROGRAM_TABS}
        tab={tab}
        onTabChange={setTab}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Поиск: программы лояльности"
        createLabel={canEdit ? "Новая программа" : undefined}
        onCreate={() => openNew(null)}
        formOpen={formOpen}
        columns={columns}
        rows={rows}
        getRowId={(program) => program.externalId}
        selectedId={selection.selectedId}
        onSelect={(program) => selection.select(program.externalId)}
        unfiltered={tab === "all" && !search.trim()}
        emptyTitle="Программ пока нет"
        emptyDescription="Создайте программу-черновик: процент начисления, лимит оплаты баллами и рестораны."
      />
      {selection.isNew && canEdit ? (
        <ProgramEditor
          key={`new:${template?.externalId ?? ""}`}
          program={null}
          template={template}
          categories={categories}
          canEdit={canEdit}
          overlaps={null}
          onSaved={(result) => {
            setOverlaps(result)
            selection.select(result.externalId)
          }}
          onCopy={openNew}
          onClose={selection.close}
        />
      ) : null}
      {selection.selectedId !== null && selected ? (
        <ProgramEditor
          key={selected.externalId}
          program={selected}
          template={null}
          categories={categories}
          canEdit={canEdit}
          overlaps={overlaps?.externalId === selected.externalId ? overlaps.overlaps : null}
          onSaved={setOverlaps}
          onCopy={openNew}
          onClose={selection.close}
        />
      ) : null}
      {selection.selectedId !== null && !selected ? (
        <RightPanel open onOpenChange={(open) => !open && selection.close()} title="Программа лояльности">
          {programs === undefined ? <OfficeStatePage state={{ kind: "loading" }} /> : <EmptyState title="Программа не найдена" description="Возможно, ссылка устарела." />}
        </RightPanel>
      ) : null}
    </div>
  )
}

export function OverlapBanner({ overlaps }: { overlaps: ProgramOverlap[] }) {
  if (!overlaps.length) return null
  const clash = overlaps.some((overlap) => overlap.samePriority)
  return (
    <Banner tone={clash ? "danger" : "warning"} title={clash ? "Пересечение при том же приоритете" : "Пересекается с опубликованными программами"}>
      <ul className="flex flex-col gap-0.5">
        {overlaps.map((overlap) => (
          <li key={overlap.externalId}>
            «{overlap.name}» — приоритет {overlap.priority}
            {overlap.samePriority ? " (такой же)" : ""}
          </li>
        ))}
      </ul>
      <p className="mt-1">{clash ? "Публикация будет отклонена: задайте другой приоритет." : "Для гостя сработает программа с большим приоритетом (программа категории — раньше общей)."}</p>
    </Banner>
  )
}

function ProgramEditor({
  program,
  template,
  categories,
  canEdit,
  overlaps,
  onSaved,
  onCopy,
  onClose,
}: {
  program: LoyaltyProgram | null
  template: LoyaltyProgram | null
  categories: GuestCategory[] | undefined
  canEdit: boolean
  overlaps: ProgramOverlap[] | null
  onSaved: (result: { externalId: string; overlaps: ProgramOverlap[] }) => void
  onCopy: (program: LoyaltyProgram) => void
  onClose: () => void
}) {
  const scope = usePlatformScope()
  const { saveProgram } = useProgramMutations()
  const toast = useToast()
  const [baseline, setBaseline] = useState<ProgramDraft>(() => {
    const draft = programDraftOf(program ?? template, Date.now(), scope.network)
    return template && !program ? { ...draft, name: `${template.name} (копия)` } : draft
  })
  const [draft, setDraft] = useState(baseline)
  const [errors, setErrors] = useState<DraftErrors<keyof ProgramDraft>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<{
    externalId: string
    overlaps: ProgramOverlap[]
  } | null>(null)
  const isDraft = !program || program.status === "draft"
  const readOnly = !canEdit || !isDraft
  // A fresh copy is unsaved work until its first save.
  const pristineCopy = !program && template !== null && saved === null
  const dirty = !readOnly && (JSON.stringify(draft) !== JSON.stringify(baseline) || pristineCopy)
  const reported = useRef<typeof saved>(null)

  // Report once the form is clean, so the unsaved-changes guard lets a navigation to the new id through.
  useEffect(() => {
    if (saved && !dirty && reported.current !== saved) {
      reported.current = saved
      onSaved(saved)
    }
  }, [saved, dirty, onSaved])

  const set = (patch: Partial<ProgramDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch)) delete next[key as keyof ProgramDraft]
      return next
    })
  }

  async function submit() {
    if (readOnly || saving) return
    const found = validateProgram(draft)
    setErrors(found)
    if (Object.keys(found).length) return
    setSaving(true)
    setError(null)
    try {
      const result = await saveProgram(programSaveArgs(draft, program))
      setBaseline(draft)
      toast("Черновик программы сохранён", "success")
      setSaved(result)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить программу"))
    } finally {
      setSaving(false)
    }
  }

  const field = (key: "accrualPercent" | "maxRedemptionPercent" | "welcomeBonus" | "expirationDays" | "priority", label: string, hint?: string) => (
    <Field label={label} error={errors[key]} hint={hint}>
      {(control) => (
        <Input {...control} inputMode="decimal" value={draft[key]} onChange={(event) => set({ [key]: event.target.value } as Partial<ProgramDraft>)} disabled={readOnly} autoComplete="off" />
      )}
    </Field>
  )
  const restaurantOptions = scope.restaurants.map((restaurant) => ({
    value: restaurant.externalId,
    label: restaurant.name,
  }))
  const categoryOptions = [
    { value: ALL_GUESTS, label: "Все гости" },
    ...(categories ?? []).filter((row) => row.active || row.externalId === draft.categoryExternalId).map((row) => ({ value: row.externalId, label: row.name })),
  ]

  return (
    <MasterPanel
      title={program ? program.name : "Новая программа"}
      formLabel="Программа лояльности"
      dirty={dirty}
      saving={saving}
      canEdit={canEdit && isDraft}
      isNew={!program}
      error={error}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      {program && !isDraft ? (
        <Banner tone="info" title="Изменить можно только черновик">
          Условия опубликованной или отключённой программы не меняются задним числом. Для новых условий создайте копию-черновик.
          {canEdit ? (
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => onCopy(program)}>
              Создать копию черновиком
            </Button>
          ) : null}
        </Banner>
      ) : null}
      {overlaps ? <OverlapBanner overlaps={overlaps} /> : null}
      <FormSection title="Основные реквизиты">
        <Field label="Название" error={errors.name}>
          {(control) => <Input {...control} value={draft.name} onChange={(event) => set({ name: event.target.value })} disabled={readOnly} autoComplete="off" />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Тип программы">
            {(control) => (
              <Select
                {...control}
                value={draft.programKind}
                onValueChange={(value) => set({ programKind: value as ProgramKind })}
                options={(Object.keys(PROGRAM_KIND_LABELS) as ProgramKind[]).map((value) => ({
                  value,
                  label: PROGRAM_KIND_LABELS[value],
                }))}
                disabled={readOnly}
              />
            )}
          </Field>
          <Field label="Категория гостей" hint="Программа категории выбирается раньше общей">
            {(control) => (
              <Select
                {...control}
                value={draft.categoryExternalId || ALL_GUESTS}
                onValueChange={(value) => set({ categoryExternalId: value === ALL_GUESTS ? "" : value })}
                options={categoryOptions}
                disabled={readOnly}
              />
            )}
          </Field>
        </div>
      </FormSection>
      <FormSection title="Параметры">
        <div className="grid gap-4 sm:grid-cols-2">
          {field("accrualPercent", "Начисление, %", "Баллов с оплаченной суммы")}
          {field("maxRedemptionPercent", "Максимальная оплата баллами, %", "Доля чека, которую можно оплатить")}
          {field("welcomeBonus", "Приветственный бонус, баллов")}
          {field("expirationDays", "Срок жизни бонусов, дней", "Пусто — бессрочно")}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Начало" error={errors.startsAt}>
            {(control) => <Input {...control} type="date" value={draft.startsAt} onChange={(event) => set({ startsAt: event.target.value })} disabled={readOnly} />}
          </Field>
          <Field label="Окончание (включительно)" error={errors.endsAt} hint="Пусто — без срока">
            {(control) => <Input {...control} type="date" value={draft.endsAt} onChange={(event) => set({ endsAt: event.target.value })} disabled={readOnly} />}
          </Field>
        </div>
        {field("priority", "Приоритет", "При пересечении программ срабатывает большая цифра")}
      </FormSection>
      <FormSection title="Рестораны">
        {scope.network ? (
          <SwitchRow label="Вся сеть" hint="Программа действует во всех ресторанах, в том числе новых">
            <Switch checked={draft.network} onCheckedChange={(network) => set({ network })} disabled={readOnly} aria-label="Вся сеть" />
          </SwitchRow>
        ) : draft.network ? (
          <p className="text-body-sm">Вся сеть</p>
        ) : null}
        {!draft.network ? (
          <Field label="Рестораны программы" error={errors.restaurantExternalIds}>
            {(control) => (
              <Combobox
                {...control}
                multiple
                value={draft.restaurantExternalIds}
                onValueChange={(restaurantExternalIds) => set({ restaurantExternalIds })}
                options={restaurantOptions}
                placeholder="Выберите рестораны"
                searchPlaceholder="Поиск ресторана"
                disabled={readOnly}
              />
            )}
          </Field>
        ) : null}
      </FormSection>
      {program ? <ProgramPublication program={program} disabled={dirty} /> : null}
    </MasterPanel>
  )
}

function ProgramPublication({ program, disabled }: { program: LoyaltyProgram; disabled: boolean }) {
  const canApprove = useCan("office.loyalty-programs.approve")
  const { transitionProgram } = useProgramMutations()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: "publish" | "deactivate") {
    setBusy(true)
    setError(null)
    try {
      await transitionProgram({ externalId: program.externalId, action })
      toast(action === "publish" ? "Программа опубликована" : "Программа отключена", "success")
      setConfirming(false)
    } catch (caught) {
      setError(errorMessage(caught, action === "publish" ? "Не удалось опубликовать" : "Не удалось отключить"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSection title="Публикация">
      <div className="flex items-center gap-3 text-body-sm">
        <span className="text-muted-foreground">Статус</span>
        <StatusPill domain="document" status={program.status} />
      </div>
      {!canApprove ? (
        <p className="text-caption text-muted-foreground">Публикует и отключает программы пользователь с правом согласования.</p>
      ) : program.status === "draft" ? (
        <>
          <p className="text-caption text-muted-foreground">После публикации касса начнёт применять программу; условия больше не меняются.</p>
          <Button variant="secondary" className="self-start" disabled={busy || disabled} onClick={() => void run("publish")}>
            {busy ? "Публикация…" : "Опубликовать"}
          </Button>
        </>
      ) : program.status === "published" ? (
        <Button variant="danger" size="sm" className="self-start" disabled={busy} onClick={() => setConfirming(true)}>
          Отключить программу
        </Button>
      ) : (
        <p className="text-caption text-muted-foreground">Отключённую программу нельзя включить снова — создайте копию черновиком.</p>
      )}
      {disabled && program.status === "draft" && canApprove ? <p className="text-caption text-warning-foreground">Сначала сохраните изменения.</p> : null}
      {error && !confirming ? (
        <p role="alert" className="text-body-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Отключить программу?"
        description="Касса перестанет начислять и списывать баллы по этой программе. Балансы гостей сохранятся."
        confirmLabel="Отключить"
        submitting={busy}
        error={error}
        onConfirm={() => run("deactivate")}
      />
    </FormSection>
  )
}
