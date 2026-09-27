import { useEffect, useMemo, useRef, useState } from "react"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { OfficeStatePage } from "@/office/components/state-page"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { SwitchRow } from "@/office/features/stock/ui/master-list"
import { MasterPanel, useMasterSelection } from "@/office/features/stock/ui/master-panel"
import { EmptyState, Field, Input, MoneyInput, Select, StatusPill, Switch, useToast, type Column } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { cn, focusRingClass } from "@/shared/lib/utils"

import { useCategories, useSaveCategory, type GuestCategory } from "../data/use-office-loyalty"
import {
  ASSIGNMENT_LABELS,
  CATEGORY_COLORS,
  categoryColorClass,
  categoryCondition,
  categoryDraftOf,
  categorySaveArgs,
  STATUS_TABS,
  validateCategory,
  type Assignment,
  type CategoryDraft,
  type DraftErrors,
} from "../model/loyalty-model"
import { FormSection } from "./guest-editor"
import { LoyaltyRegister } from "./loyalty-register"

const SECTION = "guest-categories"

/** «Категории гостей» (/office/guest-categories/:id?, W1-LOY-06): segments, conditions and levels. */
export function GuestCategoriesWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <Categories />
    </PlatformErrorBoundary>
  )
}

function Categories() {
  const canEdit = useCan("office.guest-categories.edit")
  const selection = useMasterSelection(SECTION)
  const { categories } = useCategories()
  const [tab, setTab] = useState<string>("all")
  const [search, setSearch] = useState("")
  const formOpen = (selection.isNew && canEdit) || selection.selectedId !== null

  const rows = useMemo(() => {
    if (!categories) return undefined
    const needle = search.trim().toLocaleLowerCase("ru")
    return [...categories]
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .filter((row) => (tab === "all" || (tab === "active") === row.active) && (!needle || `${row.name} ${row.code}`.toLocaleLowerCase("ru").includes(needle)))
  }, [categories, tab, search])
  const selected = categories?.find((row) => row.externalId === selection.selectedId)

  const columns: Column<GuestCategory>[] = [
    {
      key: "name",
      header: "Название",
      cell: (row) => (
        <span className="flex items-center gap-2">
          <span aria-hidden className={cn("size-3 shrink-0 rounded-round", categoryColorClass(row.color))} />
          <span className="font-semibold">{row.name}</span>
        </span>
      ),
    },
    {
      key: "code",
      header: "Код",
      cell: (row) => <span className="text-muted-foreground">{row.code}</span>,
    },
    {
      key: "condition",
      header: "Условие",
      cell: (row) => categoryCondition(row),
    },
    {
      key: "status",
      header: "Статус",
      cell: (row) => <StatusPill domain="document" status={row.active ? "active" : "inactive"} />,
    },
  ]

  return (
    <div className="flex min-h-0 flex-1">
      <LoyaltyRegister
        caption="Категории гостей"
        tabs={STATUS_TABS}
        tab={tab}
        onTabChange={setTab}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Поиск: категории гостей"
        createLabel={canEdit ? "Новая категория" : undefined}
        onCreate={selection.openNew}
        formOpen={formOpen}
        columns={columns}
        rows={rows}
        getRowId={(row) => row.externalId}
        selectedId={selection.selectedId}
        onSelect={(row) => selection.select(row.externalId)}
        unfiltered={tab === "all" && !search.trim()}
        emptyTitle="Категорий пока нет"
        emptyDescription="Заведите сегменты гостей: вручную, автоматически по обороту и визитам или по умолчанию."
      />
      {selection.isNew && canEdit ? <CategoryEditor key="new" category={null} all={categories ?? []} canEdit={canEdit} onSaved={selection.select} onClose={selection.close} /> : null}
      {selection.selectedId !== null && selected ? (
        <CategoryEditor key={selected.externalId} category={selected} all={categories ?? []} canEdit={canEdit} onSaved={selection.select} onClose={selection.close} />
      ) : null}
      {selection.selectedId !== null && !selected ? (
        <RightPanel open onOpenChange={(open) => !open && selection.close()} title="Категория гостей">
          {categories === undefined ? <OfficeStatePage state={{ kind: "loading" }} /> : <EmptyState title="Категория не найдена" description="Возможно, ссылка устарела." />}
        </RightPanel>
      ) : null}
    </div>
  )
}

function CategoryEditor({
  category,
  all,
  canEdit,
  onSaved,
  onClose,
}: {
  category: GuestCategory | null
  all: GuestCategory[]
  canEdit: boolean
  onSaved: (externalId: string) => void
  onClose: () => void
}) {
  const saveCategory = useSaveCategory()
  const toast = useToast()
  const [baseline, setBaseline] = useState(() => categoryDraftOf(category))
  const [draft, setDraft] = useState(baseline)
  const [errors, setErrors] = useState<DraftErrors<keyof CategoryDraft>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const readOnly = !canEdit
  const reported = useRef<string | null>(null)

  useEffect(() => {
    if (savedId && !dirty && reported.current !== savedId && savedId !== category?.externalId) {
      reported.current = savedId
      onSaved(savedId)
    }
  }, [savedId, dirty, category?.externalId, onSaved])

  const set = (patch: Partial<CategoryDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch)) delete next[key as keyof CategoryDraft]
      return next
    })
  }

  async function submit() {
    if (readOnly || saving) return
    const found = validateCategory(
      draft,
      all.filter((row) => row.externalId !== category?.externalId),
    )
    setErrors(found)
    if (Object.keys(found).length) return
    setSaving(true)
    setError(null)
    try {
      const externalId = await saveCategory(categorySaveArgs(draft, category))
      setBaseline(draft)
      toast("Категория сохранена", "success")
      setSavedId(externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить категорию"))
    } finally {
      setSaving(false)
    }
  }

  const automatic = draft.assignment === "automatic"
  const count = (key: "minimumVisits" | "validDays", label: string, hint: string) => (
    <Field label={label} error={errors[key]} hint={hint}>
      {(control) => (
        <Input
          {...control}
          inputMode="numeric"
          value={draft[key]}
          onChange={(event) =>
            set({
              [key]: event.target.value.replace(/\D/g, ""),
            } as Partial<CategoryDraft>)
          }
          disabled={readOnly}
          autoComplete="off"
        />
      )}
    </Field>
  )

  return (
    <MasterPanel
      title={category ? category.name : "Новая категория"}
      formLabel="Категория гостей"
      dirty={dirty}
      saving={saving}
      canEdit={canEdit}
      isNew={!category}
      error={error}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <FormSection title="Основные реквизиты">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Название" error={errors.name}>
            {(control) => <Input {...control} value={draft.name} onChange={(event) => set({ name: event.target.value })} disabled={readOnly} autoComplete="off" />}
          </Field>
          <Field label="Код" error={errors.code} hint="Латиница, цифры и дефис: gold, vip">
            {(control) => <Input {...control} value={draft.code} onChange={(event) => set({ code: event.target.value })} disabled={readOnly} autoComplete="off" />}
          </Field>
        </div>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-body-sm font-medium text-muted-foreground">Цвет метки</legend>
          <div role="radiogroup" aria-label="Цвет метки" className="flex flex-wrap gap-2">
            {CATEGORY_COLORS.map((color) => {
              const active = draft.color === color.token
              return (
                <button
                  key={color.token}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={color.label}
                  title={color.label}
                  disabled={readOnly}
                  onClick={() => set({ color: color.token })}
                  className={cn(
                    "grid size-11 place-items-center rounded-control border bg-card disabled:opacity-50",
                    active ? "border-2 border-foreground" : "border-input hover:bg-muted",
                    focusRingClass,
                  )}
                >
                  <span aria-hidden className={cn("size-5 rounded-round", color.className)} />
                </button>
              )
            })}
          </div>
        </fieldset>
        <SwitchRow label="Категория активна" hint="Неактивную нельзя назначить новым гостям">
          <Switch checked={draft.active} onCheckedChange={(active) => set({ active })} disabled={readOnly} aria-label="Категория активна" />
        </SwitchRow>
      </FormSection>
      <FormSection title="Условие">
        <Field
          label="Назначение"
          hint={
            automatic
              ? "Пересчитывается каждую ночь по обороту и визитам; ручные категории не снимаются"
              : draft.assignment === "default"
                ? "Для всех гостей без другой категории"
                : "Кассир или менеджер назначает в карточке гостя"
          }
        >
          {(control) => (
            <Select
              {...control}
              value={draft.assignment}
              onValueChange={(value) => set({ assignment: value as Assignment })}
              options={(Object.keys(ASSIGNMENT_LABELS) as Assignment[]).map((value) => ({ value, label: ASSIGNMENT_LABELS[value] }))}
              disabled={readOnly}
            />
          )}
        </Field>
        {automatic ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Минимальный оборот" error={errors.minimumSpend}>
              {(control) => <MoneyInput {...control} value={draft.minimumSpend} onValueChange={(minimumSpend) => set({ minimumSpend })} disabled={readOnly} />}
            </Field>
            {count("minimumVisits", "Минимум визитов", "0 — без порога")}
            {count("validDays", "Срок категории, дней", "0 — бессрочно")}
          </div>
        ) : null}
      </FormSection>
    </MasterPanel>
  )
}
