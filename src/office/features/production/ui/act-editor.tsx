import { ArrowLeft } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useNavigate, useSearchParams } from "react-router"

import { useCan, useCapabilities } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { SaveStatus, UnsavedChangesDialog } from "@/office/components/unsaved-changes"
import { useRestaurantFilter } from "@/office/features/stock-documents/data/use-stock-documents"
import { ReadOnlyField } from "@/office/features/stock-documents/ui/document-editor"
import { ReverseDialog } from "@/office/features/stock-documents/ui/reverse-dialog"
import { parseDecimal, useSupplierOptions, useWarehouseOptions } from "@/office/features/stock/data/use-stock-master"
import { useUnsavedChanges } from "@/office/hooks/use-unsaved-changes"
import { allowsCapability } from "@/office/model/capabilities"
import { Banner, Button, Combobox, ConfirmDialog, EmptyState, Field, Input, KpiCard, Select, StatusPill, Textarea, useToast } from "@/shared/components/ui"
import { formatAlmatyDate, formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { formatTenge } from "@/shared/lib/format"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import { useLineRefs, usePreparationOptions, useProductionDocument, useProductionMutations, useRecipes, useWarehouseBalances, type PreparationRow, type ProductionDocument, type Shortage } from "../data/use-production"
import { ACTION_LABELS, checkStock, documentActions, ingredientDemand, isReadOnly, productionChecks, type DocAction, type ProductionStatus, type ProductionTypeConfig } from "../model/production"
import { draftFromDocument, emptyActDraft, fromDateInput, isValid, toSaveArgs, useActDraft, validateActDraft, type ActDraft, type HeaderErrors, type LineErrors } from "../model/use-act-draft"
import { ActLinesTable } from "./act-lines-table"
import { MaterialWriteoffPreview } from "./material-writeoff-preview"
import { ProductionControlPanel } from "./production-control-panel"
import { ShortageDialog } from "./shortage-dialog"

/** /office/<section>/:id and /office/<section>/new — a production / logistics document (Editor §3.4, L-18). */
export function ActEditor({ config, externalId }: { config: ProductionTypeConfig; externalId: string }) {
  const isNew = externalId === "new"
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const restaurants = useRestaurantFilter()
  const document = useProductionDocument(isNew ? null : externalId)
  const canViewStock = useCan("office.stock.view")
  const preparations = usePreparationOptions(config.lineMode === "preparation")
  const matched = useLineRefs(isNew ? null : document, preparations, canViewStock)
  // Line matching reruns when the lines change; the open form keeps the last result instead of a spinner.
  const lastRefs = useRef(matched)
  if (matched) lastRefs.current = matched
  const refs = matched ?? lastRefs.current
  // saveDocument warnings (minimum order) outlive the form's remount after a save.
  const [warnings, setWarnings] = useState<string[]>([])
  const back = () => navigate(`/office/${config.section}`)

  if (isNew) {
    if (restaurants.loading) return <Padded><OfficeStatePage state={{ kind: "loading" }} /></Padded>
    const requested = params.get("restaurant")
    const restaurant = requested && restaurants.restaurants.some((candidate) => candidate.externalId === requested) ? requested : restaurants.restaurants.length === 1 ? restaurants.restaurants[0].externalId : ""
    return <ActForm key="new" config={config} document={null} initial={emptyActDraft(restaurant)} preparations={preparations} warnings={warnings} onWarnings={setWarnings} onBack={back} />
  }
  if (document === undefined || (document && refs === undefined)) return <Padded><OfficeStatePage state={{ kind: "loading" }} /></Padded>
  if (document === null || document.type !== config.type) {
    return (
      <Padded>
        <EmptyState
          title="Документ не найден"
          description="Возможно, он относится к ресторану вне вашего доступа или ссылка устарела."
          action={
            <Button variant="secondary" onClick={back}>
              <ArrowLeft aria-hidden />К списку
            </Button>
          }
        />
      </Padded>
    )
  }
  // A transition or posting changes the status: the form re-reads the server document (read-only after posting).
  return <ActForm key={`${document.externalId}:${document.status}`} config={config} document={document} initial={draftFromDocument(document, refs!)} preparations={preparations} warnings={warnings} onWarnings={setWarnings} onBack={back} />
}

function Padded({ children }: { children: ReactNode }) {
  return <div className="px-6 py-5 xl:px-8">{children}</div>
}

type Busy = DocAction | "shortage" | null

function ActForm({
  config,
  document,
  initial,
  preparations,
  warnings,
  onWarnings,
  onBack,
}: {
  config: ProductionTypeConfig
  document: ProductionDocument | null
  initial: ActDraft
  preparations: readonly PreparationRow[] | undefined
  warnings: string[]
  onWarnings: (warnings: string[]) => void
  onBack: () => void
}) {
  const navigate = useNavigate()
  const toast = useToast()
  const capabilities = useCapabilities()
  const can = (capability: string) => allowsCapability(capabilities, capability)
  const canEdit = can(`office.${config.section}.edit`)
  const canViewStock = can("office.stock.view")
  const canViewNomenclature = can("office.nomenclature.view")
  const restaurants = useRestaurantFilter()
  const warehouses = useWarehouseOptions(canViewStock)
  const suppliers = useSupplierOptions(config.supplier && can("office.suppliers.view"))
  const mutations = useProductionMutations()

  const { draft, dirty, set, setLines, reset, markSaved } = useActDraft(initial)
  const status: ProductionStatus = document?.status ?? "draft"
  const readOnly = isReadOnly(status, canEdit)
  const [created, setCreated] = useState<string | null>(null)
  const blocker = useUnsavedChanges(dirty && !readOnly && created === null)
  const [errors, setErrors] = useState<HeaderErrors>({})
  const [lineErrors, setLineErrors] = useState<LineErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [shortages, setShortages] = useState<Shortage[] | null>(null)
  const [shortageError, setShortageError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<"cancel" | "reverse" | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)

  // A new document gets its URL once saved, the blocker released and nothing is in flight or asked.
  useEffect(() => {
    if (created && !dirty && busy === null && shortages === null) navigate(`/office/${config.section}/${encodeURIComponent(created)}`, { replace: true })
  }, [created, dirty, busy, shortages, navigate, config.section])

  // Warehouses: the restaurant's own; an internal order may take any warehouse of the organization in scope.
  const warehouseOptions = useMemo(() => {
    const list = (warehouses ?? []).filter((warehouse) => config.crossRestaurant || warehouse.restaurantExternalId === draft.restaurantExternalId)
    const options = list.map((warehouse) => ({ value: warehouse.externalId, label: warehouse.name, hint: config.crossRestaurant ? restaurants.restaurantName(warehouse.restaurantExternalId) : undefined }))
    for (const known of [document?.sourceWarehouse, document?.destinationWarehouse]) if (known && !options.some((option) => option.value === known.externalId)) options.push({ value: known.externalId, label: known.name, hint: undefined })
    return options
  }, [warehouses, config.crossRestaurant, draft.restaurantExternalId, document, restaurants])
  const warehouseName = (externalId: string) => warehouseOptions.find((option) => option.value === externalId)?.label ?? (externalId ? externalId : null)
  const supplierOptions = (suppliers ?? []).map((supplier) => ({ value: supplier.externalId, label: supplier.name, hint: `БИН ${supplier.bin}` }))
  if (document?.supplier && !supplierOptions.some((option) => option.value === document.supplier!.externalId)) supplierOptions.push({ value: document.supplier.externalId, label: document.supplier.name, hint: "" })
  const supplierName = supplierOptions.find((option) => option.value === draft.supplierExternalId)?.label ?? document?.supplier?.name ?? "—"

  // Production: recipe demand against the source warehouse, and the control panel.
  const production = config.lineMode === "preparation"
  const productIds = production ? draft.lines.map((line) => line.ref).filter(Boolean) : []
  const recipes = useRecipes(productIds, production && canViewNomenclature)
  const balances = useWarehouseBalances(draft.sourceWarehouseExternalId, production && canViewStock)
  const demandLines = draft.lines.map((line) => ({ productExternalId: line.ref, quantity: parseDecimal(line.quantity) }))
  const stockRows = checkStock(ingredientDemand(demandLines, recipes), balances)
  const recipesLoading = productIds.some((id) => recipes[id] === undefined)
  const methods = preparations ? new Map(preparations.map((row) => [row.productExternalId, row.writeOffMethod])) : null
  const validation = validateActDraft(config, draft)
  const checks = production
    ? productionChecks({
        headerValid: isValid(validation),
        lines: draft.lines.map((line) => ({ ref: line.ref, name: line.name, quantity: parseDecimal(line.quantity) })),
        stock: canViewNomenclature && !recipesLoading ? stockRows : null,
        sourceName: warehouseName(draft.sourceWarehouseExternalId),
        destinationName: warehouseName(draft.destinationWarehouseExternalId),
        sameWarehouse: Boolean(draft.sourceWarehouseExternalId) && draft.sourceWarehouseExternalId === draft.destinationWarehouseExternalId,
        methods,
      })
    : []

  const actions = documentActions(config, status, can, { saved: document !== null, receiptExternalId: document?.receiptExternalId })

  function validate() {
    setErrors(validation.header)
    setLineErrors(validation.lines)
    return isValid(validation)
  }

  /** Saves the draft when needed; returns the document's external id. */
  async function persist(): Promise<string> {
    const existing = document?.externalId ?? created ?? undefined
    if (existing && !dirty) return existing
    const result = await mutations.saveDocument(toSaveArgs(config, draft, existing))
    onWarnings(result.warnings)
    markSaved(draft)
    if (!document) setCreated(result.externalId)
    return result.externalId
  }

  async function run(action: DocAction, work: () => Promise<void>) {
    if (busy) return
    setBusy(action)
    setError(null)
    try {
      await work()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось выполнить действие"))
    } finally {
      setBusy(null)
    }
  }

  const needsValidDraft = (action: DocAction) => status === "draft" && (action === "save" || action === "submit" || action === "post")

  function perform(action: DocAction) {
    if (needsValidDraft(action) && !validate()) return
    switch (action) {
      case "save":
        return run("save", async () => {
          await persist()
          toast("Черновик сохранён", "success")
        })
      case "submit":
        return run("submit", async () => {
          const id = await persist()
          await mutations.transitionDocument({ externalId: id, action: "submit" })
          toast("Отправлено на согласование", "success")
        })
      case "approve":
        return run("approve", async () => {
          await mutations.transitionDocument({ externalId: document!.externalId, action: "approve" })
          toast("Документ согласован", "success")
        })
      case "post":
        return run("post", async () => {
          const id = status === "draft" ? await persist() : document!.externalId
          await post(id, false)
        })
      case "cancel":
      case "reverse":
        setCancelError(null)
        setDialog(action)
        return
      case "create-receipt":
        return run("create-receipt", async () => {
          const receiptExternalId = await mutations.createReceiptFromPurchaseOrder({ externalId: document!.externalId })
          navigate(`/office/receipts/${encodeURIComponent(receiptExternalId)}`)
        })
      case "open-receipt":
        navigate(`/office/receipts/${encodeURIComponent(document!.receiptExternalId!)}`)
        return
    }
  }

  async function post(id: string, confirmShortage: boolean) {
    const result = await mutations.postDocument({ externalId: id, ...(confirmShortage ? { confirmShortage: true } : {}) })
    if (result.kind === "shortage-confirmation") {
      setShortageError(null)
      setShortages(result.shortages)
      return
    }
    setShortages(null)
    toast(`Документ проведён на ${formatTenge(result.totalAmount)}`, "success")
  }

  async function confirmShortage() {
    if (busy) return
    setBusy("shortage")
    setShortageError(null)
    try {
      await post(created ?? document!.externalId, true)
    } catch (caught) {
      setShortageError(errorMessage(caught, "Не удалось провести"))
    } finally {
      setBusy(null)
    }
  }

  const title = document ? `${config.entityLabel} ${document.number}` : `${config.entityLabel} · новый`
  const route = config.sourceLabel && config.destinationLabel ? `${warehouseName(draft.sourceWarehouseExternalId) ?? "—"} → ${warehouseName(draft.destinationWarehouseExternalId) ?? "—"}` : (warehouseName(draft.sourceWarehouseExternalId || draft.destinationWarehouseExternalId) ?? "")
  const subtitle = [config.supplier ? supplierName : null, restaurants.restaurantName(draft.restaurantExternalId), route].filter(Boolean).join(" · ")
  const total = config.lifecycle === "purchase" ? (document ? document.totalAmount : null) : document && (status === "posted" || status === "reversed") ? document.totalAmount : null
  const primaryButton = (action: DocAction) => (
    <Button key={action} onClick={() => perform(action)} disabled={busy !== null || (action === "save" && !dirty && document !== null)}>
      {busy === action ? "Выполняется…" : ACTION_LABELS[action]}
    </Button>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5 xl:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-title font-semibold">{title}</h2>
              <StatusPill domain="document" status={status} />
            </div>
            <p className="text-body-sm text-muted-foreground">{subtitle || "Заполните реквизиты"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!readOnly ? <SaveStatus state={busy === "save" ? "saving" : dirty ? "dirty" : "clean"} /> : null}
            <Button variant="secondary" onClick={onBack}>
              <ArrowLeft aria-hidden />К списку
            </Button>
            {actions.danger.map((action) => (
              <Button key={action} variant="danger" onClick={() => perform(action)} disabled={busy !== null}>
                {ACTION_LABELS[action]}
              </Button>
            ))}
            {actions.secondary.map((action) => (
              <Button key={action} variant="secondary" onClick={() => perform(action)} disabled={busy !== null || (action === "save" && !dirty && document !== null)}>
                {busy === action ? "Выполняется…" : ACTION_LABELS[action]}
              </Button>
            ))}
            {actions.primary ? primaryButton(actions.primary) : null}
          </div>
        </header>

        {status === "posted" ? (
          <Banner tone="info" title="Документ проведён — только чтение">
            {document?.postedAt ? `Проведён ${formatAlmatyDateTime(document.postedAt)}. ` : ""}Изменить его можно только сторнированием.
          </Banner>
        ) : null}
        {status === "reversed" ? (
          <Banner tone="warning" title="Документ сторнирован">
            {document?.reverseReason ?? "Причина не указана."}
          </Banner>
        ) : null}
        {status === "cancelled" ? <Banner tone="info" title="Документ отменён">Движений и проводок по нему нет.</Banner> : null}
        {status === "completed" ? <Banner tone="info" title="Заказ закрыт приходной накладной">Проведённый приход завершил заказ; сторно прихода вернёт его в «Согласовано».</Banner> : null}
        {status === "approved" && config.lifecycle === "purchase" && document?.receiptExternalId ? (
          <Banner tone="info" title="Приходная накладная создана">Заказ завершится, когда накладная будет проведена.</Banner>
        ) : null}
        {warnings.length && status === "draft" ? (
          <Banner tone="warning" title="Проверьте заказ">
            {warnings.join(" · ")}
          </Banner>
        ) : null}
        {error ? (
          <Banner tone="danger" title="Не удалось выполнить действие">
            {error}
          </Banner>
        ) : null}

        {document ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <KpiCard label={config.lifecycle === "purchase" ? "Сумма заказа" : "Стоимость"} value={total !== null ? formatTenge(total) : "—"} hint={total === null ? "Рассчитает проведение по средней склада" : config.lifecycle === "purchase" ? "По ожидаемым ценам" : "По движениям склада"} />
            <KpiCard label="Позиций" value={document.lines.length} />
            {config.expectedDate ? <KpiCard label="Ожидаемая дата" value={document.expectedDate ? formatAlmatyDate(document.expectedDate) : "—"} /> : <KpiCard label="Дата документа" value={formatAlmatyDate(document.date)} />}
          </div>
        ) : null}

        <section aria-label="Реквизиты документа" className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
          <h3 className="text-title-sm font-semibold">{config.entityLabel}</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <ReadOnlyField label="Номер документа" value={document?.number ?? "Присвоится при сохранении"} />
            {readOnly ? (
              <ReadOnlyField label="Дата и время" value={document ? formatAlmatyDateTime(document.date) : "—"} />
            ) : (
              <Field label="Дата и время" error={errors.date} hint="Время Алматы">
                {(control) => <Input {...control} type="datetime-local" value={draft.date} onChange={(event) => set({ date: event.target.value })} />}
              </Field>
            )}
            {document || restaurants.restaurants.length <= 1 ? (
              <ReadOnlyField label="Ресторан" value={restaurants.restaurantName(draft.restaurantExternalId) ?? "—"} />
            ) : (
              <Field label="Ресторан" error={errors.restaurant}>
                {(control) => (
                  <Select
                    {...control}
                    value={draft.restaurantExternalId || undefined}
                    onValueChange={(restaurantExternalId) => set({ restaurantExternalId, ...(config.crossRestaurant ? {} : { sourceWarehouseExternalId: "", destinationWarehouseExternalId: "" }) })}
                    options={restaurantSelectOptions(restaurants.restaurants)}
                    placeholder="Выберите ресторан"
                  />
                )}
              </Field>
            )}
            {config.supplier ? (
              readOnly ? (
                <ReadOnlyField label="Поставщик" value={supplierName} />
              ) : (
                <Field label="Поставщик" error={errors.supplier}>
                  {(control) => <Combobox {...control} value={draft.supplierExternalId || undefined} onValueChange={(supplierExternalId) => set({ supplierExternalId })} options={supplierOptions} placeholder="Выберите поставщика" searchPlaceholder="Название или БИН" />}
                </Field>
              )
            ) : null}
            {config.sourceLabel ? (
              <WarehouseField label={config.sourceLabel} readOnly={readOnly} value={draft.sourceWarehouseExternalId} name={warehouseName(draft.sourceWarehouseExternalId)} options={warehouseOptions} error={errors.source} onChange={(sourceWarehouseExternalId) => set({ sourceWarehouseExternalId })} />
            ) : null}
            {config.destinationLabel ? (
              <WarehouseField
                label={config.destinationLabel}
                readOnly={readOnly}
                value={draft.destinationWarehouseExternalId}
                name={warehouseName(draft.destinationWarehouseExternalId)}
                options={warehouseOptions}
                error={errors.destination}
                onChange={(destinationWarehouseExternalId) => set({ destinationWarehouseExternalId })}
              />
            ) : null}
            {config.expectedDate ? (
              readOnly ? (
                <ReadOnlyField label="Ожидаемая дата поставки" value={draft.expectedDate && fromDateInput(draft.expectedDate) !== null ? formatAlmatyDate(fromDateInput(draft.expectedDate)!) : "—"} />
              ) : (
                <Field label="Ожидаемая дата поставки" error={errors.expectedDate}>
                  {(control) => <Input {...control} type="date" value={draft.expectedDate} onChange={(event) => set({ expectedDate: event.target.value })} />}
                </Field>
              )
            ) : null}
            {config.concept ? (
              readOnly ? (
                <ReadOnlyField label="Концепция" value={draft.concept || "—"} />
              ) : (
                <Field label="Концепция">{(control) => <Input {...control} value={draft.concept} onChange={(event) => set({ concept: event.target.value })} autoComplete="off" />}</Field>
              )
            ) : null}
            {readOnly ? (
              <ReadOnlyField label="Комментарий" value={draft.comment || "—"} className="md:col-span-2" />
            ) : (
              <Field label="Комментарий" className="md:col-span-2" hint={config.lineMode === "preparation" ? undefined : "Первая строка — название записи в реестре"}>
                {(control) => <Textarea {...control} value={draft.comment} onChange={(event) => set({ comment: event.target.value })} />}
              </Field>
            )}
          </div>
        </section>

        {errors.lines ? (
          <p role="alert" className="text-body-sm text-destructive">
            {errors.lines}
          </p>
        ) : null}
        <ActLinesTable
          config={config}
          lines={draft.lines}
          readOnly={readOnly}
          errors={lineErrors}
          total={total}
          preparations={preparations}
          onAdd={(line) => setLines((lines) => [...lines, line])}
          onChange={(key, patch) => setLines((lines) => lines.map((line) => (line.key === key ? { ...line, ...patch } : line)))}
          onRemove={(key) => setLines((lines) => lines.filter((line) => line.key !== key))}
        />

        {production && status === "draft" ? (
          <div className="grid gap-5 xl:grid-cols-2">
            <MaterialWriteoffPreview rows={stockRows} state={!canViewNomenclature ? "no-access" : recipesLoading ? "loading" : productIds.length ? "ready" : "empty"} />
            <ProductionControlPanel checks={checks} />
          </div>
        ) : null}

        {document ? (
          <section aria-label="Проведение и аудит" className="flex flex-col gap-3 rounded-card border border-border bg-card p-5">
            <h3 className="text-title-sm font-semibold">Проведение и аудит</h3>
            <div className="grid gap-4 md:grid-cols-3">
              <ReadOnlyField label="Создал" value={`${document.createdBy} · ${formatAlmatyDateTime(document.createdAt)}`} />
              <ReadOnlyField label="Проведён" value={document.postedAt ? formatAlmatyDateTime(document.postedAt) : "—"} />
              <ReadOnlyField label="Сторнирован" value={document.reversedAt ? formatAlmatyDateTime(document.reversedAt) : "—"} />
            </div>
          </section>
        ) : null}
      </div>

      {!readOnly ? (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-6 py-3 shadow-panel xl:px-8">
          <p className="text-caption text-muted-foreground">Проведённый документ изменить нельзя — только сторнировать.</p>
          <Button variant="secondary" onClick={reset} disabled={!dirty || busy !== null}>
            Отменить изменения
          </Button>
        </footer>
      ) : null}

      <ShortageDialog shortages={shortages} busy={busy === "shortage"} error={shortageError} onClose={() => setShortages(null)} onConfirm={() => void confirmShortage()} />
      {document ? (
        <>
          <ReverseDialog
            open={dialog === "reverse"}
            onOpenChange={(open) => setDialog(open ? "reverse" : null)}
            title={`Сторнировать ${config.entityLabel.toLocaleLowerCase("ru")} ${document.number}?`}
            onReverse={async (reason) => {
              await mutations.reverseDocument({ externalId: document.externalId, reason })
              toast("Документ сторнирован", "success")
            }}
          />
          <ConfirmDialog
            open={dialog === "cancel"}
            onOpenChange={(open) => setDialog(open ? "cancel" : null)}
            title={`Отменить ${config.entityLabel.toLocaleLowerCase("ru")} ${document.number}?`}
            description="Отменённый документ остаётся в истории, провести его будет нельзя."
            confirmLabel="Отменить документ"
            cancelLabel="Не отменять"
            reasonLabel="Причина отмены"
            submitting={busy === "cancel"}
            error={cancelError}
            onConfirm={async (reason) => {
              if (reason.trim().length < 3) {
                setCancelError("Опишите причину — хотя бы несколько слов")
                return
              }
              setBusy("cancel")
              setCancelError(null)
              try {
                await mutations.transitionDocument({ externalId: document.externalId, action: "cancel", reason: reason.trim() })
                setDialog(null)
                toast("Документ отменён", "success")
              } catch (caught) {
                setCancelError(errorMessage(caught, "Не удалось отменить"))
              } finally {
                setBusy(null)
              }
            }}
          />
        </>
      ) : null}
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}

function WarehouseField({ label, readOnly, value, name, options, error, onChange }: { label: string; readOnly: boolean; value: string; name: string | null; options: { value: string; label: string; hint?: string }[]; error?: string; onChange: (value: string) => void }) {
  if (readOnly) return <ReadOnlyField label={label} value={name ?? "—"} />
  return (
    <Field label={label} error={error}>
      {(control) => <Combobox {...control} value={value || undefined} onValueChange={onChange} options={options} placeholder="Выберите склад" searchPlaceholder="Название склада" />}
    </Field>
  )
}
