import { ArrowLeft } from "lucide-react"
import { useMemo, useState, type ReactNode } from "react"
import { useNavigate } from "react-router"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { SaveStatus, UnsavedChangesDialog } from "@/office/components/unsaved-changes"
import { fromAlmatyInput, toAlmatyInput } from "@/office/features/price-orders/model/use-price-order-draft"
import { useSupplierOptions, useWarehouseOptions } from "@/office/features/stock/data/use-stock-master"
import { useUnsavedChanges } from "@/office/hooks/use-unsaved-changes"
import { Banner, Button, Combobox, EmptyState, Field, Input, Select, StatusPill, Textarea, useToast } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { formatTenge } from "@/shared/lib/format"

import { useRestaurantFilter, useStockDocument, useStockDocumentMutations, type StockDocument } from "../data/use-stock-documents"
import { linesFromSaved, saveLines, validateLines, type DocumentLineDraft, type LineErrors } from "../model/document-lines"
import type { DocumentTypeConfig } from "../model/document-types"
import { DocumentLinesTable } from "./document-lines-table"
import { ReverseDialog } from "./reverse-dialog"

/** /office/<section>/:id — a stock document on the Editor template (OFFICE-DESIGN §3.4, L-18). */
export function DocumentEditor({ config, externalId }: { config: DocumentTypeConfig; externalId: string }) {
  const document = useStockDocument(config.type, externalId)
  const navigate = useNavigate()
  const back = () => navigate(`/office/${config.section}`)

  if (document === undefined) {
    return (
      <div className="px-6 py-5 xl:px-8">
        <OfficeStatePage state={{ kind: "loading" }} />
      </div>
    )
  }
  if (document === null) {
    return (
      <div className="px-6 py-5 xl:px-8">
        <EmptyState
          title="Документ не найден"
          description="Возможно, он относится к ресторану вне вашего доступа или ссылка устарела."
          action={
            <Button variant="secondary" onClick={back}>
              <ArrowLeft aria-hidden />К списку
            </Button>
          }
        />
      </div>
    )
  }
  // Posting or reversal re-reads the document into a fresh, read-only form.
  return <DocumentForm key={`${document.externalId}:${document.status}`} config={config} document={document} onBack={back} />
}

interface DocumentDraft {
  date: string
  sourceWarehouseExternalId: string
  destinationWarehouseExternalId: string
  supplierExternalId: string
  counterpartyName: string
  reason: string
  comment: string
  lines: DocumentLineDraft[]
}

function draftOf(document: StockDocument): DocumentDraft {
  return {
    date: toAlmatyInput(document.date),
    sourceWarehouseExternalId: document.sourceWarehouseExternalId ?? "",
    destinationWarehouseExternalId: document.destinationWarehouseExternalId ?? "",
    supplierExternalId: "",
    counterpartyName: document.counterpartyName,
    reason: document.reason,
    comment: document.comment,
    lines: linesFromSaved(document.lines),
  }
}

type HeaderErrors = Partial<Record<"date" | "source" | "destination" | "supplier" | "reason" | "lines", string>>

function DocumentForm({ config, document, onBack }: { config: DocumentTypeConfig; document: StockDocument; onBack: () => void }) {
  const canEdit = useCan(`office.${config.section}.edit`)
  const canPost = useCan(`office.${config.section}.post`)
  const canReverse = useCan(`office.${config.section}.reverse`)
  const canViewSuppliers = useCan("office.suppliers.view")
  const restaurants = useRestaurantFilter()
  const warehouses = useWarehouseOptions(useCan("office.stock.view"))
  const suppliers = useSupplierOptions(config.supplier && canViewSuppliers)
  const { saveDocument, postDocument, reverseDocument } = useStockDocumentMutations()
  const toast = useToast()

  const [baseline, setBaseline] = useState(() => draftOf(document))
  const [draft, setDraft] = useState(baseline)
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline])
  const readOnly = document.status !== "draft" || !canEdit
  const blocker = useUnsavedChanges(dirty && !readOnly)
  const [errors, setErrors] = useState<HeaderErrors>({})
  const [lineErrors, setLineErrors] = useState<LineErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<"save" | "post" | null>(null)
  const [reversing, setReversing] = useState(false)
  const set = (patch: Partial<DocumentDraft>) => setDraft((current) => ({ ...current, ...patch }))

  const restaurantWarehouses = (warehouses ?? []).filter((warehouse) => warehouse.restaurantExternalId === document.restaurantExternalId)
  const warehouseOptions = restaurantWarehouses.map((warehouse) => ({ value: warehouse.externalId, label: warehouse.name }))
  for (const externalId of [draft.sourceWarehouseExternalId, draft.destinationWarehouseExternalId]) {
    if (externalId && !warehouseOptions.some((option) => option.value === externalId)) warehouseOptions.push({ value: externalId, label: externalId })
  }
  const warehouseName = (externalId: string) => warehouseOptions.find((option) => option.value === externalId)?.label ?? (externalId || "—")
  const supplierOptions = (suppliers ?? []).map((supplier) => ({ value: supplier.externalId, label: supplier.name, hint: `БИН ${supplier.bin}` }))
  const supplierId = document.supplierId
  const currentSupplier = supplierId ? suppliers?.find((supplier) => supplier._id === supplierId) : undefined
  const supplierValue = draft.supplierExternalId || currentSupplier?.externalId || ""

  function validate() {
    const found: HeaderErrors = {}
    if (fromAlmatyInput(draft.date) === null) found.date = "Укажите дату и время"
    if (!draft.sourceWarehouseExternalId) found.source = "Выберите склад"
    if (config.destination) {
      if (!draft.destinationWarehouseExternalId) found.destination = "Выберите склад назначения"
      else if (draft.destinationWarehouseExternalId === draft.sourceWarehouseExternalId) found.destination = "Склады должны различаться"
    }
    if (config.supplier && !supplierValue) found.supplier = "Выберите поставщика"
    if (config.reasonRequired && draft.reason.trim().length < 3) found.reason = "Укажите причину списания"
    const rows = validateLines(draft.lines, config)
    setErrors(found)
    setLineErrors(rows)
    return Object.keys(found).length === 0 && Object.keys(rows).length === 0
  }

  async function persist() {
    await saveDocument({
      type: config.type,
      externalId: document.externalId,
      date: fromAlmatyInput(draft.date) ?? document.date,
      ...(draft.sourceWarehouseExternalId ? { sourceWarehouseExternalId: draft.sourceWarehouseExternalId } : {}),
      ...(config.destination && draft.destinationWarehouseExternalId ? { destinationWarehouseExternalId: draft.destinationWarehouseExternalId } : {}),
      ...(config.supplier && supplierValue ? { supplierExternalId: supplierValue } : {}),
      counterpartyName: draft.counterpartyName.trim(),
      reason: draft.reason.trim(),
      comment: draft.comment.trim(),
      lines: saveLines(draft.lines, config),
    })
    setBaseline(draft)
  }

  async function handleSave() {
    if (readOnly || busy || !validate()) return
    setBusy("save")
    setError(null)
    try {
      await persist()
      toast("Черновик сохранён", "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить документ"))
    } finally {
      setBusy(null)
    }
  }

  async function handlePost() {
    if (document.status !== "draft" || busy || !validate()) return
    if (draft.lines.length === 0) {
      setErrors((current) => ({ ...current, lines: "Добавьте хотя бы одну позицию" }))
      return
    }
    setBusy("post")
    setError(null)
    try {
      if (dirty || document.lines.length === 0) await persist()
      const result = await postDocument({ type: config.type, externalId: document.externalId })
      toast(result.totalAmount !== undefined ? `Документ проведён на ${formatTenge(result.totalAmount)}` : "Документ проведён", "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось провести документ"))
    } finally {
      setBusy(null)
    }
  }

  const subtitle = [restaurants.restaurantName(document.restaurantExternalId), config.destination ? `${warehouseName(draft.sourceWarehouseExternalId)} → ${warehouseName(draft.destinationWarehouseExternalId)}` : warehouseName(draft.sourceWarehouseExternalId)]
    .filter(Boolean)
    .join(" · ")

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5 xl:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-title font-semibold">
                {config.entityLabel} {document.number}
              </h2>
              <StatusPill domain="document" status={document.status} />
            </div>
            <p className="text-body-sm text-muted-foreground">{subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!readOnly ? <SaveStatus state={busy === "save" ? "saving" : dirty ? "dirty" : "clean"} /> : null}
            <Button variant="secondary" onClick={onBack}>
              <ArrowLeft aria-hidden />К списку
            </Button>
            {!readOnly ? (
              <Button variant={canPost ? "secondary" : "primary"} onClick={() => void handleSave()} disabled={!dirty || busy !== null}>
                {busy === "save" ? "Сохранение…" : "Сохранить"}
              </Button>
            ) : null}
            {document.status === "draft" && canPost ? (
              <Button onClick={() => void handlePost()} disabled={busy !== null}>
                {busy === "post" ? "Проведение…" : "Провести"}
              </Button>
            ) : null}
            {document.status === "posted" && canReverse ? (
              <Button variant="danger" onClick={() => setReversing(true)}>
                Сторно
              </Button>
            ) : null}
          </div>
        </header>

        {document.status === "posted" ? (
          <Banner tone="info" title="Документ проведён — только чтение">
            {document.postedAt ? `Проведён ${formatAlmatyDateTime(document.postedAt)}. ` : ""}Изменить его можно только сторнированием.
          </Banner>
        ) : null}
        {document.status === "reversed" ? (
          <Banner tone="warning" title="Документ сторнирован">
            {document.reverseReason ?? "Причина не указана."}
          </Banner>
        ) : null}
        {error ? (
          <Banner tone="danger" title="Не удалось выполнить действие">
            {error}
          </Banner>
        ) : null}

        <section aria-label="Реквизиты документа" className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
          <h3 className="text-title-sm font-semibold">Реквизиты документа</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <ReadOnlyField label="Номер" value={document.number} />
            {readOnly ? (
              <ReadOnlyField label="Дата" value={formatAlmatyDateTime(document.date)} />
            ) : (
              <Field label="Дата" error={errors.date} hint="Время Алматы">
                {(control) => <Input {...control} type="datetime-local" value={draft.date} onChange={(event) => set({ date: event.target.value })} />}
              </Field>
            )}
            <ReadOnlyField label="Ресторан" value={restaurants.restaurantName(document.restaurantExternalId) ?? document.restaurantExternalId} />
            {readOnly ? (
              <ReadOnlyField label={config.sourceLabel} value={warehouseName(draft.sourceWarehouseExternalId)} />
            ) : (
              <Field label={config.sourceLabel} error={errors.source}>
                {(control) => <Select {...control} value={draft.sourceWarehouseExternalId || undefined} onValueChange={(sourceWarehouseExternalId) => set({ sourceWarehouseExternalId })} options={warehouseOptions} placeholder="Выберите склад" />}
              </Field>
            )}
            {config.destination ? (
              readOnly ? (
                <ReadOnlyField label="Склад назначения" value={warehouseName(draft.destinationWarehouseExternalId)} />
              ) : (
                <Field label="Склад назначения" error={errors.destination}>
                  {(control) => (
                    <Select {...control} value={draft.destinationWarehouseExternalId || undefined} onValueChange={(destinationWarehouseExternalId) => set({ destinationWarehouseExternalId })} options={warehouseOptions} placeholder="Выберите склад" />
                  )}
                </Field>
              )
            ) : null}
            {config.supplier ? (
              readOnly ? (
                <ReadOnlyField label="Поставщик" value={currentSupplier?.name ?? (document.counterpartyName || "—")} />
              ) : (
                <Field label="Поставщик" error={errors.supplier}>
                  {(control) => (
                    <Combobox {...control} value={supplierValue || undefined} onValueChange={(supplierExternalId) => set({ supplierExternalId })} options={supplierOptions} placeholder="Выберите поставщика" searchPlaceholder="Название или БИН" />
                  )}
                </Field>
              )
            ) : null}
            {config.counterparty ? (
              readOnly ? (
                <ReadOnlyField label="Покупатель / получатель" value={draft.counterpartyName || "—"} />
              ) : (
                <Field label="Покупатель / получатель">
                  {(control) => <Input {...control} value={draft.counterpartyName} onChange={(event) => set({ counterpartyName: event.target.value })} autoComplete="off" />}
                </Field>
              )
            ) : null}
            {readOnly ? (
              <ReadOnlyField label="Причина / основание" value={draft.reason || "—"} />
            ) : (
              <Field label="Причина / основание" error={errors.reason} hint={config.reasonRequired ? "Обязательно для акта списания" : undefined}>
                {(control) => <Input {...control} value={draft.reason} onChange={(event) => set({ reason: event.target.value })} autoComplete="off" />}
              </Field>
            )}
            {readOnly ? (
              <ReadOnlyField label="Комментарий" value={draft.comment || "—"} className="md:col-span-2" />
            ) : (
              <Field label="Комментарий" className="md:col-span-2">
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
        <DocumentLinesTable
          config={config}
          lines={draft.lines}
          readOnly={readOnly}
          postedAmount={document.status === "draft" ? null : document.totalAmount}
          errors={lineErrors}
          onAdd={(line) => set({ lines: [...draft.lines, line] })}
          onChange={(key, patch) => set({ lines: draft.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) })}
          onRemove={(key) => set({ lines: draft.lines.filter((line) => line.key !== key) })}
        />
      </div>

      {!readOnly ? (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-6 py-3 shadow-panel xl:px-8">
          <p className="text-caption text-muted-foreground">Проведённый документ изменить нельзя — только сторнировать.</p>
          <Button variant="secondary" onClick={() => setDraft(baseline)} disabled={!dirty || busy !== null}>
            Отменить изменения
          </Button>
        </footer>
      ) : null}

      <ReverseDialog
        open={reversing}
        onOpenChange={setReversing}
        title={`Сторнировать ${config.entityLabel.toLocaleLowerCase("ru")} ${document.number}?`}
        onReverse={async (reason) => {
          await reverseDocument({ type: config.type, externalId: document.externalId, reason })
          toast("Документ сторнирован", "success")
        }}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}

export function ReadOnlyField({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="flex flex-col gap-1.5">
        <span className="text-body-sm font-medium text-muted-foreground">{label}</span>
        <span className="text-body-sm text-foreground">{value}</span>
      </div>
    </div>
  )
}
