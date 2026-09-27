import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"
import { Banknote, Check, CreditCard, QrCode, Split } from "lucide-react"
import { useRef, useState, type FocusEvent, type ReactNode } from "react"

import type { PosPaymentType } from "@/pos/features/retail/data/use-retail-settings"
import { ruT, useT, type Translator } from "@/pos/i18n"
import { Button, Chip, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Field, Money, MoneyInput, TonePill } from "@/shared/components/ui"
import { useArrowSelection } from "@/shared/components/ui/use-arrow-selection"
import { cn, focusRingClass, formatTenge } from "@/shared/lib/utils"
import type { PaymentMethod } from "@/shared/types/pos"
import { QUICK_CASH_STEPS, roundUpTo } from "../model/order-receipt"
import { changeDue, initialSplit, payableTotal, paymentOptions, paymentProblem, toCheckoutPayments, type CheckoutPayment, type PaymentOption, type PaymentPart } from "../model/payment-parts"
import { PaymentSplitList } from "./payment-split-list"

export type { CheckoutPayment } from "../model/payment-parts"

/** The radio value of «Смешанная оплата» — never a payment type's externalId. */
const MIXED = "__mixed__"

const KIND_ICON: Record<PaymentMethod, ReactNode> = { cash: <Banknote aria-hidden />, card: <CreditCard aria-hidden />, qr: <QrCode aria-hidden /> }

/** Cash presets that say what they do: exact amount, then the rounded-up banknote totals. */
export function cashPresets(amount: number, t: Translator = ruT): Array<{ label: string; tendered: number }> {
  const presets = [{ label: t("payment.noChange"), tendered: amount }]
  for (const step of QUICK_CASH_STEPS) {
    const tendered = roundUpTo(amount, step)
    if (tendered > amount && !presets.some((preset) => preset.tendered === tendered)) presets.push({ label: formatTenge(tendered), tendered })
  }
  return presets
}

/**
 * Payment (W1-POS-17, POS-DESIGN §6.2): tiles from the published payment types (legacy cash / card / QR
 * before they are seeded), «Смешанная оплата» on N parts. The server settles and re-checks every rule.
 * With more than one type nothing is preselected: the cashier picks the method before «Подтвердить».
 */
export function PaymentDialog({
  open,
  onOpenChange,
  total: orderTotal,
  loyaltyRedemption = 0,
  blockedReason,
  orderNumber,
  itemCount,
  paymentTypes = [],
  submitting,
  error,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The order total before points. */
  total: number
  /** Points planned on this check (W1-POS-16): 1 point = 1 ₸; the payment parts cover total − redemption. */
  loyaltyRedemption?: number
  /** Why the check cannot be paid now (e.g. a stale redemption); blocks «Подтвердить». */
  blockedReason?: string | null
  orderNumber?: number
  itemCount?: number
  paymentTypes?: PosPaymentType[]
  submitting: boolean
  error: string | null
  onSubmit: (payments: CheckoutPayment[]) => void
}) {
  const t = useT()
  const total = payableTotal(orderTotal, loyaltyRedemption)
  const options = paymentOptions(paymentTypes, t)
  const [mode, setMode] = useState<"single" | "mixed">("single")
  const [selectedKey, setSelectedKey] = useState<string | undefined>(onlyOption(options))
  const [tendered, setTendered] = useState<number | null>(total)
  const [parts, setParts] = useState<PaymentPart[]>([])
  const wasOpen = useRef(open)

  // Every opening starts with no method picked (the only one, if there is one) and the live total.
  if (open && !wasOpen.current) {
    setMode("single")
    setSelectedKey(onlyOption(options))
    setTendered(total)
    setParts([])
  }
  wasOpen.current = open

  const selected = options.find((option) => option.key === (selectedKey ?? onlyOption(options)))
  const arrows = useArrowSelection((value) => (value === MIXED ? chooseMixed() : chooseKey(value)))
  const activeParts: PaymentPart[] = mode === "mixed" ? parts : selected ? [{ id: "single", optionKey: selected.key, amount: total, tendered }] : []
  const problem = blockedReason || paymentProblem(activeParts, options, total, t)
  const change = changeDue(activeParts, options)

  function chooseKey(key: string) {
    if (mode === "single" && key === selected?.key) return
    setMode("single")
    setSelectedKey(key)
    setTendered(total)
  }

  function chooseMixed() {
    if (mode === "mixed") return
    setMode("mixed")
    setParts(initialSplit(options, total))
  }

  const radioValue = mode === "mixed" ? MIXED : (selected?.key ?? "")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl gap-0 p-0">
        <div className="border-b border-border px-6 py-5">
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>{t("payment.title")}</DialogTitle>
              {orderNumber !== undefined && <TonePill>{t("common.orderNumber", { number: orderNumber })}</TonePill>}
            </div>
            <DialogDescription>{itemCount !== undefined ? t("payment.descriptionCount", { count: itemCount }) : t("payment.description")}</DialogDescription>
          </DialogHeader>
        </div>
        <div className="grid md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="flex flex-col gap-4 border-b border-border p-6 md:border-r md:border-b-0">
            <div>
              <p className="text-body-sm font-medium text-muted-foreground">{t("order.toPay")}</p>
              <Money value={total} size="xl" />
              {loyaltyRedemption > 0 && (
                <p className="text-body-sm text-muted-foreground tabular-nums">
                  {t("payment.orderWithPoints", { total: formatTenge(orderTotal) })} <span className="font-semibold text-success">{formatTenge(-loyaltyRedemption)}</span>
                </p>
              )}
            </div>
            {/* Radix radio group: roving tabindex; the arrows move the focus and select (useArrowSelection). */}
            <RadioGroupPrimitive.Root
              aria-label={t("payment.method")}
              orientation="vertical"
              value={radioValue}
              onValueChange={(value) => (value === MIXED ? chooseMixed() : chooseKey(value))}
              onKeyDownCapture={arrows.onKeyDownCapture}
              className="flex flex-col gap-2"
            >
              {options.map((option) => (
                <PaymentTile key={option.key} value={option.key} active={radioValue === option.key} icon={KIND_ICON[option.method]} title={option.name} hint={option.hint} onFocus={arrows.itemFocus(option.key)} />
              ))}
              {options.filter((option) => option.combinable).length > 1 && (
                <PaymentTile value={MIXED} active={mode === "mixed"} icon={<Split aria-hidden />} title={t("payment.mixed")} hint={t("payment.mixedHint")} onFocus={arrows.itemFocus(MIXED)} />
              )}
            </RadioGroupPrimitive.Root>
          </div>
          <div className="flex flex-col gap-4 p-6">
            {mode === "mixed" ? (
              <PaymentSplitList parts={parts} options={options} total={total} onChange={setParts} />
            ) : selected ? (
              <SingleDetails option={selected} total={total} tendered={tendered} onTendered={setTendered} change={change} />
            ) : options.length ? (
              <p className="text-body text-muted-foreground">{t("payment.chooseLeft")}</p>
            ) : (
              <p className="text-body-sm text-muted-foreground">{t("payment.noTypes")}</p>
            )}
            {mode === "mixed" && change > 0 && (
              <div className="flex items-baseline justify-between rounded-control bg-muted px-4 py-3">
                <span className="text-body font-semibold">{t("common.change")}</span>
                <Money value={change} size="lg" className="text-success" />
              </div>
            )}
            {(error || (problem && (mode === "mixed" || blockedReason))) && (
              <p role="alert" className="text-body-sm font-semibold text-destructive">
                {error ?? problem}
              </p>
            )}
            <Button size="lg" className="mt-auto" disabled={Boolean(problem) || submitting} onClick={() => onSubmit(toCheckoutPayments(activeParts, options))}>
              {submitting ? t("payment.paying") : t("payment.confirm", { amount: formatTenge(total) })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** The first opening has no method picked unless there is only one to pick. */
function onlyOption(options: PaymentOption[]) {
  return options.length === 1 ? options[0].key : undefined
}

function PaymentTile({ value, active, icon, title, hint, onFocus }: { value: string; active: boolean; icon: ReactNode; title: string; hint: string; onFocus: (event: FocusEvent) => void }) {
  return (
    <RadioGroupPrimitive.Item
      value={value}
      onFocus={onFocus}
      className={cn(
        "flex min-h-16 items-center gap-3 rounded-control border bg-card px-3 text-left transition-colors hover:bg-muted [&_svg]:size-6",
        active ? "border-2 border-foreground" : "border-input",
        focusRingClass,
      )}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-control bg-muted text-rust">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body font-semibold">{title}</span>
        <span className="text-body-sm text-muted-foreground">{hint}</span>
      </span>
      {active ? <Check aria-hidden className="text-success" /> : null}
    </RadioGroupPrimitive.Item>
  )
}

function SingleDetails({ option, total, tendered, onTendered, change }: { option: PaymentOption; total: number; tendered: number | null; onTendered: (value: number | null) => void; change: number }) {
  const t = useT()
  if (option.allowsChange) {
    const received = tendered ?? 0
    return (
      <>
        <div>
          <p className="text-body font-semibold">{t("payment.received", { name: option.name.toLocaleLowerCase("ru") })}</p>
          <p className="text-body-sm text-muted-foreground">{t("payment.receivedHint")}</p>
        </div>
        <Field label={t("payment.receivedAmount")} error={tendered !== null && tendered < total ? t("payment.notEnough") : undefined}>
          {(control) => <MoneyInput {...control} value={tendered} onValueChange={onTendered} className="h-[var(--control-h-pos)] text-body font-semibold" />}
        </Field>
        <div className="flex flex-wrap gap-2">
          {cashPresets(total, t).map((preset) => (
            <Chip key={preset.label} size="lg" active={tendered === preset.tendered} className="flex-1 justify-center tabular-nums" onClick={() => onTendered(preset.tendered)}>
              {preset.label}
            </Chip>
          ))}
        </div>
        <div className="grid gap-2 rounded-control bg-muted px-4 py-3">
          <div className="flex justify-between text-body-sm text-muted-foreground">
            <span>{t("payment.receivedShort")}</span>
            <span className="tabular-nums">{formatTenge(received)}</span>
          </div>
          <div className="flex items-baseline justify-between border-t border-gold/45 pt-2">
            <span className="text-body font-semibold">{t("common.change")}</span>
            <Money value={change} size="xl" className="text-success" />
          </div>
        </div>
      </>
    )
  }
  const qr = option.method === "qr"
  return (
    <div className="flex flex-col items-start gap-3">
      <span className="grid size-16 place-items-center rounded-control bg-muted text-rust [&_svg]:size-8">{qr ? <QrCode aria-hidden /> : <CreditCard aria-hidden />}</span>
      <p className="text-body font-semibold">{qr ? t("payment.qrTitle", { name: option.name }) : t("payment.cardTitle", { name: option.name })}</p>
      <p className="text-body-sm text-muted-foreground">
        {qr ? t("payment.qrHint") : t("payment.cardHint")}
      </p>
      <TonePill tone="info">{t("payment.cashierConfirms")}</TonePill>
    </div>
  )
}
