import { useState } from "react"
import { Printer } from "lucide-react"

import { ruT, useT, type Translator } from "@/pos/i18n"
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Money } from "@/shared/components/ui"
import type { PaymentMethod } from "@/shared/types/pos"

/** What the «Оплачено» screen shows about the check that was just paid. */
export type PaidCheck = {
  orderNumber: number
  tableLabel?: string
  payments: Array<{ name: string; amount: number }>
  change: number
}

type CheckoutReceipt = {
  number: number
  receipt: { tableLabel?: string; payments: Array<{ type: "sale" | "refund"; method: PaymentMethod; amount: number; change?: number; paymentTypeName?: string }> }
}

const METHOD_KEY = { cash: "payment.methodCash", card: "payment.methodCard", qr: "payment.methodQr" } as const satisfies Record<PaymentMethod, string>

/** From the orders.checkout answer: the sale payments by their type name (else the method, in the interface language), the change handed back. */
export function paidCheckFrom(result: CheckoutReceipt, t: Translator = ruT): PaidCheck {
  const sales = result.receipt.payments.filter((payment) => payment.type === "sale")
  return {
    orderNumber: result.number,
    tableLabel: result.receipt.tableLabel || undefined,
    payments: sales.map((payment) => ({ name: payment.paymentTypeName || t(METHOD_KEY[payment.method]), amount: payment.amount })),
    change: sales.reduce((sum, payment) => sum + (payment.change ?? 0), 0),
  }
}

/**
 * «Оплачено» (POS-DESIGN §6.2): a calm confirmation after checkout — check number, how it was paid, the
 * change for cash — with «Печать чека» and «Новый стол». No celebration: the cashier moves on.
 */
export function PaymentComplete({
  paid,
  onOpenChange,
  onPrint,
  onNewTable,
}: {
  paid: PaidCheck | null
  onOpenChange: (open: boolean) => void
  /** Prints the check; false when the browser could not open the print form. */
  onPrint: () => boolean
  onNewTable: () => void
}) {
  const t = useT()
  const [printFailed, setPrintFailed] = useState(false)
  const [shown, setShown] = useState<PaidCheck | null>(paid)
  // Keep the last check on screen while the dialog fades out; a new check clears the print error.
  if (paid && paid !== shown) {
    setShown(paid)
    setPrintFailed(false)
  }
  const check = paid ?? shown

  return (
    <Dialog open={paid !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("paid.title")}</DialogTitle>
          <DialogDescription>{check ? [t("common.orderNumber", { number: check.orderNumber }), check.tableLabel].filter(Boolean).join(" · ") : null}</DialogDescription>
        </DialogHeader>
        {check && (
          <dl className="flex flex-col gap-2 rounded-card border border-border p-4">
            {check.payments.map((payment, index) => (
              <div key={`${payment.name}-${index}`} className="flex items-baseline justify-between gap-3">
                <dt className="text-body">{payment.name}</dt>
                <dd>
                  <Money value={payment.amount} size="md" className="text-foreground" />
                </dd>
              </div>
            ))}
            {check.change > 0 && (
              <div className="flex items-baseline justify-between gap-3 border-t border-gold/45 pt-2">
                <dt className="text-body font-semibold">{t("common.change")}</dt>
                <dd>
                  <Money value={check.change} size="lg" className="text-success" />
                </dd>
              </div>
            )}
          </dl>
        )}
        {printFailed && (
          <p role="alert" className="text-body-sm font-semibold text-destructive">
            {t("paid.printFailed")}
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="secondary" size="lg" className="flex-1" onClick={onNewTable}>
            {t("paid.newTable")}
          </Button>
          <Button size="lg" className="flex-1" onClick={() => setPrintFailed(!onPrint())}>
            <Printer /> {t("paid.print")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
