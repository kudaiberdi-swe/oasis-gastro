import type { ComponentType } from "react"
import { History, LockKeyhole, LogOut, ReceiptText, WalletCards } from "lucide-react"

import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/components/ui"
import { cn, focusRingClass } from "@/shared/lib/utils"

type Item = { icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>; title: string; hint: string; onChoose: () => void }

/**
 * «Главное меню кассы» (W1-POS-14): four tiles and «Завершить вход сотрудника» (danger, not a fill —
 * there is no primary action on this screen).
 */
export function MainMenuDialog({
  open,
  onOpenChange,
  onNewOrder,
  onHistory,
  onShift,
  onLock,
  onLogout,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNewOrder: () => void
  onHistory: () => void
  onShift: () => void
  onLock: () => void
  onLogout: () => void
}) {
  const items: Item[] = [
    { icon: ReceiptText, title: "Новый заказ", hint: "Создать чистый чек", onChoose: onNewOrder },
    { icon: History, title: "История заказов", hint: "Продолжение, печать и возвраты", onChoose: onHistory },
    { icon: WalletCards, title: "Текущая смена", hint: "Сверка, внесения и X/Z-отчёты", onChoose: onShift },
    { icon: LockKeyhole, title: "Заблокировать", hint: "Потребуется повторный PIN", onChoose: onLock },
  ]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Главное меню кассы</DialogTitle>
          <DialogDescription>Операции текущего терминала.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {items.map(({ icon: Icon, title, hint, onChoose }) => (
            <button
              key={title}
              type="button"
              onClick={() => {
                onOpenChange(false)
                onChoose()
              }}
              className={cn("flex min-h-[88px] flex-col items-start gap-2 rounded-card border border-border bg-card p-4 text-left transition-colors hover:bg-muted", focusRingClass)}
            >
              <Icon aria-hidden className="size-6 text-rust" />
              <span className="flex flex-col gap-0.5">
                <span className="text-body font-semibold">{title}</span>
                <span className="text-body-sm text-muted-foreground">{hint}</span>
              </span>
            </button>
          ))}
        </div>
        <Button
          variant="danger"
          size="lg"
          onClick={() => {
            onOpenChange(false)
            onLogout()
          }}
        >
          <LogOut /> Завершить вход сотрудника
        </Button>
      </DialogContent>
    </Dialog>
  )
}
