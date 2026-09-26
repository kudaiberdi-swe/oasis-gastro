import { Check, Minus, Plus } from "lucide-react"
import { useRef, useState, type RefObject } from "react"

import { useProductConfiguration } from "@/pos/features/catalog/data/use-catalog"
import {
  canDecrement,
  canIncrement,
  changeQuantity,
  chooseSingle,
  configurationLabelsKk,
  defaultQuantities,
  defaultSize,
  groupHint,
  groupMinimum,
  isSingleChoice,
  modifierLabels,
  selectionProblems,
  toModifierSelections,
  unitPrice,
  type ConfigurationGroup,
  type ModifierQuantities,
  type ProductConfiguration,
} from "@/pos/features/catalog/model/modifier-selection"
import type { CatalogItem } from "@/pos/features/order-taking/model/draft-lines"
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Money, SegmentedControl, Skeleton } from "@/shared/components/ui"
import { cn, focusRingClass, formatTenge } from "@/shared/lib/utils"

export type ConfigurableProduct = { productId: string; externalId: string; name: string; nameKk: string; price: number; description?: string; imageUrl?: string }

/**
 * Size and modifier dialog (W1-POS-12, POS-DESIGN §6.2/§11.3). The price shown is a preview by the
 * same rules as the server; the line's real price comes back from saveDraft.
 */
export function ModifierDialog({
  sessionToken,
  product,
  onOpenChange,
  onAdd,
}: {
  sessionToken: string
  /** The dish being configured; null closes the dialog. */
  product: ConfigurableProduct | null
  onOpenChange: (open: boolean) => void
  onAdd: (item: CatalogItem) => void
}) {
  const configuration = useProductConfiguration(sessionToken, product?.externalId ?? null)
  return (
    <Dialog open={product !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
        {product ? (
          configuration === undefined ? (
            <div className="grid gap-3 p-6" aria-busy>
              <DialogHeader>
                <DialogTitle>{product.name}</DialogTitle>
                <DialogDescription>Загружаем размеры и добавки…</DialogDescription>
              </DialogHeader>
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : configuration === null ? (
            <div className="grid gap-3 p-6">
              <DialogHeader>
                <DialogTitle>{product.name}</DialogTitle>
                <DialogDescription>Блюдо не найдено в меню этого ресторана.</DialogDescription>
              </DialogHeader>
            </div>
          ) : (
            <ConfigurationForm
              key={product.externalId}
              product={product}
              configuration={configuration}
              onAdd={(item) => {
                onAdd(item)
                onOpenChange(false)
              }}
            />
          )
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ConfigurationForm({ product, configuration, onAdd }: { product: ConfigurableProduct; configuration: ProductConfiguration; onAdd: (item: CatalogItem) => void }) {
  const [sizeExternalId, setSizeExternalId] = useState(() => defaultSize(configuration.sizes)?.externalId)
  const [quantities, setQuantities] = useState<ModifierQuantities>(() => defaultQuantities(configuration.groups))
  const [quantity, setQuantity] = useState(1)
  const [showProblems, setShowProblems] = useState(false)
  const problemRef = useRef<HTMLDivElement>(null)

  const size = configuration.sizes.find((candidate) => candidate.externalId === sizeExternalId)
  const portion = unitPrice(configuration, sizeExternalId, quantities)
  const problems = selectionProblems(configuration, sizeExternalId, quantities)
  const blocked = Object.keys(problems).length > 0
  const available = configuration.product.available
  const imageUrl = configuration.product.imageUrl ?? product.imageUrl

  function submit() {
    if (blocked) {
      setShowProblems(true)
      problemRef.current?.scrollIntoView?.({ block: "nearest" })
      return
    }
    onAdd({
      productId: product.productId,
      name: product.name,
      nameKk: product.nameKk,
      price: portion,
      quantity,
      sizeExternalId: size?.externalId,
      sizeLabel: size?.label,
      modifierSelections: toModifierSelections(configuration.groups, quantities),
      modifierLabels: modifierLabels(configuration.groups, quantities),
      modifierLabelsKk: configurationLabelsKk(configuration.groups, quantities),
    })
  }

  return (
    <>
      <div className={cn("grid border-b border-border pr-14", imageUrl && "grid-cols-[120px_1fr]")}>
        {imageUrl ? <img src={imageUrl} alt="" className="h-full min-h-[120px] w-[120px] bg-muted object-cover" /> : null}
        <div className="flex flex-col gap-2 p-5">
          <DialogHeader className="pr-0">
            <DialogTitle>{product.name}</DialogTitle>
            <DialogDescription>{product.description || (product.nameKk !== product.name ? product.nameKk : "Выберите размер и добавки")}</DialogDescription>
          </DialogHeader>
          <Money value={portion} size="lg" />
          {!available && <p className="text-body-sm font-semibold text-destructive">Нет в наличии</p>}
        </div>
      </div>

      <div className="grid max-h-[52vh] gap-6 overflow-y-auto px-6 py-5">
        {configuration.sizes.length > 0 && (
          <section className="grid gap-2">
            <SectionTitle title="Размер" required error={showProblems ? problems.size : undefined} />
            <SegmentedControl
              aria-label="Размер"
              size="pos"
              value={sizeExternalId ?? ""}
              onValueChange={setSizeExternalId}
              options={configuration.sizes.map((option) => ({
                value: option.externalId,
                disabled: !option.available,
                label: (
                  <span className="tabular-nums">
                    {option.label} · {formatTenge(option.price)}
                  </span>
                ),
              }))}
            />
          </section>
        )}

        {configuration.groups.map((group) => (
          <GroupSection
            key={group.groupExternalId}
            group={group}
            quantities={quantities}
            onChange={setQuantities}
            error={showProblems ? problems[group.groupExternalId] : undefined}
            anchorRef={showProblems && problems[group.groupExternalId] ? problemRef : undefined}
          />
        ))}
      </div>

      <div className="flex items-center gap-3 border-t border-border bg-muted/40 px-6 py-4">
        <Stepper label="Количество порций" value={quantity} min={1} max={99} onChange={setQuantity} />
        <Button size="lg" className="flex-1" onClick={submit} disabled={!available} aria-describedby={blocked && showProblems ? "modifier-problems" : undefined}>
          Добавить в заказ · {formatTenge(Math.round(portion * quantity))}
        </Button>
      </div>
      {showProblems && blocked && (
        <p id="modifier-problems" role="alert" className="px-6 pb-4 text-body-sm font-semibold text-destructive">
          Выберите обязательные варианты
        </p>
      )}
    </>
  )
}

function SectionTitle({ title, required, helper, error }: { title: string; required?: boolean; helper?: string; error?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <h3 className="text-body font-semibold">{title}</h3>
      {required ? <span className="text-body-sm font-semibold text-accent">обязательно</span> : null}
      {helper ? <span className="text-body-sm text-muted-foreground">{helper}</span> : null}
      {error ? <span className="text-body-sm font-semibold text-destructive">{error}</span> : null}
    </div>
  )
}

function GroupSection({
  group,
  quantities,
  onChange,
  error,
  anchorRef,
}: {
  group: ConfigurationGroup
  quantities: ModifierQuantities
  onChange: (next: ModifierQuantities) => void
  error?: string
  anchorRef?: RefObject<HTMLDivElement | null>
}) {
  const single = isSingleChoice(group)
  const required = groupMinimum(group) > 0
  const helper = groupHint(group)
  return (
    <section className="grid gap-2" ref={anchorRef}>
      <SectionTitle title={group.name} required={required} helper={helper} error={error} />
      {single ? (
        <div role="radiogroup" aria-label={group.name} className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {group.options.map((option) => {
            const chosen = (quantities[option.externalId] ?? option.defaultQuantity) > 0
            const disabled = !option.available && !chosen && option.defaultQuantity === 0
            return (
              <button
                key={option.externalId}
                type="button"
                role="radio"
                aria-checked={chosen}
                disabled={disabled}
                onClick={() => onChange(chooseSingle(group, option, quantities))}
                className={cn(
                  "relative flex min-h-16 flex-col items-start justify-center gap-0.5 rounded-control border bg-card px-3 py-2 text-left transition-colors hover:bg-muted disabled:opacity-50",
                  chosen ? "border-2 border-foreground" : "border-input",
                  focusRingClass,
                )}
              >
                <span className="pr-6 text-body font-semibold">{option.name}</span>
                {kazakh(option) && (
                  <span lang="kk" className="pr-6 text-body-sm text-muted-foreground">
                    {kazakh(option)}
                  </span>
                )}
                <span className="text-body-sm text-muted-foreground tabular-nums">{option.price > 0 ? `+${formatTenge(option.price)}` : "без доплаты"}</span>
                {chosen ? <Check aria-hidden className="absolute top-2 right-2 size-5 text-success" /> : null}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {group.options.map((option) => {
            const value = quantities[option.externalId] ?? option.defaultQuantity
            return (
              <div key={option.externalId} className={cn("flex min-h-16 items-center gap-3 rounded-control border bg-card px-3 py-2", value > 0 ? "border-foreground" : "border-input", !option.available && "opacity-60")}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-semibold">{option.name}</p>
                  {kazakh(option) && (
                    <p lang="kk" className="truncate text-body-sm text-muted-foreground">
                      {kazakh(option)}
                    </p>
                  )}
                  <p className="text-body-sm text-muted-foreground tabular-nums">
                    {option.available ? (option.price > 0 ? `+${formatTenge(option.price)}` : "без доплаты") : "нет в наличии"}
                    {option.freeQuantity > 0 ? ` · ${option.freeQuantity} бесплатно` : ""}
                  </p>
                </div>
                <Stepper
                  label={option.name}
                  value={value}
                  canDecrement={canDecrement(group, option, quantities)}
                  canIncrement={canIncrement(group, option, quantities)}
                  onChange={(next) => onChange(changeQuantity(group, option, quantities, next > value ? 1 : -1))}
                />
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

/** The option's Kazakh name when it differs from the Russian one. */
function kazakh(option: { name: string; nameKk?: string | null }) {
  const value = option.nameKk?.trim()
  return value && value !== option.name.trim() ? value : null
}

/** −/+ stepper with 48px targets (POS-DESIGN §9). */
function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  canDecrement: allowDown,
  canIncrement: allowUp,
}: {
  label: string
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  canDecrement?: boolean
  canIncrement?: boolean
}) {
  const down = allowDown ?? value > min
  const up = allowUp ?? value < max
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-control border border-input bg-card p-0.5">
      <Button variant="ghost" size="icon" className="size-12" aria-label={`Меньше: ${label}`} disabled={!down} onClick={() => onChange(value - 1)}>
        <Minus />
      </Button>
      <span className="w-7 text-center text-body font-semibold tabular-nums" aria-label={`${label}: ${value}`}>
        {value}
      </span>
      <Button variant="ghost" size="icon" className="size-12" aria-label={`Больше: ${label}`} disabled={!up} onClick={() => onChange(value + 1)}>
        <Plus />
      </Button>
    </div>
  )
}
