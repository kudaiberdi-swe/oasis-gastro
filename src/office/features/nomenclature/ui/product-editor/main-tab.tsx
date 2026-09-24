import type { ReactNode } from "react"
import { Link } from "react-router"

import { Button, Combobox, Field, Input, MoneyInput, Select, Switch } from "@/shared/components/ui"

import { ITEM_TYPE_LABELS, PREP_AREA_LABELS, WRITE_OFF_LABELS, type ItemType, type ProductCard, type WriteOffMethod } from "../../data/use-nomenclature"
import type { DraftErrors, ProductDraft } from "../../model/use-product-draft"
import { AvailabilityBlock } from "./availability-block"
import { BranchPricesBlock, type BranchPricesBlockProps } from "./branch-prices-block"

const ITEM_TYPE_OPTIONS = (Object.keys(ITEM_TYPE_LABELS) as ItemType[]).map((value) => ({ value, label: ITEM_TYPE_LABELS[value] }))
const WRITE_OFF_OPTIONS = (Object.keys(WRITE_OFF_LABELS) as WriteOffMethod[]).map((value) => ({ value, label: WRITE_OFF_LABELS[value] }))
const IIKO_HINT = "Меняется в iiko"

export interface MainTabProps {
  card: ProductCard
  draft: ProductDraft
  errors: DraftErrors
  set: (patch: Partial<ProductDraft>) => void
  groupOptions: { value: string; label: string }[]
  readOnly: boolean
  prices: Omit<BranchPricesBlockProps, "basePrice">
  /** office.nomenclature.edit: the stop-list switches work. */
  canEditAvailability: boolean
  /** office.modifiers.view: the «Модификаторы» tile links to the dish designer. */
  canOpenModifiers: boolean
}

function plural(count: number, [one, few, many]: [string, string, string]) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

/** «Основные свойства»: основные параметры, цена по филиалам, публикация. */
export function MainTab({ card, draft, errors, set, groupOptions, readOnly, prices, canEditAvailability, canOpenModifiers }: MainTabProps) {
  const iiko = card.source === "iiko-server"
  const prepAreaOptions = Object.entries(PREP_AREA_LABELS).map(([value, label]) => ({ value, label }))
  if (!PREP_AREA_LABELS[draft.prepArea]) prepAreaOptions.push({ value: draft.prepArea, label: draft.prepArea })

  return (
    <div className="flex flex-col gap-6">
      <Block title="Основные параметры">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Название (рус)" error={errors.name}>
            {(control) => <Input {...control} value={draft.name} onChange={(event) => set({ name: event.target.value })} disabled={readOnly} autoComplete="off" />}
          </Field>
          <Field label="Атауы (қаз)">
            {(control) => <Input {...control} value={draft.nameKk} onChange={(event) => set({ nameKk: event.target.value })} disabled={readOnly} autoComplete="off" />}
          </Field>
          <Field label="Тип номенклатуры" hint={iiko ? IIKO_HINT : undefined}>
            {(control) => <Select {...control} value={draft.itemType} onValueChange={(value) => set({ itemType: value as ItemType })} options={ITEM_TYPE_OPTIONS} disabled={readOnly || iiko} />}
          </Field>
          <Field label="Группа" error={errors.categoryExternalId} hint={iiko ? IIKO_HINT : undefined}>
            {(control) => (
              <Combobox
                {...control}
                value={draft.categoryExternalId || undefined}
                onValueChange={(value) => set({ categoryExternalId: value })}
                options={groupOptions}
                placeholder="Выберите группу"
                searchPlaceholder="Найти группу"
                disabled={readOnly || iiko}
              />
            )}
          </Field>
          <Field label="Место приготовления">
            {(control) => <Select {...control} value={draft.prepArea} onValueChange={(value) => set({ prepArea: value })} options={prepAreaOptions} disabled={readOnly} />}
          </Field>
          <Field label="Способ списания">
            {(control) => (
              <Select {...control} value={draft.writeOffMethod} onValueChange={(value) => set({ writeOffMethod: value as WriteOffMethod })} options={WRITE_OFF_OPTIONS} disabled={readOnly} />
            )}
          </Field>
          <Field label="Артикул" hint={iiko ? IIKO_HINT : undefined}>
            {(control) => <Input {...control} value={draft.sku} onChange={(event) => set({ sku: event.target.value })} disabled={readOnly || iiko} autoComplete="off" />}
          </Field>
          <Field label="Базовая цена" error={errors.basePrice} hint="Действует в филиалах без своей цены">
            {(control) => <MoneyInput {...control} value={draft.basePrice} onValueChange={(value) => set({ basePrice: value })} disabled={readOnly} />}
          </Field>
        </div>
        <label className="flex items-center gap-3 text-body-sm font-medium text-foreground">
          <Switch checked={draft.enabled} onCheckedChange={(checked) => set({ enabled: checked })} disabled={readOnly} />
          В продаже
          <span className="font-normal text-muted-foreground">— показывается в кассе</span>
        </label>
      </Block>

      <Block>
        <BranchPricesBlock {...prices} basePrice={draft.basePrice} />
      </Block>

      <Block>
        <AvailabilityBlock productExternalId={card.externalId} restaurants={card.branchPrices} canEdit={canEditAvailability} />
      </Block>

      <Block title="Публикация">
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile label="Статус" value={draft.enabled ? "Активна" : "Скрыта"} />
          <Tile label="Источник" value={iiko ? "iiko" : "Sandyq"} />
          <Tile
            label="Модификаторы"
            value={card.modifierGroupCount > 0 ? `${card.modifierGroupCount} ${plural(card.modifierGroupCount, ["группа", "группы", "групп"])}` : "Не настроены"}
            action={
              canOpenModifiers ? (
                <Button variant="link" size="sm" asChild>
                  <Link to={`/office/modifiers?tab=rules&product=${encodeURIComponent(card.externalId)}`}>Конструктор блюда</Link>
                </Button>
              ) : undefined
            }
          />
        </div>
      </Block>
    </div>
  )
}

export function Block({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
      {title ? <h3 className="text-title-sm font-semibold">{title}</h3> : null}
      {children}
    </section>
  )
}

function Tile({ label, value, action }: { label: string; value: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-border px-4 py-3">
      <span className="text-caption text-muted-foreground">{label}</span>
      <span className="text-body-sm font-semibold text-foreground">{value}</span>
      {action ? <span className="self-start">{action}</span> : null}
    </div>
  )
}
