import { useState, type ComponentType } from "react"
import { ArrowLeft, Ban, MessageSquareText, MoveRight, Printer, Scissors, Send, Trash2 } from "lucide-react"

import { lineDetails, lineTotal, type OrderDraftLine } from "@/pos/features/order-taking/model/draft-lines"
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Money } from "@/shared/components/ui"
import { cn, focusRingClass } from "@/shared/lib/utils"

export type OrderAction = "comment" | "split" | "transfer" | "move-table" | "precheck" | "void" | "cancel"

/** Why an action is unavailable right now; a missing entry means it is available. */
export type ActionBlocks = Partial<Record<OrderAction, string>>

type Tile = { action: OrderAction; icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>; title: string; hint: string; danger?: boolean }

const TILES: Tile[] = [
  { action: "comment", icon: MessageSquareText, title: "Комментарий", hint: "Пожелание гостя" },
  { action: "split", icon: Scissors, title: "Разделить чек", hint: "Создать второй отложенный чек" },
  { action: "transfer", icon: Send, title: "Перенести на кассу", hint: "Требуется открытая смена и PIN менеджера" },
  { action: "move-table", icon: MoveRight, title: "Перенести на стол", hint: "Свободный стол этого ресторана" },
  { action: "precheck", icon: Printer, title: "Печать предчека", hint: "Браузерная печать" },
  { action: "void", icon: Trash2, title: "Удалить позицию", hint: "С причиной; с кухни — PIN менеджера" },
  { action: "cancel", icon: Ban, title: "Отменить заказ", hint: "С обязательной причиной", danger: true },
]

/**
 * «Действия с заказом» (W1-POS-15): two columns of tiles; an unavailable tile stays visible with the
 * reason instead of its hint. «Удалить позицию» first asks which line.
 */
export function OrderActionsDialog({
  open,
  onOpenChange,
  blocks,
  lines,
  onAction,
  onVoidLine,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  blocks: ActionBlocks
  /** Lines that can be removed (saved, not voided). */
  lines: OrderDraftLine[]
  onAction: (action: Exclude<OrderAction, "void">) => void
  onVoidLine: (clientLineId: string) => void
}) {
  const [view, setView] = useState<"actions" | "void">("actions")

  function choose(action: OrderAction) {
    if (action === "void") {
      if (lines.length === 1) {
        onOpenChange(false)
        onVoidLine(lines[0].clientLineId)
      } else setView("void")
      return
    }
    onOpenChange(false)
    onAction(action)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setView("actions")
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{view === "actions" ? "Действия с заказом" : "Какую позицию удалить?"}</DialogTitle>
          <DialogDescription>{view === "actions" ? "Все изменения сохраняются в журнале кассы." : "Удаление сохранится в журнале вместе с причиной."}</DialogDescription>
        </DialogHeader>
        {view === "actions" ? (
          <div className="grid grid-cols-2 gap-2">
            {TILES.map((tile) => (
              <ActionTile key={tile.action} tile={tile} blocked={blocks[tile.action]} onChoose={() => choose(tile.action)} />
            ))}
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-2" aria-label="Позиции заказа">
              {lines.map((line) => (
                <li key={line.clientLineId}>
                  <button
                    type="button"
                    onClick={() => {
                      setView("actions")
                      onOpenChange(false)
                      onVoidLine(line.clientLineId)
                    }}
                    className={cn("flex min-h-14 w-full items-center justify-between gap-3 rounded-card border border-border bg-card px-4 py-2 text-left hover:bg-muted", focusRingClass)}
                  >
                    <span className="min-w-0">
                      <span className="block text-body font-semibold">
                        {line.quantity} × {line.name}
                      </span>
                      {lineDetails(line) && <span className="block text-body-sm text-muted-foreground">{lineDetails(line)}</span>}
                    </span>
                    <Money value={lineTotal(line)} size="sm" />
                  </button>
                </li>
              ))}
            </ul>
            <div>
              <Button variant="secondary" size="lg" onClick={() => setView("actions")}>
                <ArrowLeft /> Назад
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ActionTile({ tile, blocked, onChoose }: { tile: Tile; blocked?: string; onChoose: () => void }) {
  const Icon = tile.icon
  return (
    <button
      type="button"
      onClick={onChoose}
      disabled={Boolean(blocked)}
      className={cn(
        "flex min-h-[88px] items-center gap-3 rounded-card border border-border bg-card p-4 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-card",
        focusRingClass,
      )}
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-control bg-muted">
        <Icon aria-hidden className={cn("size-6", tile.danger ? "text-destructive" : "text-rust")} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={cn("text-body font-semibold", tile.danger && "text-destructive")}>{tile.title}</span>
        <span className="text-body-sm text-muted-foreground">{blocked ?? tile.hint}</span>
      </span>
    </button>
  )
}
