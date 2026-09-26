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
import { bilingualName, useT, type BilingualName } from "@/pos/i18n"
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
  const t = useT()
  const configuration = useProductConfiguration(sessionToken, product?.externalId ?? null)
  const title = product ? bilingualName(t.locale, product) : null
  return (
    <Dialog open={product !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
        {product ? (
          configuration === undefined ? (
            <div className="grid gap-3 p-6" aria-busy>
              <DialogHeader>
                <DialogTitle lang={title?.primary.lang}>{title?.primary.text}</DialogTitle>
                <DialogDescription>{t("modifier.loading")}</DialogDescription>
              </DialogHeader>
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : configuration === null ? (
            <div className="grid gap-3 p-6">
              <DialogHeader>
                <DialogTitle lang={title?.primary.lang}>{title?.primary.text}</DialogTitle>
                <DialogDescription>{t("modifier.notFound")}</DialogDescription>
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
  const t = useT()
  const title = bilingualName(t.locale, product)
  const [sizeExternalId, setSizeExternalId] = useState(() => defaultSize(configuration.sizes)?.externalId)
  const [quantities, setQuantities] = useState<ModifierQuantities>(() => defaultQuantities(configuration.groups))
  const [quantity, setQuantity] = useState(1)
  const [showProblems, setShowProblems] = useState(false)
  const problemRef = useRef<HTMLDivElement>(null)

  const size = configuration.sizes.find((candidate) => candidate.externalId === sizeExternalId)
  const portion = unitPrice(configuration, sizeExternalId, quantities)
  const problems = selectionProblems(configuration, sizeExternalId, quantities, t)
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
            <DialogTitle lang={title.primary.lang}>{title.primary.text}</DialogTitle>
            {/* The other language's name under the title; the dish description (Russian data) when there is one. */}
            <DialogDescription lang={product.description ? "ru" : title.secondary?.lang}>{product.description || title.secondary?.text || t("modifier.chooseHint")}</DialogDescription>
          </DialogHeader>
          <Money value={portion} size="lg" />
          {!available && <p className="text-body-sm font-semibold text-destructive">{t("modifier.unavailable")}</p>}
        </div>
      </div>

      <div className="grid max-h-[52vh] gap-6 overflow-y-auto px-6 py-5">
        {configuration.sizes.length > 0 && (
          <section className="grid gap-2">
            <SectionTitle title={t("modifier.size")} required error={showProblems ? problems.size : undefined} />
            <SegmentedControl
              aria-label={t("modifier.size")}
              size="pos"
              value={sizeExternalId ?? ""}
              onValueChange={setSizeExternalId}
              options={configuration.sizes.map((option) => ({
                value: option.externalId,
                disabled: !option.available,
                label: (
                  <span className="tabular-nums">
                    <span lang={sizeName(t.locale, option).primary.lang}>{sizeName(t.locale, option).primary.text}</span> · {formatTenge(option.price)}
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
        <Stepper label={t("modifier.portions")} value={quantity} min={1} max={99} onChange={setQuantity} />
        <Button size="lg" className="flex-1" onClick={submit} disabled={!available} aria-describedby={blocked && showProblems ? "modifier-problems" : undefined}>
          {t("modifier.add", { amount: formatTenge(Math.round(portion * quantity)) })}
        </Button>
      </div>
      {showProblems && blocked && (
        <p id="modifier-problems" role="alert" className="px-6 pb-4 text-body-sm font-semibold text-destructive">
          {t("modifier.chooseRequired")}
        </p>
      )}
    </>
  )
}

function SectionTitle({ title, required, helper, error }: { title: string; required?: boolean; helper?: string; error?: string }) {
  const t = useT()
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <h3 className="text-body font-semibold">{title}</h3>
      {required ? <span className="text-body-sm font-semibold text-accent">{t("modifier.required")}</span> : null}
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
  const t = useT()
  const single = isSingleChoice(group)
  const required = groupMinimum(group) > 0
  const helper = groupHint(group, t)
  return (
    <section className="grid gap-2" ref={anchorRef}>
      <SectionTitle title={group.name} required={required} helper={helper} error={error} />
      {single ? (
        <div role="radiogroup" aria-label={group.name} className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {group.options.map((option) => {
            const name = bilingualName(t.locale, option)
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
                <OptionName name={name} className="pr-6" />
                <span className="text-body-sm text-muted-foreground tabular-nums">{option.price > 0 ? `+${formatTenge(option.price)}` : t("modifier.noExtra")}</span>
                {chosen ? <Check aria-hidden className="absolute top-2 right-2 size-5 text-success" /> : null}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {group.options.map((option) => {
            const value = quantities[option.externalId] ?? option.defaultQuantity
            const name = bilingualName(t.locale, option)
            return (
              <div key={option.externalId} className={cn("flex min-h-16 items-center gap-3 rounded-control border bg-card px-3 py-2", value > 0 ? "border-foreground" : "border-input", !option.available && "opacity-60")}>
                <div className="min-w-0 flex-1">
                  <OptionName name={name} className="truncate" block />
                  <p className="text-body-sm text-muted-foreground tabular-nums">
                    {option.available ? (option.price > 0 ? `+${formatTenge(option.price)}` : t("modifier.noExtra")) : t("product.unavailable")}
                    {option.freeQuantity > 0 ? ` · ${t("modifier.free", { count: option.freeQuantity })}` : ""}
                  </p>
                </div>
                <Stepper
                  label={name.primary.text}
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

/** A size in the interface language: its Kazakh label (labelKk) leads in kk when there is one. */
function sizeName(locale: "ru" | "kk", size: { label: string; labelKk: string | null }) {
  return bilingualName(locale, { name: size.label, nameKk: size.labelKk })
}

/** A modifier's name in the interface language first, the other language under it (each with its lang). */
function OptionName({ name, className, block = false }: { name: BilingualName; className?: string; block?: boolean }) {
  const Tag = block ? "p" : "span"
  return (
    <>
      <Tag lang={name.primary.lang} className={cn("text-body font-semibold", className)}>
        {name.primary.text}
      </Tag>
      {name.secondary && (
        <Tag lang={name.secondary.lang} className={cn("text-body-sm text-muted-foreground", className)}>
          {name.secondary.text}
        </Tag>
      )}
    </>
  )
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
  const t = useT()
  const down = allowDown ?? value > min
  const up = allowUp ?? value < max
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-control border border-input bg-card p-0.5">
      <Button variant="ghost" size="icon" className="size-12" aria-label={t("common.less", { label })} disabled={!down} onClick={() => onChange(value - 1)}>
        <Minus />
      </Button>
      <span className="w-7 text-center text-body font-semibold tabular-nums" aria-label={`${label}: ${value}`}>
        {value}
      </span>
      <Button variant="ghost" size="icon" className="size-12" aria-label={t("common.more", { label })} disabled={!up} onClick={() => onChange(value + 1)}>
        <Plus />
      </Button>
    </div>
  )
}
