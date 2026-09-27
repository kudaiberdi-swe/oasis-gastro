import { useState, type ComponentType } from "react"
import { ArrowLeft, Ban, MessageSquareText, MoveRight, Printer, Scissors, Send, Trash2 } from "lucide-react"

import { lineDetails, lineDetailsKk, lineTotal, type OrderDraftLine } from "@/pos/features/order-taking/model/draft-lines"
import { bilingualName, useT, type MessageKey } from "@/pos/i18n"
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Money } from "@/shared/components/ui"
import { cn, focusRingClass } from "@/shared/lib/utils"

export type OrderAction = "comment" | "split" | "transfer" | "move-table" | "precheck" | "void" | "cancel"

/** Why an action is unavailable right now; a missing entry means it is available. */
export type ActionBlocks = Partial<Record<OrderAction, string>>

/** `key` — the tile's title in the dictionary; its hint is `<key>Hint`. */
type Tile = { action: OrderAction; icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>; key: TileKey; danger?: boolean }

type TileKey = "actions.precheck" | "actions.comment" | "actions.moveTable" | "actions.split" | "actions.void" | "actions.transfer" | "actions.cancel"

// What a waiter does many times a shift: four primary tiles.
const PRIMARY: Tile[] = [
  { action: "precheck", icon: Printer, key: "actions.precheck" },
  { action: "comment", icon: MessageSquareText, key: "actions.comment" },
  { action: "move-table", icon: MoveRight, key: "actions.moveTable" },
  { action: "split", icon: Scissors, key: "actions.split" },
]

// Rarer, heavier actions: a quieter list under «Ещё».
const MORE: Tile[] = [
  { action: "void", icon: Trash2, key: "actions.void" },
  { action: "transfer", icon: Send, key: "actions.transfer" },
  { action: "cancel", icon: Ban, key: "actions.cancel", danger: true },
]

/**
 * «Действия с заказом» (W1-POS-15): the four frequent actions as tiles, the rest as a quieter list
 * under «Ещё». An unavailable action stays visible with the reason instead of its hint. «Удалить
 * позицию» first asks which line.
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
  const t = useT()
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
          <DialogTitle>{view === "actions" ? t("actions.title") : t("actions.voidTitle")}</DialogTitle>
          <DialogDescription>{view === "actions" ? t("actions.description") : t("actions.voidDescription")}</DialogDescription>
        </DialogHeader>
        {view === "actions" ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2">
              {PRIMARY.map((tile) => (
                <ActionTile key={tile.action} tile={tile} blocked={blocks[tile.action]} onChoose={() => choose(tile.action)} />
              ))}
            </div>
            <section aria-labelledby="order-actions-more" className="flex flex-col gap-1">
              <h3 id="order-actions-more" className="text-body-sm font-semibold text-muted-foreground">
                {t("order.more")}
              </h3>
              <ul className="flex flex-col divide-y divide-border rounded-card border border-border">
                {MORE.map((tile) => (
                  <li key={tile.action}>
                    <ActionRow tile={tile} blocked={blocks[tile.action]} onChoose={() => choose(tile.action)} />
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-2" aria-label={t("actions.lines")}>
              {lines.map((line) => {
                const title = bilingualName(t.locale, line)
                const details = t.locale === "kk" ? (lineDetailsKk(line) ?? lineDetails(line)) : lineDetails(line)
                return (
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
                        {line.quantity} × <span lang={title.primary.lang}>{title.primary.text}</span>
                      </span>
                      {title.secondary ? (
                        <span lang={title.secondary.lang} className="block text-body-sm text-muted-foreground">
                          {title.secondary.text}
                        </span>
                      ) : null}
                      {details && <span className="block text-body-sm text-muted-foreground">{details}</span>}
                    </span>
                    <Money value={lineTotal(line)} size="sm" />
                  </button>
                </li>
                )
              })}
            </ul>
            <div>
              <Button variant="secondary" size="lg" onClick={() => setView("actions")}>
                <ArrowLeft /> {t("common.back")}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** A quiet row of the «Ещё» list: 48px+, icon, title and the hint or the reason it is unavailable. */
function ActionRow({ tile, blocked, onChoose }: { tile: Tile; blocked?: string; onChoose: () => void }) {
  const t = useT()
  const Icon = tile.icon
  return (
    <button
      type="button"
      onClick={onChoose}
      disabled={Boolean(blocked)}
      className={cn(
        "flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition-colors duration-150 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent",
        focusRingClass,
      )}
    >
      <Icon aria-hidden className={cn("size-5 shrink-0", tile.danger ? "text-destructive" : "text-muted-foreground")} />
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
        <span className={cn("text-body font-semibold", tile.danger && "text-destructive")}>{t(tile.key)}</span>
        <span className="text-body-sm text-muted-foreground">{blocked ?? t(`${tile.key}Hint` as MessageKey)}</span>
      </span>
    </button>
  )
}

function ActionTile({ tile, blocked, onChoose }: { tile: Tile; blocked?: string; onChoose: () => void }) {
  const t = useT()
  const Icon = tile.icon
  return (
    <button
      type="button"
      onClick={onChoose}
      disabled={Boolean(blocked)}
      className={cn(
        "flex min-h-[88px] items-center gap-3 rounded-card border border-border bg-card p-4 text-left transition-colors duration-150 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-card",
        focusRingClass,
      )}
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-control bg-muted">
        <Icon aria-hidden className={cn("size-6", tile.danger ? "text-destructive" : "text-rust")} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={cn("text-body font-semibold", tile.danger && "text-destructive")}>{t(tile.key)}</span>
        <span className="text-body-sm text-muted-foreground">{blocked ?? t(`${tile.key}Hint` as MessageKey)}</span>
      </span>
    </button>
  )
}
