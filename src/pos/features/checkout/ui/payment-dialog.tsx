import { Banknote, Check, CreditCard, QrCode, Split } from "lucide-react"
import { useRef, useState, type ReactNode } from "react"

import type { PosPaymentType } from "@/pos/features/retail/data/use-retail-settings"
import { Button, Chip, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Field, Money, MoneyInput, TonePill } from "@/shared/components/ui"
import { cn, focusRingClass, formatTenge } from "@/shared/lib/utils"
import type { PaymentMethod } from "@/shared/types/pos"
import { QUICK_CASH_STEPS, roundUpTo } from "../model/order-receipt"
import { changeDue, initialSplit, payableTotal, paymentOptions, paymentProblem, toCheckoutPayments, type CheckoutPayment, type PaymentOption, type PaymentPart } from "../model/payment-parts"
import { PaymentSplitList } from "./payment-split-list"

export type { CheckoutPayment } from "../model/payment-parts"

const KIND_ICON: Record<PaymentMethod, ReactNode> = { cash: <Banknote aria-hidden />, card: <CreditCard aria-hidden />, qr: <QrCode aria-hidden /> }

/** Cash presets that say what they do: exact amount, then the rounded-up banknote totals. */
export function cashPresets(amount: number): Array<{ label: string; tendered: number }> {
  const presets = [{ label: "Без сдачи", tendered: amount }]
  for (const step of QUICK_CASH_STEPS) {
    const tendered = roundUpTo(amount, step)
    if (tendered > amount && !presets.some((preset) => preset.tendered === tendered)) presets.push({ label: formatTenge(tendered), tendered })
  }
  return presets
}

/**
 * Payment (W1-POS-17, POS-DESIGN §6.2): tiles from the published payment types (legacy cash / card / QR
 * before they are seeded), «Смешанная оплата» on N parts. The server settles and re-checks every rule.
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
  const total = payableTotal(orderTotal, loyaltyRedemption)
  const options = paymentOptions(paymentTypes)
  const [mode, setMode] = useState<"single" | "mixed">("single")
  const [selectedKey, setSelectedKey] = useState<string | undefined>(options[0]?.key)
  const [tendered, setTendered] = useState<number | null>(total)
  const [parts, setParts] = useState<PaymentPart[]>([])
  const wasOpen = useRef(open)

  // Every opening starts on the first type with the live total — it can change between openings.
  if (open && !wasOpen.current) {
    setMode("single")
    setSelectedKey(options[0]?.key)
    setTendered(total)
    setParts([])
  }
  wasOpen.current = open

  const selected = options.find((option) => option.key === selectedKey) ?? options[0]
  const activeParts: PaymentPart[] = mode === "mixed" ? parts : selected ? [{ id: "single", optionKey: selected.key, amount: total, tendered }] : []
  const problem = blockedReason || paymentProblem(activeParts, options, total)
  const change = changeDue(activeParts, options)

  function chooseOption(option: PaymentOption) {
    setMode("single")
    setSelectedKey(option.key)
    setTendered(total)
  }

  function chooseMixed() {
    setMode("mixed")
    setParts(initialSplit(options, total))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl gap-0 p-0">
        <div className="border-b border-border px-6 py-5">
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>Оплата заказа</DialogTitle>
              {orderNumber !== undefined && <TonePill>Заказ №{orderNumber}</TonePill>}
            </div>
            <DialogDescription>{itemCount !== undefined ? `${itemCount} поз. · ` : ""}выберите способ оплаты для закрытия чека</DialogDescription>
          </DialogHeader>
        </div>
        <div className="grid md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="flex flex-col gap-4 border-b border-border p-6 md:border-r md:border-b-0">
            <div>
              <p className="text-body-sm font-medium text-muted-foreground">К оплате</p>
              <Money value={total} size="xl" />
              {loyaltyRedemption > 0 && (
                <p className="text-body-sm text-muted-foreground tabular-nums">
                  Заказ {formatTenge(orderTotal)} · баллами <span className="font-semibold text-success">{formatTenge(-loyaltyRedemption)}</span>
                </p>
              )}
            </div>
            <div role="radiogroup" aria-label="Способ оплаты" className="flex flex-col gap-2">
              {options.map((option) => (
                <PaymentTile key={option.key} active={mode === "single" && selected?.key === option.key} icon={KIND_ICON[option.method]} title={option.name} hint={option.hint} onClick={() => chooseOption(option)} />
              ))}
              {options.filter((option) => option.combinable).length > 1 && (
                <PaymentTile active={mode === "mixed"} icon={<Split aria-hidden />} title="Смешанная оплата" hint="Несколько способов в одном чеке" onClick={chooseMixed} />
              )}
            </div>
          </div>
          <div className="flex flex-col gap-4 p-6">
            {mode === "mixed" ? (
              <PaymentSplitList parts={parts} options={options} total={total} onChange={setParts} />
            ) : selected ? (
              <SingleDetails option={selected} total={total} tendered={tendered} onTendered={setTendered} change={change} />
            ) : (
              <p className="text-body-sm text-muted-foreground">Типы оплаты не настроены.</p>
            )}
            {mode === "mixed" && change > 0 && (
              <div className="flex items-baseline justify-between rounded-control bg-muted px-4 py-3">
                <span className="text-body font-semibold">Сдача</span>
                <Money value={change} size="lg" className="text-success" />
              </div>
            )}
            {(error || (problem && (mode === "mixed" || blockedReason))) && (
              <p role="alert" className="text-body-sm font-semibold text-destructive">
                {error ?? problem}
              </p>
            )}
            <Button size="lg" className="mt-auto" disabled={Boolean(problem) || submitting} onClick={() => onSubmit(toCheckoutPayments(activeParts, options))}>
              {submitting ? "Оплата…" : `Подтвердить · ${formatTenge(total)}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PaymentTile({ active, icon, title, hint, onClick }: { active: boolean; icon: ReactNode; title: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
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
    </button>
  )
}

function SingleDetails({ option, total, tendered, onTendered, change }: { option: PaymentOption; total: number; tendered: number | null; onTendered: (value: number | null) => void; change: number }) {
  if (option.allowsChange) {
    const received = tendered ?? 0
    return (
      <>
        <div>
          <p className="text-body font-semibold">Получено: {option.name.toLocaleLowerCase("ru")}</p>
          <p className="text-body-sm text-muted-foreground">Выберите сумму или введите её вручную.</p>
        </div>
        <Field label="Полученная сумма" error={tendered !== null && tendered < total ? "Полученной суммы недостаточно" : undefined}>
          {(control) => <MoneyInput {...control} value={tendered} onValueChange={onTendered} className="h-[var(--control-h-pos)] text-body font-semibold" />}
        </Field>
        <div className="flex flex-wrap gap-2">
          {cashPresets(total).map((preset) => (
            <Chip key={preset.label} size="lg" active={tendered === preset.tendered} className="flex-1 justify-center tabular-nums" onClick={() => onTendered(preset.tendered)}>
              {preset.label}
            </Chip>
          ))}
        </div>
        <div className="grid gap-2 rounded-control bg-muted px-4 py-3">
          <div className="flex justify-between text-body-sm text-muted-foreground">
            <span>Получено</span>
            <span className="tabular-nums">{formatTenge(received)}</span>
          </div>
          <div className="flex items-baseline justify-between border-t border-gold/45 pt-2">
            <span className="text-body font-semibold">Сдача</span>
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
      <p className="text-body font-semibold">{qr ? `Учёт оплаты через ${option.name}` : `Учёт оплаты: ${option.name}`}</p>
      <p className="text-body-sm text-muted-foreground">
        {qr ? "Проверьте оплату во внешнем приложении и подтвердите её здесь." : "Проведите оплату на банковском терминале и подтвердите её здесь."}
      </p>
      <TonePill tone="info">Подтверждает кассир</TonePill>
    </div>
  )
}
