import { Plus, Search } from "lucide-react"
import { useEffect, useId, useState } from "react"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { SaveStatus } from "@/office/components/unsaved-changes"
import { MasterDetail, MasterListBlock, MasterRow, MasterRows } from "@/office/features/delivery/ui/master-detail"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { useSupplierOptions } from "@/office/features/stock/data/use-stock-master"
import { Banner, Button, Combobox, Field, FilterTabs, Input, Select, StatusPill, useToast } from "@/shared/components/ui"
import { formatAlmatyDate } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"

import { usePriceList, usePriceListMutations, usePriceLists, useUnitOptions, type PriceList, type PriceListKind, type PriceListRow, type PriceListStatus } from "../data/use-price-lists"
import {
  draftFromPriceList,
  emptyPriceListDraft,
  hasPriceListErrors,
  KIND_OPTIONS,
  POLICY_OPTIONS,
  priceListSignature,
  savePriceListArgs,
  validatePriceList,
  type PriceListDraft,
  type PriceListErrors,
} from "../model/price-list-draft"
import { PriceListLinesTable } from "./price-list-lines-table"

const ALL = "all"

const STATUS_TABS: { value: typeof ALL | PriceListStatus; label: string }[] = [
  { value: ALL, label: "Все" },
  { value: "draft", label: "Черновики" },
  { value: "published", label: "Опубликованные" },
  { value: "expired", label: "Истёкшие" },
]

const KIND_FILTER = [{ value: ALL, label: "Все виды" }, ...KIND_OPTIONS]

/** «Прайс-листы» (/office/price-lists, W2-CAT-15, office/15): the Master template — list + the price list card. */
export function PriceListsWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <PriceListsContent />
    </PlatformErrorBoundary>
  )
}

type Selection = { kind: "new" } | { kind: "edit"; externalId: string } | null

function PriceListsContent() {
  const canEdit = useCan("office.price-lists.edit")
  const panelId = useId()
  const [status, setStatus] = useState<typeof ALL | PriceListStatus>(ALL)
  const [kind, setKind] = useState<typeof ALL | PriceListKind>(ALL)
  const [search, setSearch] = useState("")
  const [selection, setSelection] = useState<Selection>(null)
  const list = usePriceLists({ kind: kind === ALL ? undefined : kind, status: status === ALL ? undefined : status, search })
  const selectedId = selection?.kind === "edit" ? selection.externalId : null
  const selected = usePriceList(selectedId)
  const editing = selection?.kind === "new" || (selectedId !== null && selected !== null)
  const [dirty, setDirty] = useState(false)

  const meta = (row: PriceListRow) => `${row.supplier?.name ?? row.kindLabel} · v${row.version}`
  const title = selection?.kind === "new" ? "Новая запись" : selected ? selected.name : "Прайс-лист"

  return (
    <MasterDetail
      toolbar={
        canEdit ? (
          <Button variant={editing ? "secondary" : "primary"} onClick={() => setSelection({ kind: "new" })}>
            <Plus aria-hidden />
            Новая запись
          </Button>
        ) : null
      }
      list={
        <>
          <FilterTabs aria-label="Статус прайс-листов" value={status} onValueChange={(value) => setStatus(value as typeof status)} items={STATUS_TABS} panelId={panelId} />
          <div id={panelId} role="tabpanel" aria-label={STATUS_TABS.find((tab) => tab.value === status)?.label} className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">Поиск прайс-листов</span>
                <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input type="search" placeholder="Название или поставщик" className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} />
              </label>
              <Select aria-label="Вид прайс-листа" className="w-40" value={kind} onValueChange={(value) => setKind(value as typeof kind)} options={KIND_FILTER} />
            </div>
            {list.status === "LoadingFirstPage" ? (
              <OfficeStatePage state={{ kind: "loading" }} />
            ) : (
              <MasterListBlock title="Прайс-листы" caption="Закупочные цены поставщиков и внутренние цены">
                {list.results.length === 0 ? (
                  <p className="px-4 py-8 text-center text-body-sm text-muted-foreground">{status === ALL && !search.trim() && kind === ALL ? "Прайс-листов пока нет." : "Ничего не найдено по выбранным фильтрам"}</p>
                ) : (
                  <MasterRows>
                    {list.results.map((row) => (
                      <MasterRow
                        key={row.externalId}
                        active={row.externalId === selectedId}
                        onSelect={() => setSelection({ kind: "edit", externalId: row.externalId })}
                        title={row.name}
                        meta={meta(row)}
                        trailing={<StatusPill domain="price-list" status={row.status} />}
                      />
                    ))}
                  </MasterRows>
                )}
                {list.status === "CanLoadMore" ? (
                  <div className="border-t border-border p-2">
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => list.loadMore(50)}>
                      Показать ещё
                    </Button>
                  </div>
                ) : null}
              </MasterListBlock>
            )}
          </div>
        </>
      }
      cardTitle={title}
      cardCaption={selected ? `${selected.supplier?.name ?? selected.kindLabel} · v${selected.version}` : undefined}
      cardActions={<SaveStatus state={dirty ? "dirty" : "clean"} />}
      editing={editing}
      onClose={() => setSelection(null)}
      card={
        selection?.kind === "new" ? (
          <PriceListEditor key="new" list={null} onDirtyChange={setDirty} onSelect={(externalId) => setSelection({ kind: "edit", externalId })} />
        ) : selectedId && selected === undefined ? (
          <OfficeStatePage state={{ kind: "loading" }} />
        ) : selected ? (
          <PriceListEditor key={`${selected.externalId}:${selected.updatedAt}`} list={selected} onDirtyChange={setDirty} onSelect={(externalId) => setSelection({ kind: "edit", externalId })} />
        ) : null
      }
    />
  )
}

function PriceListEditor({ list, onDirtyChange, onSelect }: { list: PriceList | null; onDirtyChange: (dirty: boolean) => void; onSelect: (externalId: string) => void }) {
  const canEdit = useCan("office.price-lists.edit")
  const canPost = useCan("office.price-lists.post")
  const suppliers = useSupplierOptions(useCan("office.suppliers.view"))
  const canUnits = useCan("office.units.view")
  const units = useUnitOptions(canUnits && canEdit)
  const { savePriceList, publishPriceList } = usePriceListMutations()
  const toast = useToast()
  const [baseline, setBaseline] = useState<PriceListDraft>(() => (list ? draftFromPriceList(list) : emptyPriceListDraft(Date.now())))
  const [draft, setDraft] = useState(baseline)
  const [errors, setErrors] = useState<PriceListErrors>({ rows: {} })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<"save" | "publish" | null>(null)
  const set = (patch: Partial<PriceListDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const dirty = canEdit && priceListSignature(draft) !== priceListSignature(baseline)
  const readOnly = !canEdit
  const status = list?.status ?? "draft"
  const published = status !== "draft"

  // The workspace shows the indicator in the card's header.
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  const supplierOptions = (suppliers ?? []).map((supplier) => ({ value: supplier.externalId, label: supplier.name, hint: `БИН ${supplier.bin}` }))
  if (list?.supplier && !supplierOptions.some((option) => option.value === list.supplier!.externalId)) supplierOptions.push({ value: list.supplier.externalId, label: list.supplier.name, hint: "" })

  function validate() {
    const found = validatePriceList(draft)
    setErrors(found)
    return !hasPriceListErrors(found)
  }

  async function persist() {
    const result = await savePriceList(savePriceListArgs(draft, list?.externalId))
    setBaseline(draft)
    return result
  }

  async function handleSave() {
    if (readOnly || busy || !validate()) return
    setBusy("save")
    setError(null)
    try {
      const result = await persist()
      const opened = list !== null && result.externalId !== list.externalId
      toast(opened ? `Открыт черновик v${result.version} — опубликуйте его, чтобы заменить v${list!.version}` : `Прайс-лист сохранён · v${result.version}`, "success")
      if (!list || opened) onSelect(result.externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить прайс-лист"))
    } finally {
      setBusy(null)
    }
  }

  async function handlePublish() {
    if (!list || status !== "draft" || busy || !validate()) return
    if (draft.lines.length === 0) {
      setErrors((current) => ({ ...current, lines: "Добавьте хотя бы один товар" }))
      return
    }
    setBusy("publish")
    setError(null)
    try {
      if (dirty) await persist()
      await publishPriceList({ externalId: list.externalId })
      const previous = list.versions.find((row) => row.status === "published" && row.externalId !== list.externalId)
      toast(previous ? `Опубликован v${list.version}, v${previous.version} истёк` : `Опубликован v${list.version}`, "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось опубликовать прайс-лист"))
    } finally {
      setBusy(null)
    }
  }

  const nextVersion = list ? Math.max(...list.versions.map((row) => row.version), list.version) + 1 : 1
  const openDraft = list?.versions.find((row) => row.status === "draft" && row.externalId !== list.externalId)

  return (
    <div className="flex flex-col gap-5">
      {published && canEdit ? (
        <Banner tone="info" title={status === "published" ? "Опубликованная версия не меняется" : "Версия истекла"}>
          {openDraft
            ? `Изменения сохранятся в черновик v${openDraft.version}.`
            : `«Сохранить» откроет черновик v${nextVersion}; после его публикации v${list!.version} ${status === "published" ? "истечёт" : "останется в истории"}.`}
        </Banner>
      ) : null}
      {error ? (
        <Banner tone="danger" title="Не удалось выполнить действие">
          {error}
        </Banner>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        {!readOnly ? (
          <Button variant={status === "draft" && canPost && list ? "secondary" : "primary"} onClick={() => void handleSave()} disabled={busy !== null || (list !== null && !dirty)}>
            {busy === "save" ? "Сохранение…" : published ? `Сохранить как v${openDraft?.version ?? nextVersion}` : "Сохранить"}
          </Button>
        ) : null}
        {list && status === "draft" && canPost ? (
          <Button onClick={() => void handlePublish()} disabled={busy !== null}>
            {busy === "publish" ? "Публикация…" : "Опубликовать"}
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Field label="Название" error={errors.name}>
          {(control) => <Input {...control} autoComplete="off" value={draft.name} onChange={(event) => set({ name: event.target.value })} disabled={readOnly} />}
        </Field>
        <Field label="Вид" hint={list ? "Вид прайс-листа изменить нельзя" : undefined}>
          {(control) => <Select {...control} value={draft.kind} onValueChange={(value) => set({ kind: value as PriceListKind, supplierExternalId: value === "internal" ? "" : draft.supplierExternalId })} options={KIND_OPTIONS} disabled={readOnly || list !== null} />}
        </Field>
        {draft.kind === "supplier" ? (
          <Field label="Поставщик" error={errors.supplier}>
            {(control) => <Combobox {...control} value={draft.supplierExternalId || undefined} onValueChange={(supplierExternalId) => set({ supplierExternalId })} options={supplierOptions} disabled={readOnly} placeholder="Выберите" searchPlaceholder="Название или БИН" />}
          </Field>
        ) : null}
        <Field label="Начало действия" error={errors.effectiveFrom} hint="Дата по Алматы">
          {(control) => <Input {...control} type="date" value={draft.effectiveFrom} onChange={(event) => set({ effectiveFrom: event.target.value })} disabled={readOnly} />}
        </Field>
        <Field label="Контроль отклонений" hint="Проверка цены в приходной накладной">
          {(control) => <Select {...control} value={draft.deviationPolicy} onValueChange={(value) => set({ deviationPolicy: value as PriceListDraft["deviationPolicy"] })} options={POLICY_OPTIONS} disabled={readOnly} />}
        </Field>
        <Field label="Допуск, %" error={errors.deviationPercent}>
          {(control) => <Input {...control} inputMode="decimal" value={draft.deviationPercent} onChange={(event) => set({ deviationPercent: event.target.value })} disabled={readOnly} className="text-right tabular-nums" />}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-body-sm font-medium text-muted-foreground">Статус</span>
          <span className="flex min-h-11 items-center gap-2">
            <StatusPill domain="price-list" status={status} />
            {list?.publishedAt ? <span className="text-caption text-muted-foreground">с {formatAlmatyDate(list.publishedAt)}</span> : null}
          </span>
        </div>
      </div>

      <PriceListLinesTable
        lines={draft.lines}
        readOnly={readOnly}
        errors={errors.rows}
        linesError={errors.lines}
        units={canUnits && units ? units.map((unit) => ({ externalId: unit.externalId, shortName: unit.shortName })) : undefined}
        onAdd={(line) => set({ lines: [...draft.lines, line] })}
        onChange={(key, patch) => set({ lines: draft.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) })}
        onRemove={(key) => set({ lines: draft.lines.filter((line) => line.key !== key) })}
      />

      {list && list.versions.length > 1 ? (
        <section aria-label="Версии" className="flex flex-col gap-2">
          <h3 className="text-body font-semibold">Версии</h3>
          <ul className="flex flex-wrap gap-2">
            {list.versions.map((row) => (
              <li key={row.externalId}>
                <Button size="sm" variant={row.externalId === list.externalId ? "secondary" : "ghost"} aria-current={row.externalId === list.externalId ? "true" : undefined} onClick={() => onSelect(row.externalId)}>
                  v{row.version} · {formatAlmatyDate(row.effectiveFrom)}
                  <StatusPill domain="price-list" status={row.status} />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
