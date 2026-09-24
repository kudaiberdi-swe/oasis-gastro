import { Plus } from "lucide-react"
import { useState } from "react"

import {
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  SegmentedControl,
  Select,
  SkeletonRows,
  TonePill,
  type Column,
} from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { formatQuantity, formatTenge } from "@/shared/lib/format"
import type { StatusTone } from "@/shared/lib/status-dictionary"
import { cn } from "@/shared/lib/utils"

import { useOfficeStock, useOfficeStockMutations, useRecentMovements, type InventoryItemId, type OfficeInventoryItem, type OfficeStockRestaurant } from "../data/use-office-stock"

const UNITS = ["кг", "л", "шт", "порц."] as const
const UNIT_OPTIONS = UNITS.map((unit) => ({ value: unit, label: unit }))

const TAB_OPTIONS = [
  { value: "balances" as const, label: "Остатки" },
  { value: "log" as const, label: "Журнал" },
]

const KIND_LABEL: Record<string, { label: string; tone: StatusTone }> = {
  receipt: { label: "Приход", tone: "success" },
  writeoff: { label: "Списание", tone: "danger" },
  adjustment: { label: "Инвентаризация", tone: "info" },
}

type StockAction = { kind: "receipt" | "writeoff" | "adjust"; item: OfficeInventoryItem; restaurantExternalId: string } | null

type Movement = ReturnType<typeof useRecentMovements>["movements"][number]

export function StockWorkspace() {
  const { items, restaurants, loading } = useOfficeStock()
  const mutations = useOfficeStockMutations()
  const [tab, setTab] = useState<"balances" | "log">("balances")
  const [creating, setCreating] = useState(false)
  const [action, setAction] = useState<StockAction>(null)

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col p-5">
        <SkeletonRows />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <SegmentedControl aria-label="Раздел склада" value={tab} onValueChange={setTab} options={TAB_OPTIONS} />
        {tab === "balances" ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> Добавить товар
          </Button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-5">{tab === "balances" ? <BalancesTable items={items} restaurants={restaurants} onAction={setAction} /> : <MovementsLog />}</div>

      {creating ? <CreateItemDialog onClose={() => setCreating(false)} onCreate={mutations.createInventoryItem} /> : null}

      {action ? (
        <StockActionDialog action={action} onClose={() => setAction(null)} onReceive={mutations.receiveStock} onWriteOff={mutations.writeOffStock} onAdjust={mutations.adjustStock} />
      ) : null}
    </div>
  )
}

const cellActionClass = "h-7 px-2 text-caption"

function BalancesTable({ items, restaurants, onAction }: { items: OfficeInventoryItem[]; restaurants: OfficeStockRestaurant[]; onAction: (action: StockAction) => void }) {
  const columns: Column<OfficeInventoryItem>[] = [
    {
      key: "item",
      header: "Товар",
      sortValue: (item) => item.name,
      cell: (item) => (
        <div className="flex flex-col">
          <span className="font-semibold text-foreground">{item.name}</span>
          <span className="text-caption text-muted-foreground">
            {item.unit}
            {item.minimumStock !== undefined ? ` · мин. ${formatQuantity(item.minimumStock)}` : ""}
          </span>
        </div>
      ),
    },
    ...restaurants.map(
      (restaurant): Column<OfficeInventoryItem> => ({
        key: restaurant.externalId,
        header: restaurant.name,
        numeric: true,
        className: "align-top",
        cell: (item) => {
          const balance = item.balances.find((candidate) => candidate.restaurantExternalId === restaurant.externalId)
          const quantity = balance?.quantity ?? 0
          const low = item.minimumStock !== undefined && quantity < item.minimumStock
          return (
            <div className="flex flex-col items-end gap-0.5">
              <span className={cn("font-semibold", low ? "text-destructive" : "text-foreground")}>{formatQuantity(quantity, item.unit)}</span>
              {balance?.averageUnitCost ? (
                <span className="text-caption text-muted-foreground">
                  ~{formatTenge(balance.averageUnitCost)}/{item.unit}
                </span>
              ) : null}
              <div className="mt-1 flex justify-end gap-1">
                <Button variant="ghost" size="sm" className={cn(cellActionClass, "text-accent")} onClick={() => onAction({ kind: "receipt", item, restaurantExternalId: restaurant.externalId })}>
                  Приход
                </Button>
                <Button variant="ghost" size="sm" className={cn(cellActionClass, "text-destructive")} onClick={() => onAction({ kind: "writeoff", item, restaurantExternalId: restaurant.externalId })}>
                  Списать
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(cellActionClass, "text-muted-foreground")}
                  title="Инвентаризация"
                  onClick={() => onAction({ kind: "adjust", item, restaurantExternalId: restaurant.externalId })}
                >
                  Инв.
                </Button>
              </div>
            </div>
          )
        },
      }),
    ),
  ]

  return <DataTable caption="Остатки" columns={columns} rows={items} getRowId={(item) => item._id} empty={<EmptyState title="Товаров пока нет" description="Добавьте товар, чтобы вести его остатки." />} />
}

function MovementsLog() {
  const { movements, loading } = useRecentMovements()

  const columns: Column<Movement>[] = [
    { key: "when", header: "Когда", sortValue: (movement) => movement.occurredAt, cell: (movement) => <span className="whitespace-nowrap text-muted-foreground">{formatAlmatyDateTime(movement.occurredAt)}</span> },
    { key: "item", header: "Товар", sortValue: (movement) => movement.itemName, cell: (movement) => <span className="font-semibold">{movement.itemName}</span> },
    {
      key: "kind",
      header: "Тип",
      cell: (movement) => {
        const kind = KIND_LABEL[movement.kind]
        return <TonePill tone={kind?.tone ?? "neutral"}>{kind?.label ?? movement.kind}</TonePill>
      },
    },
    {
      key: "delta",
      header: "Изменение",
      numeric: true,
      sortValue: (movement) => movement.quantityDelta,
      cell: (movement) => (
        <span className={cn("font-semibold", movement.quantityDelta < 0 ? "text-destructive" : "text-foreground")}>
          {movement.quantityDelta > 0 ? "+" : ""}
          {formatQuantity(movement.quantityDelta, movement.itemUnit)}
        </span>
      ),
    },
    { key: "balance", header: "Остаток", numeric: true, cell: (movement) => formatQuantity(movement.balanceAfter, movement.itemUnit) },
    {
      key: "actor",
      header: "Кто / причина",
      cell: (movement) => (
        <span className="text-muted-foreground">
          {movement.actorEmail}
          {movement.reason ? ` · ${movement.reason}` : ""}
        </span>
      ),
    },
  ]

  return <DataTable caption="Журнал движений" columns={columns} rows={loading ? undefined : movements} getRowId={(movement) => movement._id} empty={<EmptyState title="Движений пока нет" />} />
}

function FormError({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-body-sm font-medium text-destructive">
      {error}
    </p>
  ) : null
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
        <DialogHeader>
          <DialogTitle>Новый товар на складе</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Название">{(control) => <Input {...control} value={name} onChange={(event) => setName(event.target.value)} required />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ед. измерения">{(control) => <Select {...control} value={unit} onValueChange={(value) => setUnit(value as (typeof UNITS)[number])} options={UNIT_OPTIONS} />}</Field>
            <Field label="Мин. остаток (необязательно)">
              {(control) => <Input {...control} type="number" inputMode="decimal" min={0} className="text-right tabular-nums" value={minimumStock} onChange={(event) => setMinimumStock(event.target.value)} />}
            </Field>
          </div>
          <FormError error={error} />
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Сохранение…" : "Добавить"}
            </Button>
          </DialogFooter>
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

  const numberInputProps = { type: "number", inputMode: "decimal", min: 0, step: "any", required: true, className: "text-right tabular-nums" } as const

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {title}: {action.item.name}
          </DialogTitle>
          <DialogDescription>Текущий остаток: {formatQuantity(currentBalance?.quantity ?? 0, action.item.unit)}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label={action.kind === "adjust" ? `Фактический остаток, ${action.item.unit}` : `Количество, ${action.item.unit}`}>
            {(control) => <Input {...control} {...numberInputProps} value={quantity} onChange={(event) => setQuantity(event.target.value)} />}
          </Field>
          {action.kind === "receipt" ? (
            <Field label={`Цена за ${action.item.unit}, ₸`}>{(control) => <Input {...control} {...numberInputProps} value={unitCost} onChange={(event) => setUnitCost(event.target.value)} />}</Field>
          ) : (
            <Field label="Причина">{(control) => <Input {...control} value={reason} onChange={(event) => setReason(event.target.value)} required />}</Field>
          )}
          <FormError error={error} />
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
