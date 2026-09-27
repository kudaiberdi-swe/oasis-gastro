import { Minus, Plus } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import {
  canDecrement,
  canIncrement,
  changeQuantity,
  groupMinimum,
  isSingleChoice,
  selectionProblems,
  unitPrice,
  type ConfigurationGroup,
  type ModifierQuantities,
} from "@/pos/features/catalog/model/modifier-selection"
import { Banner, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Money, RadioGroup, SegmentedControl } from "@/shared/components/ui"
import { formatTenge } from "@/shared/lib/format"
import { cn } from "@/shared/lib/utils"

import { useDeliveryProductConfiguration, type DeliveryChannel, type DeliveryProductConfiguration } from "../data/use-delivery"
import { dishChoice, initialQuantities, initialSize, needsDialog } from "../model/line-configuration"
import type { DishChoice } from "../model/order-draft"

const NONE = "__none__"

/** What the dialog configures: a dish to add, or a line of the form to change (with its current choice). */
export type ConfigurationTarget = {
  productExternalId: string
  name: string
  line?: { key: string; quantity: number; sizeExternalId: string | null; modifierSelections: { modifierExternalId: string; quantity: number }[] }
}

/**
 * «Размер и добавки» of a delivery line (W2-DLV-05) over productConfiguration — the POS rules and
 * validation (modifier-selection.ts), office layout. A dish with nothing to choose is added at once.
 */
export function DeliveryProductConfigurator({
  restaurantExternalId,
  channel,
  target,
  onClose,
  onDone,
}: {
  restaurantExternalId: string | undefined
  channel: DeliveryChannel
  target: ConfigurationTarget
  onClose: () => void
  onDone: (dish: DishChoice, lineKey?: string) => void
}) {
  const configuration = useDeliveryProductConfiguration(restaurantExternalId, target.productExternalId, channel)
  const simple = configuration ? !needsDialog(configuration) : false
  const done = useRef(false)

  // Nothing to choose when adding: the dish goes in at the server's price, no dialog.
  useEffect(() => {
    if (!configuration || !simple || target.line || done.current) return
    done.current = true
    if (!configuration.product.available) return
    onDone({ productExternalId: configuration.product.externalId, name: configuration.product.name, price: configuration.product.price })
    onClose()
  }, [configuration, simple, target.line, onDone, onClose])

  if (configuration === undefined) {
    return (
      <p role="status" className="text-caption text-muted-foreground">
        Загружаем размеры и добавки «{target.name}»…
      </p>
    )
  }
  if (configuration === null || (simple && !target.line)) {
    if (configuration && configuration.product.available) return null
    return (
      <p role="alert" className="text-caption text-destructive">
        {configuration === null ? `«${target.name}» не найдено в меню ресторана` : `«${target.name}» в стоп-листе ресторана`}
      </p>
    )
  }
  return <ConfigurationDialog configuration={configuration} target={target} onClose={onClose} onDone={onDone} />
}

function ConfigurationDialog({ configuration, target, onClose, onDone }: { configuration: DeliveryProductConfiguration; target: ConfigurationTarget; onClose: () => void; onDone: (dish: DishChoice, lineKey?: string) => void }) {
  const [sizeExternalId, setSizeExternalId] = useState(() => initialSize(configuration, target.line?.sizeExternalId))
  const [quantities, setQuantities] = useState<ModifierQuantities>(() => initialQuantities(configuration, target.line?.modifierSelections ?? []))
  const [quantity, setQuantity] = useState(target.line?.quantity ?? 1)
  const [showProblems, setShowProblems] = useState(false)
  const portion = unitPrice(configuration, sizeExternalId, quantities)
  const problems = selectionProblems(configuration, sizeExternalId, quantities)
  const blocked = Object.keys(problems).length > 0
  const available = configuration.product.available
  const editing = Boolean(target.line)
  const nothingToChoose = !needsDialog(configuration)

  function submit() {
    if (blocked) return setShowProblems(true)
    onDone(dishChoice(configuration, sizeExternalId, quantities, quantity), target.line?.key)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{configuration.product.name}</DialogTitle>
          <DialogDescription>{nothingToChoose ? "У блюда нет размеров и добавок — меняется только количество." : "Размер и добавки — цены ресторана из действующего каталога"}</DialogDescription>
        </DialogHeader>
        {!available ? (
          <Banner tone="warning" title="Блюдо в стоп-листе">
            Сейчас его нельзя добавить в заказ.
          </Banner>
        ) : null}
        <div className="grid max-h-[55vh] gap-5 overflow-y-auto pr-1">
          {configuration.sizes.length ? (
            <section className="grid gap-2">
              <GroupTitle title="Размер" required error={showProblems ? problems.size : undefined} />
              <SegmentedControl
                aria-label="Размер"
                value={sizeExternalId ?? ""}
                onValueChange={setSizeExternalId}
                options={configuration.sizes.map((size) => ({ value: size.externalId, disabled: !size.available, label: <span className="tabular-nums">{`${size.label} · ${formatTenge(size.price)}`}</span> }))}
              />
            </section>
          ) : null}
          {configuration.groups.map((group) => (
            <GroupSection key={group.groupExternalId} group={group} quantities={quantities} onChange={setQuantities} error={showProblems ? problems[group.groupExternalId] : undefined} />
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-muted px-4 py-3">
          <Stepper label="Количество порций" value={quantity} canDecrement={quantity > 1} canIncrement={quantity < 99} onChange={setQuantity} />
          <span className="flex flex-col items-end">
            <span className="text-caption text-muted-foreground">Предварительно, итог посчитает сервер</span>
            <Money value={Math.round(portion * quantity)} size="lg" />
          </span>
        </div>
        {showProblems && blocked ? (
          <p role="alert" className="text-body-sm font-semibold text-destructive">
            Выберите обязательные варианты
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={!available}>
            {editing ? "Применить" : "Добавить в заказ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function GroupTitle({ title, required, helper, error }: { title: string; required?: boolean; helper?: string; error?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <h3 className="text-body font-semibold">{title}</h3>
      {required ? <span className="text-body-sm font-semibold text-accent">обязательно</span> : null}
      {helper ? <span className="text-body-sm text-muted-foreground">{helper}</span> : null}
      {error ? <span className="text-body-sm font-semibold text-destructive">{error}</span> : null}
    </div>
  )
}

function GroupSection({ group, quantities, onChange, error }: { group: ConfigurationGroup; quantities: ModifierQuantities; onChange: (next: ModifierQuantities) => void; error?: string }) {
  const required = groupMinimum(group) > 0
  const helper = `от ${group.minQuantity} до ${group.maxQuantity}${group.freeQuantity ? ` · бесплатно ${group.freeQuantity}` : ""}`
  const priceOf = (price: number) => (price > 0 ? `+${formatTenge(price)}` : "без доплаты")
  if (isSingleChoice(group)) {
    const chosen = group.options.find((option) => (quantities[option.externalId] ?? option.defaultQuantity) > 0)
    const pick = (value: string) => {
      const next = { ...quantities }
      for (const option of group.options) next[option.externalId] = option.externalId === value ? 1 : 0
      onChange(next)
    }
    return (
      <section className="grid gap-2">
        <GroupTitle title={group.name} required={required} helper={helper} error={error} />
        <RadioGroup
          aria-label={group.name}
          className="sm:grid-cols-2"
          value={chosen?.externalId ?? (required ? "" : NONE)}
          onValueChange={pick}
          options={[
            ...(required ? [] : [{ value: NONE, label: "Без выбора" }]),
            ...group.options.map((option) => ({
              value: option.externalId,
              label: option.name,
              description: option.available ? priceOf(option.price) : "нет в наличии",
              disabled: !option.available && option.externalId !== chosen?.externalId && option.defaultQuantity === 0,
            })),
          ]}
        />
      </section>
    )
  }
  return (
    <section className="grid gap-2">
      <GroupTitle title={group.name} required={required} helper={helper} error={error} />
      <ul aria-label={group.name} className="grid gap-2 sm:grid-cols-2">
        {group.options.map((option) => {
          const value = quantities[option.externalId] ?? option.defaultQuantity
          return (
            <li key={option.externalId} className={cn("flex min-h-14 items-center gap-3 rounded-control border bg-card px-3 py-2", value > 0 ? "border-foreground" : "border-input", !option.available && "opacity-60")}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-sm font-semibold">{option.name}</span>
                <span className="block text-caption text-muted-foreground tabular-nums">
                  {option.available ? priceOf(option.price) : "нет в наличии"}
                  {option.freeQuantity > 0 ? ` · ${option.freeQuantity} бесплатно` : ""}
                </span>
              </span>
              <Stepper
                label={option.name}
                value={value}
                canDecrement={canDecrement(group, option, quantities)}
                canIncrement={canIncrement(group, option, quantities)}
                onChange={(next) => onChange(changeQuantity(group, option, quantities, next > value ? 1 : -1))}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Stepper({ label, value, canDecrement: down, canIncrement: up, onChange }: { label: string; value: number; canDecrement: boolean; canIncrement: boolean; onChange: (next: number) => void }) {
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-control border border-input bg-card p-0.5">
      <Button variant="ghost" size="icon-sm" aria-label={`Меньше: ${label}`} disabled={!down} onClick={() => onChange(value - 1)}>
        <Minus />
      </Button>
      <span className="w-7 text-center text-body-sm font-semibold tabular-nums" aria-label={`${label}: ${value}`}>
        {value}
      </span>
      <Button variant="ghost" size="icon-sm" aria-label={`Больше: ${label}`} disabled={!up} onClick={() => onChange(value + 1)}>
        <Plus />
      </Button>
    </span>
  )
}
