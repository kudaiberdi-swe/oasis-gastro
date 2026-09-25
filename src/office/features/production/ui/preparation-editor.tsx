import { ArrowLeft } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { SaveStatus } from "@/office/components/unsaved-changes"
import { ReadOnlyField } from "@/office/features/stock-documents/ui/document-editor"
import { Banner, Button, EmptyState, KpiCard, RadioGroup, StatusPill, TonePill, useToast } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatQuantity, formatTenge } from "@/shared/lib/format"

import { usePreparationCosts, usePreparationOptions, useSavePreparation, type PreparationRow } from "../data/use-production"
import { OUTPUT_UNITS, WRITE_OFF_METHODS, writeOffLabel, type OutputUnit, type WriteOffMethod } from "../model/production"

const PREPARATIONS_TAB = "/office/production?tab=preparations"

/** /office/production/preparations/:id — the preparation card (W2-PRD-01, Editor §3.4). */
export function PreparationEditor({ productExternalId }: { productExternalId: string }) {
  const navigate = useNavigate()
  const rows = usePreparationOptions()
  const back = () => navigate(PREPARATIONS_TAB)
  if (rows === undefined) {
    return (
      <div className="px-6 py-5 xl:px-8">
        <OfficeStatePage state={{ kind: "loading" }} />
      </div>
    )
  }
  const row = rows.find((candidate) => candidate.productExternalId === productExternalId)
  if (!row) {
    return (
      <div className="px-6 py-5 xl:px-8">
        <EmptyState
          title="Заготовка не найдена"
          description="Позиция не отмечена как заготовка или ссылка устарела."
          action={
            <Button variant="secondary" onClick={back}>
              <ArrowLeft aria-hidden />К списку
            </Button>
          }
        />
      </div>
    )
  }
  return <PreparationForm key={`${row.productExternalId}:${row.writeOffMethod}`} row={row} onBack={back} />
}

function PreparationForm({ row, onBack }: { row: PreparationRow; onBack: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const canEdit = useCan("office.production.edit")
  const canViewNomenclature = useCan("office.nomenclature.view")
  const cost = usePreparationCosts([row.productExternalId], canViewNomenclature)[row.productExternalId]
  const save = useSavePreparation()
  const [method, setMethod] = useState<WriteOffMethod>(row.writeOffMethod as WriteOffMethod)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = method !== row.writeOffMethod
  // The stock item keeps the unit it was created with; savePreparation only sets it the first time.
  const unit = (OUTPUT_UNITS.find((option) => option.value === row.unit)?.value ?? "кг") as OutputUnit

  async function submit() {
    if (busy || !dirty) return
    setBusy(true)
    setError(null)
    try {
      await save({ productExternalId: row.productExternalId, unit, writeOffMethod: method })
      toast("Заготовка сохранена", "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить заготовку"))
    } finally {
      setBusy(false)
    }
  }

  const recipe = row.recipeVersion
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5 xl:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display text-title font-semibold">{row.name}</h2>
            {recipe ? <StatusPill domain="document" status={recipe.status} /> : <TonePill tone="warning">Нет техкарты</TonePill>}
          </div>
          <p className="text-body-sm text-muted-foreground">Заготовка · {writeOffLabel(row.writeOffMethod)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? <SaveStatus state={busy ? "saving" : dirty ? "dirty" : "clean"} /> : null}
          <Button variant="secondary" onClick={onBack}>
            <ArrowLeft aria-hidden />К списку
          </Button>
          {canEdit ? (
            <Button onClick={() => void submit()} disabled={!dirty || busy}>
              {busy ? "Сохранение…" : "Сохранить"}
            </Button>
          ) : null}
        </div>
      </header>
      {error ? (
        <Banner tone="danger" title="Не удалось сохранить">
          {error}
        </Banner>
      ) : null}
      {row.writeOffMethod !== "finished-product" ? (
        <Banner tone="warning" title="Актом приготовления не выпустить">
          Заготовка списывается по составу: при продаже спишутся её ингредиенты. Чтобы выпускать её актами, выберите «Готовой продукцией» — иначе состав спишется дважды.
        </Banner>
      ) : null}

      <section aria-label="Основные свойства" className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
        <h3 className="text-title-sm font-semibold">Основные свойства</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <ReadOnlyField label="Название" value={row.name} />
          <ReadOnlyField label="Тип номенклатуры" value="Заготовка" />
          <ReadOnlyField label="Единица выпуска" value={row.unit ?? "—"} />
          <ReadOnlyField label="Складская позиция" value={row.inventoryItemExternalId ? "Создана" : "Появится при сохранении"} />
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <span className="text-body-sm font-medium text-muted-foreground">Метод списания</span>
            {canEdit ? (
              <RadioGroup aria-label="Метод списания" className="md:grid-cols-2" value={method} onValueChange={(value) => setMethod(value as WriteOffMethod)} options={WRITE_OFF_METHODS.map((option) => ({ value: option.value, label: option.label, description: option.hint }))} />
            ) : (
              <span className="text-body-sm">{writeOffLabel(row.writeOffMethod)}</span>
            )}
          </div>
        </div>
      </section>

      <section aria-label="Технологическая карта" className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-title-sm font-semibold">Технологическая карта</h3>
            <p className="text-caption text-muted-foreground">{recipe ? `Версия ${recipe.version} · выход партии ${formatQuantity(recipe.batchYield, row.unit ?? undefined)}` : "Действующей версии нет — акт приготовления не проведётся."}</p>
          </div>
          {canViewNomenclature ? (
            <Button variant="secondary" onClick={() => navigate(`/office/nomenclature/${encodeURIComponent(row.productExternalId)}`)}>
              Открыть техкарту
            </Button>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Себестоимость единицы" value={cost ? formatTenge(cost.costPerPortion) : "—"} hint={canViewNomenclature ? "По средней склада, расчёт техкарты" : "Видна с правом просмотра номенклатуры"} />
          <KpiCard label="Готовая продукция" value={recipe ? formatQuantity(recipe.batchYield, row.unit ?? undefined) : "—"} hint="Выход одной партии" />
          <KpiCard label="Остаток на складе назначения" value={formatQuantity(row.onHand, row.unit ?? undefined)} hint="Сумма по складам" />
          <KpiCard label="Стоимость выпуска" value={cost ? formatTenge(cost.costPerBatch) : "—"} hint="Одна партия по техкарте" />
        </div>
      </section>
    </div>
  )
}
