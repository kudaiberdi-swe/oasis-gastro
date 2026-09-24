import { ArrowLeft } from "lucide-react"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { SaveStatus, UnsavedChangesDialog } from "@/office/components/unsaved-changes"
import { fromAlmatyInput } from "@/office/features/price-orders/model/use-price-order-draft"
import { ReadOnlyField } from "@/office/features/stock-documents/ui/document-editor"
import { ReverseDialog } from "@/office/features/stock-documents/ui/reverse-dialog"
import { parseDecimal, useSupplierOptions, useWarehouseOptions } from "@/office/features/stock/data/use-stock-master"
import { useUnsavedChanges } from "@/office/hooks/use-unsaved-changes"
import { Banner, Button, Combobox, Field, Input, KpiCard, Select, StatusPill, useToast } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { formatPercent, formatTenge } from "@/shared/lib/format"

import { useReceipt, useReceiptMutations, type Receipt } from "../data/use-receipts"
import { draftFromReceipt, hasReceiptErrors, receiptTotals, validateReceipt, type ReceiptDraft, type ReceiptErrors } from "../model/receipt-draft"
import { ReceiptLinesTable } from "./receipt-lines-table"

const BACK = "/office/receipts"

/** /office/receipts/:id — «Приходная накладная ПН-…» (OFFICE-DESIGN §3.4, L-18). */
export function ReceiptEditor({ externalId }: { externalId: string }) {
  const receipt = useReceipt(externalId)
  const navigate = useNavigate()
  if (receipt === undefined) {
    return (
      <div className="px-6 py-5 xl:px-8">
        <OfficeStatePage state={{ kind: "loading" }} />
      </div>
    )
  }
  return <ReceiptForm key={`${receipt.externalId}:${receipt.status}`} receipt={receipt} onBack={() => navigate(BACK)} />
}

function ReceiptForm({ receipt, onBack }: { receipt: Receipt; onBack: () => void }) {
  const canEdit = useCan("office.receipts.edit")
  const canPost = useCan("office.receipts.post")
  const canReverse = useCan("office.receipts.reverse")
  const warehouses = useWarehouseOptions(useCan("office.stock.view"))
  const suppliers = useSupplierOptions(useCan("office.suppliers.view"))
  const { saveReceipt, postReceipt, reverseReceipt } = useReceiptMutations()
  const toast = useToast()

  const [baseline, setBaseline] = useState(() => draftFromReceipt(receipt))
  const [draft, setDraft] = useState(baseline)
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline])
  const readOnly = receipt.status !== "draft" || !canEdit
  const blocker = useUnsavedChanges(dirty && !readOnly)
  const [errors, setErrors] = useState<ReceiptErrors>({ rows: {} })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<"save" | "post" | null>(null)
  const [reversing, setReversing] = useState(false)
  const set = (patch: Partial<ReceiptDraft>) => setDraft((current) => ({ ...current, ...patch }))

  const warehouseOptions = (warehouses ?? []).filter((warehouse) => warehouse.restaurantExternalId === receipt.restaurantExternalId).map((warehouse) => ({ value: warehouse.externalId, label: warehouse.name }))
  if (receipt.warehouse && !warehouseOptions.some((option) => option.value === receipt.warehouse!.externalId)) warehouseOptions.push({ value: receipt.warehouse.externalId, label: receipt.warehouse.name })
  const supplierOptions = (suppliers ?? []).map((supplier) => ({ value: supplier.externalId, label: supplier.name, hint: `БИН ${supplier.bin}` }))
  if (receipt.supplier && !supplierOptions.some((option) => option.value === receipt.supplier!.externalId)) supplierOptions.push({ value: receipt.supplier.externalId, label: receipt.supplier.name, hint: "" })
  const supplierName = supplierOptions.find((option) => option.value === draft.supplierExternalId)?.label ?? receipt.supplier?.name ?? "—"
  const warehouseName = warehouseOptions.find((option) => option.value === draft.warehouseExternalId)?.label ?? receipt.warehouse?.name ?? "—"

  const computed = receiptTotals(draft.lines)
  const totals = receipt.status === "draft" ? computed : { gross: receipt.totalGross, vat: receipt.totalVat, net: receipt.totalNet }
  const warnings = receipt.priceChecks.filter((check) => check.outcome !== "ok")

  function validate() {
    const found = validateReceipt(draft, fromAlmatyInput)
    setErrors(found)
    return !hasReceiptErrors(found)
  }

  async function persist() {
    await saveReceipt({
      externalId: receipt.externalId,
      date: fromAlmatyInput(draft.date) ?? receipt.date,
      supplierExternalId: draft.supplierExternalId,
      warehouseExternalId: draft.warehouseExternalId,
      invoiceNumber: draft.invoiceNumber.trim(),
      lines: draft.lines.map((line) => ({ itemExternalId: line.itemExternalId, quantity: parseDecimal(line.quantity) ?? 0, unitCostGross: line.unitCostGross ?? 0, vatRate: Number(line.vatRate) || 0 })),
    })
    setBaseline(draft)
  }

  async function handleSave() {
    if (readOnly || busy || !validate()) return
    setBusy("save")
    setError(null)
    try {
      await persist()
      toast("Черновик накладной сохранён", "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить накладную"))
    } finally {
      setBusy(null)
    }
  }

  async function handlePost(close: boolean) {
    if (receipt.status !== "draft" || busy || !validate()) return
    if (draft.lines.length === 0) {
      setErrors((current) => ({ ...current, lines: "Добавьте хотя бы один товар" }))
      return
    }
    setBusy("post")
    setError(null)
    try {
      if (dirty || receipt.lines.length === 0) await persist()
      const result = await postReceipt({ externalId: receipt.externalId })
      const warned = result.warnings.length
      toast(warned ? `Накладная проведена. Отклонение цены: ${result.warnings.map((check) => `«${check.itemName}» ${formatPercent(check.deviationPercent, { explicitPlus: true })}`).join(", ")}` : "Накладная проведена", "success")
      if (close) onBack()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось провести накладную"))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5 xl:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-title font-semibold">Приходная накладная {receipt.number}</h2>
              <StatusPill domain="document" status={receipt.status} />
            </div>
            <p className="text-body-sm text-muted-foreground">
              {supplierName} · {warehouseName}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!readOnly ? <SaveStatus state={busy === "save" ? "saving" : dirty ? "dirty" : "clean"} /> : receipt.status === "posted" ? <span className="text-caption text-success">● Документ проведён</span> : null}
            <Button variant="secondary" onClick={onBack}>
              <ArrowLeft aria-hidden />К списку
            </Button>
            {!readOnly && dirty ? (
              <Button variant="secondary" onClick={() => setDraft(baseline)} disabled={busy !== null}>
                Сбросить
              </Button>
            ) : null}
            {!readOnly ? (
              <Button variant={canPost ? "secondary" : "primary"} onClick={() => void handleSave()} disabled={!dirty || busy !== null}>
                {busy === "save" ? "Сохранение…" : "Сохранить"}
              </Button>
            ) : null}
            {receipt.status === "draft" && canPost ? (
              <Button onClick={() => void handlePost(false)} disabled={busy !== null}>
                {busy === "post" ? "Проведение…" : "Провести"}
              </Button>
            ) : null}
            {receipt.status === "posted" && canReverse ? (
              <Button variant="danger" onClick={() => setReversing(true)}>
                Сторно
              </Button>
            ) : null}
          </div>
        </header>

        {receipt.status === "posted" ? (
          <Banner tone="info" title="Накладная проведена — только чтение">
            {receipt.postedAt ? `Проведена ${formatAlmatyDateTime(receipt.postedAt)}. ` : ""}Изменить её можно только сторнированием.
          </Banner>
        ) : null}
        {receipt.status === "reversed" ? (
          <Banner tone="warning" title="Накладная сторнирована">
            {receipt.reverseReason ?? "Причина не указана."}
          </Banner>
        ) : null}
        {receipt.status === "draft" && warnings.length > 0 && dirty ? (
          <Banner tone="info" title="Проверка цен устарела">
            Сохраните накладную, чтобы пересчитать отклонения цен.
          </Banner>
        ) : null}
        {error ? (
          <Banner tone="danger" title="Не удалось выполнить действие">
            {error}
          </Banner>
        ) : null}

        <div className="grid gap-4 md:grid-cols-3">
          <KpiCard label={`Сумма накладной (${draft.lines.length} позиций)`} value={formatTenge(totals.gross)} />
          <KpiCard label="В том числе НДС" value={formatTenge(totals.vat)} />
          <KpiCard label="Без НДС" value={formatTenge(totals.net)} hint={receipt.supplier?.vatPayer ? "Поставщик — плательщик НДС" : "Поставщик не платит НДС"} />
        </div>

        <section aria-label="Реквизиты" className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
          <h3 className="text-title-sm font-semibold">Реквизиты</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <ReadOnlyField label="Номер документа" value={receipt.number} />
            {readOnly ? (
              <ReadOnlyField label="Дата и время" value={formatAlmatyDateTime(receipt.date)} />
            ) : (
              <Field label="Дата и время" error={errors.date} hint="Время Алматы">
                {(control) => <Input {...control} type="datetime-local" value={draft.date} onChange={(event) => set({ date: event.target.value })} />}
              </Field>
            )}
            {readOnly ? (
              <ReadOnlyField label="Поставщик" value={supplierName} />
            ) : (
              <Field label="Поставщик" error={errors.supplier}>
                {(control) => (
                  <Combobox {...control} value={draft.supplierExternalId || undefined} onValueChange={(supplierExternalId) => set({ supplierExternalId })} options={supplierOptions} placeholder="Выберите поставщика" searchPlaceholder="Название или БИН" />
                )}
              </Field>
            )}
            {readOnly ? (
              <ReadOnlyField label="Оприходовать на склад" value={warehouseName} />
            ) : (
              <Field label="Оприходовать на склад" error={errors.warehouse}>
                {(control) => <Select {...control} value={draft.warehouseExternalId || undefined} onValueChange={(warehouseExternalId) => set({ warehouseExternalId })} options={warehouseOptions} placeholder="Выберите склад" />}
              </Field>
            )}
            {readOnly ? (
              <ReadOnlyField label="Счёт-фактура" value={draft.invoiceNumber || "—"} />
            ) : (
              <Field label="Счёт-фактура">
                {(control) => <Input {...control} value={draft.invoiceNumber} onChange={(event) => set({ invoiceNumber: event.target.value })} autoComplete="off" placeholder="INV-…" />}
              </Field>
            )}
          </div>
        </section>

        {errors.lines ? (
          <p role="alert" className="text-body-sm text-destructive">
            {errors.lines}
          </p>
        ) : null}
        <ReceiptLinesTable
          lines={draft.lines}
          readOnly={readOnly}
          errors={errors.rows}
          priceChecks={receipt.priceChecks}
          onAdd={(line) => set({ lines: [...draft.lines, line] })}
          onChange={(key, patch) => set({ lines: draft.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) })}
          onRemove={(key) => set({ lines: draft.lines.filter((line) => line.key !== key) })}
        />
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-6 py-3 shadow-panel xl:px-8">
        <p className="text-caption text-muted-foreground">Средняя стоимость пересчитывается по каждой партии и каждому складу отдельно.</p>
        {receipt.status === "draft" && canPost ? (
          <Button variant="secondary" onClick={() => void handlePost(true)} disabled={busy !== null}>
            Провести и закрыть
          </Button>
        ) : null}
      </footer>

      <ReverseDialog
        open={reversing}
        onOpenChange={setReversing}
        title={`Сторнировать накладную ${receipt.number}?`}
        onReverse={async (reason) => {
          await reverseReceipt({ externalId: receipt.externalId, reason })
          toast("Накладная сторнирована", "success")
        }}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}
