import { useState } from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { ChevronDown, Plus } from "lucide-react"

import { Button } from "@/shared/components/ui/button"
import { Money } from "@/shared/components/ui/money"
import { StatusPill } from "@/shared/components/ui/status-pill"
import { formatAlmatyTime } from "@/shared/lib/almaty-time"
import { cn, focusRingClass } from "@/shared/lib/utils"

/** One row of orders.queries.listOpenChecks. */
export type OpenCheckSummary = {
  orderId: string
  number?: number
  tableLabel?: string
  status: string
  total: number
  itemCount: number
  updatedAt?: number
}

// Active check: 2px foreground frame (1px border + 1px inset ring, so the row does not shift) and a
// --gold strip on the left — never primary (POS-DESIGN §6.2, §9).
const activeClass = "border-foreground ring-1 ring-inset ring-foreground pl-4 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-gold"

export function checkTitle(check: Pick<OpenCheckSummary, "tableLabel">) {
  return check.tableLabel?.trim() || "Без стола"
}

/**
 * «Стол 7 ▾ · Заказ №…» (W1-POS-10, POS-DESIGN §11.2 п. 1): the order panel's title opens the open
 * checks of this terminal — table, total, status, time — with «+ Новый стол» at the bottom.
 * Replaces the old open-checks column.
 */
export function ChecksSwitcher({
  tableLabel,
  orderNumber,
  checks,
  activeOrderId,
  onSelect,
  onNew,
}: {
  tableLabel: string
  orderNumber?: number
  checks: OpenCheckSummary[]
  activeOrderId: string | null
  onSelect: (orderId: string) => void
  onNew: () => void
}) {
  const [open, setOpen] = useState(false)
  const others = checks.filter((check) => check.orderId !== activeOrderId).length
  const title = tableLabel.trim() || "Новый заказ"

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        aria-label={`Открытые чеки: ${checks.length}. Текущий — ${title}${orderNumber !== undefined ? `, заказ №${orderNumber}` : ""}`}
        className={cn("-mx-1 flex min-w-0 items-baseline gap-2 rounded-control px-1 text-left hover:bg-muted", focusRingClass)}
      >
        <span className="truncate font-display text-title font-semibold">{title}</span>
        <ChevronDown aria-hidden className="size-5 shrink-0 self-center text-muted-foreground" />
        {orderNumber !== undefined && <span className="shrink-0 text-body-sm text-muted-foreground">· Заказ №{orderNumber}</span>}
        {others > 0 && <span className="shrink-0 text-body-sm text-muted-foreground tabular-nums">+{others}</span>}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          aria-label="Открытые чеки"
          className="z-50 flex max-h-[min(var(--radix-popover-content-available-height),480px)] w-[380px] flex-col gap-2 overflow-hidden rounded-panel border border-border bg-popover p-2 text-popover-foreground shadow-float"
        >
          <p className="px-2 pt-1 text-body-sm font-semibold text-muted-foreground">Открытые чеки кассы · {checks.length}</p>
          {checks.length === 0 ? (
            <p className="px-2 py-3 text-body-sm text-muted-foreground">Открытых чеков нет.</p>
          ) : (
            <ul className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
              {checks.map((check) => {
                const active = check.orderId === activeOrderId
                return (
                  <li key={check.orderId}>
                    <button
                      type="button"
                      aria-current={active ? "true" : undefined}
                      onClick={() => {
                        setOpen(false)
                        if (!active) onSelect(check.orderId)
                      }}
                      className={cn("relative flex w-full flex-col gap-1 overflow-hidden rounded-card border bg-card p-3 text-left hover:bg-muted", active ? activeClass : "border-border", focusRingClass)}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate font-display text-title-sm font-semibold">{checkTitle(check)}</span>
                        <StatusPill domain="order" status={check.status} />
                      </span>
                      <span className="flex items-center justify-between gap-2 text-body-sm text-muted-foreground">
                        <span className="truncate">
                          {check.number !== undefined ? `№${check.number} · ` : ""}
                          {check.itemCount} поз.{check.updatedAt ? ` · ${formatAlmatyTime(check.updatedAt)}` : ""}
                        </span>
                        <Money value={check.total} size="sm" />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <Button
            variant="secondary"
            className="h-[var(--control-h-pos)] w-full"
            onClick={() => {
              setOpen(false)
              onNew()
            }}
          >
            <Plus /> Новый стол
          </Button>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
