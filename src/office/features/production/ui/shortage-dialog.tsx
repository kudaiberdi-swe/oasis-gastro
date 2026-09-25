import { Banner, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/components/ui"
import { formatQuantity } from "@/shared/lib/format"
import { cn } from "@/shared/lib/utils"

import type { Shortage } from "../data/use-production"

/**
 * Second step of posting a production act (W2-PRD-02): the server found too little on the source warehouse.
 * «Провести с отрицательным остатком» repeats postDocument with confirmShortage: true.
 */
export function ShortageDialog({
  shortages,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  shortages: readonly Shortage[] | null
  busy: boolean
  error: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  const head = "h-10 px-3 text-caption font-semibold text-muted-foreground"
  return (
    <Dialog open={shortages !== null} onOpenChange={(open) => (!open && !busy ? onClose() : undefined)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Не хватает ингредиентов</DialogTitle>
          <DialogDescription>На складе-источнике меньше, чем требует техкарта. Можно провести акт — остаток этих позиций уйдёт в минус до следующего прихода.</DialogDescription>
        </DialogHeader>
        <div className="max-h-80 overflow-y-auto rounded-card border border-border">
          <table className="w-full border-collapse text-body-sm">
            <caption className="sr-only">Нехватка ингредиентов</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={cn(head, "text-left")}>
                  Позиция
                </th>
                <th scope="col" className={cn(head, "text-right")}>
                  Нужно
                </th>
                <th scope="col" className={cn(head, "text-right")}>
                  На складе
                </th>
              </tr>
            </thead>
            <tbody>
              {(shortages ?? []).map((row) => (
                <tr key={row.inventoryItemExternalId} className="h-11 border-b border-border last:border-b-0">
                  <td className="px-3 font-semibold">{row.name}</td>
                  <td className="px-3 text-right tabular-nums whitespace-nowrap">{formatQuantity(row.needed)}</td>
                  <td className={cn("px-3 text-right tabular-nums whitespace-nowrap", row.onHand < row.needed && "text-destructive")}>{formatQuantity(row.onHand)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {error ? (
          <Banner tone="danger" title="Не удалось провести">
            {error}
          </Banner>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button variant="danger-solid" onClick={onConfirm} disabled={busy}>
            {busy ? "Проведение…" : "Провести с отрицательным остатком"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
