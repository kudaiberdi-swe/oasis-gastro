import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { OfficeStatePage } from "@/office/components/state-page"
import { SaveStatus, UnsavedChangesDialog } from "@/office/components/unsaved-changes"
import { useProductPicker } from "@/office/features/nomenclature/data/use-nomenclature"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { useUnsavedChanges } from "@/office/hooks/use-unsaved-changes"
import { Banner, Button, Combobox, ConfirmDialog, DataTable, Field, Input, loadMoreFromPaginated, Switch, useToast, type Column } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { cn, focusRingClass } from "@/shared/lib/utils"

import { formatCoefficient, SIZE_SCALES_PAGE_SIZE, useSizeScaleMutations, useSizeScales, type SizeScale } from "../data/use-size-scales"
import { hasScaleErrors, saveScaleArgs, useSizeScaleDraft, validateScaleDraft, type SizeOptionDraft, type SizeScaleErrors } from "../model/use-size-scale-draft"

const SEARCH_DEBOUNCE_MS = 250

/** «Шкалы размеров» (/office/size-scales, W1-CAT-09): register + editor in the right panel. */
export function SizeScalesWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <SizeScalesRegister />
    </PlatformErrorBoundary>
  )
}

type Selection = { kind: "new" } | { kind: "edit"; externalId: string } | null

export const SIZE_SCALE_COLUMNS: Column<SizeScale>[] = [
  { key: "name", header: "Название", cell: (scale) => <span className="font-semibold">{scale.name}</span> },
  {
    key: "sizes",
    header: "Размеры",
    cell: (scale) => (
      <ul className="flex flex-wrap gap-1.5" aria-label={`Размеры «${scale.name}»`}>
        {[...scale.options]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((option) => (
            <li key={option.externalId} className={cn("inline-flex h-7 items-center rounded-control border border-input bg-muted px-2 text-caption", !option.available && "text-muted-foreground line-through")}>
              {option.label}
            </li>
          ))}
      </ul>
    ),
  },
  { key: "default", header: "По умолчанию", cell: (scale) => scale.options.find((option) => option.isDefault)?.label ?? "—" },
  { key: "products", header: "Блюд", numeric: true, cell: (scale) => scale.products.length },
]

function SizeScalesRegister() {
  const canEdit = useCan("office.size-scales.edit")
  const [searchText, setSearchText] = useState("")
  const [search, setSearch] = useState("")
  const [selection, setSelection] = useState<Selection>(null)
  const list = useSizeScales(search)

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchText), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [searchText])

  const selected = selection?.kind === "edit" ? list.results.find((scale) => scale.externalId === selection.externalId) ?? null : null
  const open = selection?.kind === "new" || selected !== null
  const openNew = () => setSelection({ kind: "new" })

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Input
            type="search"
            aria-label="Поиск"
            placeholder="Название шкалы или размер"
            className="w-full sm:w-[420px]"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
          {canEdit ? (
            <Button onClick={openNew}>
              <Plus aria-hidden />
              Новая шкала
            </Button>
          ) : null}
        </div>
        {list.status === "LoadingFirstPage" ? (
          <OfficeStatePage state={{ kind: "loading" }} />
        ) : list.results.length === 0 ? (
          <div className="rounded-card border border-border bg-card">
            <OfficeStatePage
              state={{
                kind: "empty",
                title: "Шкалы не найдены",
                description: search.trim() ? "Измените запрос поиска." : "Создайте шкалу — например «0,5 л · 1 л» — и привяжите к ней блюда.",
                action:
                  canEdit && !search.trim() ? (
                    <Button variant="secondary" onClick={openNew}>
                      Новая шкала
                    </Button>
                  ) : undefined,
              }}
            />
            <p className="border-t border-border px-4 py-2 text-caption text-muted-foreground">Загружено записей: 0 · Все записи загружены</p>
          </div>
        ) : (
          <DataTable
            caption="Шкалы размеров"
            columns={SIZE_SCALE_COLUMNS}
            rows={list.results}
            getRowId={(scale) => scale.externalId}
            selectedId={selected?.externalId ?? null}
            onRowClick={(scale) => setSelection({ kind: "edit", externalId: scale.externalId })}
            loadMore={loadMoreFromPaginated(list, SIZE_SCALES_PAGE_SIZE)}
          />
        )}
      </div>
      {open ? (
        <SizeScaleEditor
          key={selected?.externalId ?? "new"}
          scale={selected}
          canEdit={canEdit}
          onClose={() => setSelection(null)}
          onSaved={(externalId) => setSelection({ kind: "edit", externalId })}
        />
      ) : null}
    </div>
  )
}

export function SizeScaleEditor({ scale, canEdit, onClose, onSaved }: { scale: SizeScale | null; canEdit: boolean; onClose: () => void; onSaved: (externalId: string) => void }) {
  const { draft, dirty, setName, setProducts, updateOption, setDefault, addOption, removeOption, moveOption, markSaved } = useSizeScaleDraft(scale)
  const blocker = useUnsavedChanges(dirty)
  const { save } = useSizeScaleMutations()
  const products = useProductPicker(useCan("office.nomenclature.view"))
  const toast = useToast()
  const [errors, setErrors] = useState<SizeScaleErrors>({ rows: {} })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const readOnly = !canEdit
  const radioName = `default-size-${scale?.externalId ?? "new"}`

  // Dishes already on the scale stay labelled even when they are beyond the picker's page.
  const productOptions = useMemo(() => {
    const options = [...products.options]
    for (const product of scale?.products ?? []) if (!options.some((option) => option.value === product.externalId)) options.push({ value: product.externalId, label: product.name, hint: undefined })
    return options
  }, [products.options, scale?.products])

  const requestClose = () => (dirty ? setConfirmClose(true) : onClose())

  async function submit() {
    if (readOnly || saving) return
    const found = validateScaleDraft(draft)
    setErrors(found)
    if (hasScaleErrors(found)) return
    setSaving(true)
    setError(null)
    try {
      const externalId = await save(saveScaleArgs(scale?.externalId, draft))
      markSaved()
      toast("Шкала сохранена", "success")
      onSaved(externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить шкалу"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <RightPanel
        open
        onOpenChange={(next) => {
          if (!next) requestClose()
        }}
        title={scale ? scale.name : "Новая шкала"}
        footer={
          canEdit ? (
            <>
              <SaveStatus state={saving ? "saving" : dirty ? "dirty" : "clean"} />
              <Button onClick={() => void submit()} disabled={saving || (!dirty && scale !== null)}>
                {saving ? "Сохранение…" : "Сохранить"}
              </Button>
            </>
          ) : undefined
        }
      >
        <form
          aria-label="Шкала размеров"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          className="flex flex-col gap-5"
        >
          {error ? (
            <Banner tone="danger" title="Не удалось сохранить">
              {error}
            </Banner>
          ) : null}
          <Field label="Название" error={errors.name}>
            {(control) => <Input {...control} value={draft.name} onChange={(event) => setName(event.target.value)} disabled={readOnly} autoComplete="off" />}
          </Field>

          <section aria-label="Размеры" className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-title-sm font-semibold">Размеры</h3>
              {canEdit ? (
                <Button variant="secondary" size="sm" onClick={addOption}>
                  <Plus aria-hidden />
                  Размер
                </Button>
              ) : null}
            </div>
            {errors.options ? (
              <p role="alert" className="text-caption text-destructive">
                {errors.options}
              </p>
            ) : null}
            <ol className="flex flex-col gap-3">
              {draft.options.map((option, index) => (
                <SizeOptionRow
                  key={option.key}
                  option={option}
                  index={index}
                  count={draft.options.length}
                  radioName={radioName}
                  errors={errors.rows[option.key]}
                  readOnly={readOnly}
                  onChange={(patch) => updateOption(option.key, patch)}
                  onDefault={() => setDefault(option.key)}
                  onMove={(direction) => moveOption(option.key, direction)}
                  onRemove={() => removeOption(option.key)}
                />
              ))}
            </ol>
          </section>

          <Field label="Блюда со шкалой" hint="Блюдо с другой шкалой перейдёт на эту">
            {(control) => (
              <Combobox
                {...control}
                multiple
                value={draft.productExternalIds}
                onValueChange={setProducts}
                options={productOptions}
                placeholder="Выберите блюда"
                searchPlaceholder="Найти блюдо"
                disabled={readOnly}
              />
            )}
          </Field>
        </form>
      </RightPanel>
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Закрыть без сохранения?"
        description="Изменения шкалы не сохранены и будут потеряны."
        confirmLabel="Закрыть без сохранения"
        cancelLabel="Остаться"
        onConfirm={() => {
          setConfirmClose(false)
          onClose()
        }}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </>
  )
}

function SizeOptionRow({
  option,
  index,
  count,
  radioName,
  errors,
  readOnly,
  onChange,
  onDefault,
  onMove,
  onRemove,
}: {
  option: SizeOptionDraft
  index: number
  count: number
  radioName: string
  errors: SizeScaleErrors["rows"][string] | undefined
  readOnly: boolean
  onChange: (patch: Partial<SizeOptionDraft>) => void
  onDefault: () => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}) {
  const title = option.label.trim() || `Размер ${index + 1}`
  const iconButton = cn("grid size-9 place-items-center rounded-control text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40", focusRingClass)
  return (
    <li aria-label={title} className="flex flex-col gap-3 rounded-card border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-body-sm font-medium text-foreground">
          <input type="radio" name={radioName} checked={option.isDefault} onChange={onDefault} disabled={readOnly} className={cn("size-4 accent-primary", focusRingClass)} />
          По умолчанию
        </label>
        <label className="flex items-center gap-2 text-body-sm text-foreground">
          <Switch checked={option.available} onCheckedChange={(available) => onChange({ available })} disabled={readOnly} aria-label={`Доступен — ${title}`} />
          Доступен
        </label>
        {!readOnly ? (
          <div className="flex items-center">
            <button type="button" aria-label={`Выше — ${title}`} className={iconButton} disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp className="size-4" />
            </button>
            <button type="button" aria-label={`Ниже — ${title}`} className={iconButton} disabled={index === count - 1} onClick={() => onMove(1)}>
              <ArrowDown className="size-4" />
            </button>
            <button type="button" aria-label={`Удалить — ${title}`} className={cn(iconButton, "hover:text-destructive")} onClick={onRemove}>
              <Trash2 className="size-4" />
            </button>
          </div>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Для кассира" error={errors?.label}>
          {(control) => <Input {...control} value={option.label} onChange={(event) => onChange({ label: event.target.value })} disabled={readOnly} placeholder="0,5 л" autoComplete="off" />}
        </Field>
        <Field label="Қаз">
          {(control) => <Input {...control} value={option.labelKk} onChange={(event) => onChange({ labelKk: event.target.value })} disabled={readOnly} autoComplete="off" />}
        </Field>
        <Field label="Для кухни" error={errors?.kitchenLabel}>
          {(control) => <Input {...control} value={option.kitchenLabel} onChange={(event) => onChange({ kitchenLabel: event.target.value })} disabled={readOnly} autoComplete="off" />}
        </Field>
        <Field label="Коэффициент цены" error={errors?.coefficient}>
          {(control) => <Input {...control} inputMode="decimal" value={option.coefficient} onChange={(event) => onChange({ coefficient: event.target.value })} disabled={readOnly} />}
        </Field>
        <Field label="Коэффициент списания" error={errors?.writeOffCoefficient} hint={option.writeOffCoefficient.trim() ? undefined : `Пусто — как цена (${formatCoefficient(Number(option.coefficient.replace(",", ".")) || 0)})`}>
          {(control) => (
            <Input {...control} inputMode="decimal" value={option.writeOffCoefficient} onChange={(event) => onChange({ writeOffCoefficient: event.target.value })} disabled={readOnly} />
          )}
        </Field>
      </div>
    </li>
  )
}
