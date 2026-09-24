import { Plus } from "lucide-react"
import { useState } from "react"

import { Button } from "@/shared/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog"
import { errorMessage } from "@/shared/lib/error-message"
import { cn, formatTenge } from "@/shared/lib/utils"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"

import { useOfficeStock, useOfficeStockMutations, useRecentMovements, type InventoryItemId, type OfficeInventoryItem, type OfficeStockRestaurant } from "../data/use-office-stock"

const UNITS = ["кг", "л", "шт", "порц."] as const

const inputClass = "h-11 rounded-[var(--radius-control)] border border-border bg-background px-3 text-sm outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus:border-primary/50"

type StockAction = { kind: "receipt" | "writeoff" | "adjust"; item: OfficeInventoryItem; restaurantExternalId: string } | null

export function StockWorkspace() {
  const { items, restaurants, loading } = useOfficeStock()
  const mutations = useOfficeStockMutations()
  const [tab, setTab] = useState<"balances" | "log">("balances")
  const [creating, setCreating] = useState(false)
  const [action, setAction] = useState<StockAction>(null)

  if (loading) return <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Загрузка…</div>

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex gap-1 rounded-[var(--radius-control)] bg-muted p-1">
          <button type="button" onClick={() => setTab("balances")} className={cn("rounded-[calc(var(--radius-control)-2px)] px-3 py-1.5 text-sm font-bold", tab === "balances" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>
            Остатки
          </button>
          <button type="button" onClick={() => setTab("log")} className={cn("rounded-[calc(var(--radius-control)-2px)] px-3 py-1.5 text-sm font-bold", tab === "log" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>
            Журнал
          </button>
        </div>
        {tab === "balances" ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" /> Добавить товар
          </Button>
        ) : null}
      </div>

      {tab === "balances" ? (
        <BalancesTable items={items} restaurants={restaurants} onAction={setAction} />
      ) : (
        <MovementsLog />
      )}

      {creating ? <CreateItemDialog onClose={() => setCreating(false)} onCreate={mutations.createInventoryItem} /> : null}

      {action ? (
        <StockActionDialog
          action={action}
          onClose={() => setAction(null)}
          onReceive={mutations.receiveStock}
          onWriteOff={mutations.writeOffStock}
          onAdjust={mutations.adjustStock}
        />
      ) : null}
    </div>
  )
}

function BalancesTable({
  items,
  restaurants,
  onAction,
}: {
  items: OfficeInventoryItem[]
  restaurants: OfficeStockRestaurant[]
  onAction: (action: StockAction) => void
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-5 py-2 text-left">Товар</th>
            {restaurants.map((restaurant) => (
              <th key={restaurant.externalId} className="px-3 py-2 text-right">{restaurant.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item._id} className="border-t border-border/60 hover:bg-muted/40">
              <td className="px-5 py-2">
                <p className="font-semibold text-foreground">{item.name}</p>
                <p className="text-xs text-muted-foreground">
                  {item.unit}
                  {item.minimumStock !== undefined ? ` · мин. ${item.minimumStock}` : ""}
                </p>
              </td>
              {restaurants.map((restaurant) => {
                const balance = item.balances.find((candidate) => candidate.restaurantExternalId === restaurant.externalId)
                const quantity = balance?.quantity ?? 0
                const low = item.minimumStock !== undefined && quantity < item.minimumStock
                return (
                  <td key={restaurant.externalId} className="px-3 py-2 text-right align-top">
                    <p className={cn("tabular-nums font-semibold", low ? "text-destructive" : "text-foreground")}>{quantity} {item.unit}</p>
                    {balance?.averageUnitCost ? <p className="text-xs text-muted-foreground">~{formatTenge(balance.averageUnitCost)}/{item.unit}</p> : null}
                    <div className="mt-1 flex justify-end gap-1">
                      <button type="button" onClick={() => onAction({ kind: "receipt", item, restaurantExternalId: restaurant.externalId })} className="rounded-[var(--radius-control)] px-1.5 py-0.5 text-xs font-bold text-primary hover:bg-primary/10">
                        Приход
                      </button>
                      <button type="button" onClick={() => onAction({ kind: "writeoff", item, restaurantExternalId: restaurant.externalId })} className="rounded-[var(--radius-control)] px-1.5 py-0.5 text-xs font-bold text-destructive hover:bg-destructive/10">
                        Списать
                      </button>
                      <button type="button" onClick={() => onAction({ kind: "adjust", item, restaurantExternalId: restaurant.externalId })} className="rounded-[var(--radius-control)] px-1.5 py-0.5 text-xs font-bold text-muted-foreground hover:bg-muted">
                        Инв.
                      </button>
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
          {!items.length && (
            <tr>
              <td colSpan={1 + restaurants.length} className="px-5 py-8 text-center text-sm text-muted-foreground">Товаров пока нет</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function MovementsLog() {
  const { movements, loading } = useRecentMovements()
  const KIND_LABEL: Record<string, string> = { receipt: "Приход", writeoff: "Списание", adjustment: "Инвентаризация" }

  if (loading) return <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Загрузка…</div>

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-5 py-2 text-left">Когда</th>
            <th className="px-3 py-2 text-left">Товар</th>
            <th className="px-3 py-2 text-left">Тип</th>
            <th className="px-3 py-2 text-right">Изменение</th>
            <th className="px-3 py-2 text-right">Остаток</th>
            <th className="px-3 py-2 text-left">Кто / причина</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((movement) => (
            <tr key={movement._id} className="border-t border-border/60">
              <td className="px-5 py-2 text-xs text-muted-foreground">{formatAlmatyDateTime(movement.occurredAt)}</td>
              <td className="px-3 py-2 font-semibold text-foreground">{movement.itemName}</td>
              <td className="px-3 py-2">{KIND_LABEL[movement.kind] ?? movement.kind}</td>
              <td className={cn("px-3 py-2 text-right tabular-nums font-semibold", movement.quantityDelta < 0 ? "text-destructive" : "text-foreground")}>
                {movement.quantityDelta > 0 ? "+" : ""}{movement.quantityDelta} {movement.itemUnit}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{movement.balanceAfter} {movement.itemUnit}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{movement.actorEmail}{movement.reason ? ` · ${movement.reason}` : ""}</td>
            </tr>
          ))}
          {!movements.length && (
            <tr>
              <td colSpan={6} className="px-5 py-8 text-center text-sm text-muted-foreground">Движений пока нет</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function CreateItemDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (args: { name: string; unit: (typeof UNITS)[number]; minimumStock?: number }) => Promise<InventoryItemId> }) {
  const [name, setName] = useState("")
  const [unit, setUnit] = useState<(typeof UNITS)[number]>("кг")
  const [minimumStock, setMinimumStock] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const minimum = minimumStock ? Number(minimumStock) : undefined
      await onCreate({ name, unit, minimumStock: minimum })
      onClose()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось добавить товар"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Новый товар на складе</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted-foreground">Название</span>
            <input value={name} onChange={(event) => setName(event.target.value)} className={inputClass} required />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted-foreground">Ед. измерения</span>
              <select value={unit} onChange={(event) => setUnit(event.target.value as (typeof UNITS)[number])} className={inputClass}>
                {UNITS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted-foreground">Мин. остаток (необязательно)</span>
              <input type="number" min={0} value={minimumStock} onChange={(event) => setMinimumStock(event.target.value)} className={inputClass} />
            </label>
          </div>
          {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting} className="mt-1">{submitting ? "Сохранение…" : "Добавить"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function StockActionDialog({
  action,
  onClose,
  onReceive,
  onWriteOff,
  onAdjust,
}: {
  action: NonNullable<StockAction>
  onClose: () => void
  onReceive: (args: { inventoryItemId: InventoryItemId; restaurantExternalId: string; quantity: number; unitCost: number }) => Promise<unknown>
  onWriteOff: (args: { inventoryItemId: InventoryItemId; restaurantExternalId: string; quantity: number; reason: string }) => Promise<unknown>
  onAdjust: (args: { inventoryItemId: InventoryItemId; restaurantExternalId: string; actualQuantity: number; reason: string }) => Promise<unknown>
}) {
  const currentBalance = action.item.balances.find((balance) => balance.restaurantExternalId === action.restaurantExternalId)
  const [quantity, setQuantity] = useState("")
  const [unitCost, setUnitCost] = useState("")
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const title = action.kind === "receipt" ? "Приход" : action.kind === "writeoff" ? "Списание" : "Инвентаризация"

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      if (action.kind === "receipt") {
        await onReceive({ inventoryItemId: action.item._id, restaurantExternalId: action.restaurantExternalId, quantity: Number(quantity), unitCost: Number(unitCost) })
      } else if (action.kind === "writeoff") {
        await onWriteOff({ inventoryItemId: action.item._id, restaurantExternalId: action.restaurantExternalId, quantity: Number(quantity), reason })
      } else {
        await onAdjust({ inventoryItemId: action.item._id, restaurantExternalId: action.restaurantExternalId, actualQuantity: Number(quantity), reason })
      }
      onClose()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}: {action.item.name}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Текущий остаток: {currentBalance?.quantity ?? 0} {action.item.unit}</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted-foreground">{action.kind === "adjust" ? `Фактический остаток, ${action.item.unit}` : `Количество, ${action.item.unit}`}</span>
            <input type="number" min={0} step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} className={inputClass} required />
          </label>
          {action.kind === "receipt" ? (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted-foreground">Цена за {action.item.unit}, ₸</span>
              <input type="number" min={0} step="any" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} className={inputClass} required />
            </label>
          ) : (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted-foreground">Причина</span>
              <input value={reason} onChange={(event) => setReason(event.target.value)} className={inputClass} required />
            </label>
          )}
          {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting} className="mt-1">{submitting ? "Сохранение…" : "Сохранить"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
