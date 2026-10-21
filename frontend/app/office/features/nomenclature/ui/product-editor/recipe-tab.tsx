import { Plus } from "lucide-react"
import type { ReactNode } from "react"

import { Banner, Button, Field, Input, Select, SkeletonRows, TonePill } from "@/shared/components/ui"
import { formatPercent, formatQuantity, formatTenge } from "@/shared/lib/format"
import type { StatusTone } from "@/shared/lib/status-dictionary"
import { cn } from "@/shared/lib/utils"

import { PREP_AREA_LABELS, WRITE_OFF_LABELS, type ProductCard } from "../../data/use-nomenclature"
import type { ProductDraft } from "../../model/use-product-draft"
import { FOOD_COST_THRESHOLDS, foodCostTone, NETWORK, RECIPE_STATUS, type RecipeDraftController } from "../../model/use-recipe-draft"
import { ProductThumb } from "./product-thumb"
import { RecipeChecks, RecipeStatusIndicator } from "./recipe-checks"
import { RecipeLinesTable } from "./recipe-lines-table"
import { RecipePanel } from "./recipe-panel"
import { RecipeVersions } from "./recipe-versions"

const TONE_TEXT: Record<StatusTone, string> = {
  neutral: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  "danger-muted": "text-destructive-muted",
  info: "text-accent",
}

export interface RecipeTabProps {
  card: ProductCard
  product: ProductDraft
  recipe: RecipeDraftController
  /** office.nomenclature.edit */
  canEdit: boolean
  /** office.nomenclature.post */
  canActivate: boolean
  activating: boolean
  onActivate: () => void
}

/** «Технологическая карта» (W1-RCP-02, `office-details/01`): KPI, lines, output and write-off, checks, versions. */
export function RecipeTab({ card, product, recipe, canEdit, canActivate, activating, onActivate }: RecipeTabProps) {
  const { computed, draft, errors, status } = recipe
  const { summary } = computed
  const readOnly = !canEdit
  const branchOptions = [...card.branchPrices.map((row) => ({ value: row.restaurantExternalId, label: row.name })), { value: NETWORK, label: "Вся сеть — базовая цена" }]
  const branchName = card.branchPrices.find((row) => row.restaurantExternalId === recipe.restaurant)?.name
  const tone = foodCostTone(computed.foodCost)
  const firstLine = draft.lines[0]

  if (!recipe.loaded) {
    return (
      <div className="rounded-card border border-border bg-card p-5" aria-busy="true">
        <SkeletonRows rows={6} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-body-sm text-muted-foreground">
          {status === "new" ? "Новая версия" : status ? `Версия ${recipe.selectedVersion ? `v${recipe.selectedVersion.version}` : ""} · ${RECIPE_STATUS[status].label.toLocaleLowerCase("ru")}${recipe.selectedVersion?.fromIiko ? " · из iiko" : ""}` : "Техкарты ещё нет"}
        </p>
        <Field label="Филиал для расчёта" className="w-full sm:w-72">
          {(control) => <Select {...control} value={recipe.restaurant} onValueChange={recipe.setRestaurant} options={branchOptions} />}
        </Field>
      </div>

      {recipe.dirty && canEdit && recipe.savesAsNewVersion && status !== "new" && status !== null ? (
        <Banner tone="info" title="Изменения сохранятся новой версией">
          Действующую версию нельзя переписать: после сохранения появится черновик следующей версии, его нужно будет активировать.
        </Banner>
      ) : null}

      {/* The dish at a glance: its photo, then price, cost, food cost with the margin chip and the portion output. */}
      <section aria-label="Итоги техкарты" className="flex flex-col gap-5 rounded-card border border-border bg-card p-5 sm:flex-row sm:items-center">
        <ProductThumb imageUrl={card.imageUrl} size={96} />
        <div className="grid flex-1 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Цена продажи" value={formatTenge(computed.price)} hint={branchName ?? "Базовая цена"} />
          <Metric
            label="Себестоимость порции"
            value={<span className="text-accent">{formatTenge(summary.costPerPortion)}</span>}
            hint={`${formatTenge(summary.costPerBatch)} на всю закладку${computed.costsPending ? " · без новых ингредиентов" : ""}`}
          />
          <Metric
            label="Фудкост"
            value={
              <>
                <span className={TONE_TEXT[tone]}>{computed.foodCost === null ? "—" : formatPercent(computed.foodCost)}</span>
                {computed.foodCost === null ? null : <TonePill tone={tone}>Маржинальность {formatPercent(100 - computed.foodCost)}</TonePill>}
              </>
            }
            hint={`Норма до ${FOOD_COST_THRESHOLDS.warningFrom} %, выше ${FOOD_COST_THRESHOLDS.dangerAbove} % — пересмотреть`}
          />
          <Metric label="Выход одной порции" value={`${formatQuantity(summary.portionOutputG)} г`} hint={`${formatQuantity(summary.outputKg)} кг из ${formatQuantity(computed.batchYield > 0 ? computed.batchYield : 1)} порц.`} />
        </div>
      </section>

      <RecipePanel
        title="Технологическая карта"
        description="Закладка, пересчёт единиц, потери и выход готового продукта"
        action={
          canEdit ? (
            <Button variant="secondary" onClick={recipe.addLine}>
              <Plus aria-hidden />
              Добавить ингредиент
            </Button>
          ) : undefined
        }
      >
        <div className="grid items-start gap-4 border-b border-border bg-muted/30 px-5 py-4 md:grid-cols-[minmax(0,14rem)_minmax(0,15rem)_1fr]">
          <Field label="Норма закладки" error={errors.batchYield}>
            {(control) => (
              <span className="relative block">
                <Input
                  {...control}
                  inputMode="decimal"
                  autoComplete="off"
                  value={draft.batchYield}
                  onChange={(event) => recipe.set({ batchYield: event.target.value })}
                  readOnly={readOnly}
                  className="pr-14 tabular-nums"
                />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-caption text-muted-foreground">порц.</span>
              </span>
            )}
          </Field>
          <Field label="Начало действия техкарты" error={errors.effectiveFrom}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={draft.effectiveFrom}
                onChange={(event) => recipe.set({ effectiveFrom: event.target.value })}
                readOnly={readOnly}
                aria-invalid={control["aria-invalid"] ?? (computed.checks.find((check) => check.code === "date")?.ok === false ? true : undefined)}
              />
            )}
          </Field>
          <div className="md:mt-[26px]">
            <RecipeStatusIndicator checks={computed.checks} />
          </div>
        </div>
        {errors.lines ? (
          <p role="alert" className="border-b border-border px-5 py-2.5 text-caption text-destructive">
            {errors.lines}
          </p>
        ) : null}
        <RecipeLinesTable
          lines={draft.lines}
          summary={summary}
          batchYield={computed.batchYield}
          errors={errors.byLine}
          readOnly={readOnly}
          options={recipe.catalog.options}
          knownCosts={recipe.knownCosts}
          onSearchChange={recipe.catalog.setSearch}
          onChange={recipe.updateLine}
          onRemove={recipe.removeLine}
        />
      </RecipePanel>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.15fr]">
        <RecipePanel title="Выпуск и списание" description="Норма закладки определяет списание на одну продажу">
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            <Result label="Суммарный выход" value={`${formatQuantity(summary.outputKg)} кг`} />
            <Result label="Выход на порцию" value={`${formatQuantity(summary.portionOutputG)} г`} />
            <Result label="Метод списания" value={WRITE_OFF_LABELS[product.writeOffMethod]} />
            <Result label="Место приготовления" value={PREP_AREA_LABELS[product.prepArea] ?? (product.prepArea || "Не указано")} />
          </div>
          {firstLine && computed.batchYield > 0 ? (
            <p className="border-t border-border px-5 py-3 text-caption text-muted-foreground">
              При продаже одной порции количества закладки делятся на {formatQuantity(computed.batchYield)}
              {firstLine.name ? `: например, ${formatQuantity(summary.lines[0].quantity / computed.batchYield)} ${firstLine.unit} «${firstLine.name}»` : ""}.
            </p>
          ) : null}
        </RecipePanel>
        <RecipeChecks computed={computed} />
      </div>

      <RecipeVersions
        versions={recipe.versions}
        selectedId={recipe.selectedVersion?._id}
        creatingNew={status === "new"}
        dirty={recipe.dirty}
        canEdit={canEdit}
        canActivate={canActivate}
        activating={activating}
        onSelect={recipe.selectVersion}
        onNew={recipe.startNewVersion}
        onActivate={onActivate}
      />
    </div>
  )
}

function Metric({ label, value, hint }: { label: string; value: ReactNode; hint: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-caption font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-title font-bold tracking-tight text-foreground tabular-nums">{value}</div>
      <p className="text-caption text-muted-foreground">{hint}</p>
    </div>
  )
}

function Result({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-card border border-border bg-muted/30 px-4 py-3")}>
      <span className="text-caption text-muted-foreground">{label}</span>
      <span className="text-body-sm font-semibold">{value}</span>
    </div>
  )
}
