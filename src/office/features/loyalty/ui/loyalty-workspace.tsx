import { useState } from "react"

import { Banner, Button, DataTable, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Field, Input, SkeletonRows, type Column } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatQuantity, formatTenge } from "@/shared/lib/format"
import { cn } from "@/shared/lib/utils"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"

import { useAdjustPoints, useGuestHistory, useGuests, type Guest } from "../data/use-office-loyalty"

const KIND_LABEL: Record<string, string> = { accrual: "Начисление", redemption: "Списание", adjustment: "Корректировка" }

function formatPoints(points: number, { explicitPlus = false } = {}) {
  return `${explicitPlus && points > 0 ? "+" : ""}${formatQuantity(points)}`
}

const columns: Column<Guest>[] = [
  { key: "phone", header: "Телефон", sortValue: (guest) => guest.phone, cell: (guest) => <span className="font-semibold text-foreground tabular-nums">{guest.phone}</span> },
  { key: "name", header: "Имя", sortValue: (guest) => guest.name || null, cell: (guest) => <span className="text-muted-foreground">{guest.name || "—"}</span> },
  { key: "points", header: "Баллы", numeric: true, sortValue: (guest) => guest.points, cell: (guest) => <span className="font-semibold text-accent">{formatPoints(guest.points)}</span> },
]

export function LoyaltyWorkspace() {
  const [search, setSearch] = useState("")
  const { guests, loading } = useGuests(search)
  const [selected, setSelected] = useState<Guest | null>(null)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-3 xl:px-8">
        <Input
          type="search"
          aria-label="Поиск по телефону или имени"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Поиск по телефону или имени…"
          className="w-72"
        />
        <p className="text-caption text-muted-foreground">Начисление: 1 балл за каждые {formatTenge(100)} чека</p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-4 xl:px-8">
        <DataTable
          caption="Гости программы лояльности"
          columns={columns}
          rows={loading ? undefined : guests}
          getRowId={(guest) => guest._id}
          onRowClick={setSelected}
          selectedId={selected?._id ?? null}
          empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Гостей пока нет</p>}
        />
      </div>

      {selected ? <GuestDetailDialog guest={guests.find((candidate) => candidate._id === selected._id) ?? selected} onClose={() => setSelected(null)} /> : null}
    </div>
  )
}

function GuestDetailDialog({ guest, onClose }: { guest: Guest; onClose: () => void }) {
  const { history, loading } = useGuestHistory(guest._id)
  const adjustPoints = useAdjustPoints()
  const [adjusting, setAdjusting] = useState(false)
  const [points, setPoints] = useState("")
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleAdjust(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await adjustPoints({ guestId: guest._id, points: Number(points), reason })
      setAdjusting(false)
      setPoints("")
      setReason("")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось скорректировать баллы"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{guest.name || guest.phone}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-between gap-3 rounded-card border border-border bg-muted p-3">
          <div>
            <p className="text-caption font-medium text-muted-foreground tabular-nums">{guest.phone}</p>
            <p className="sq-price text-title font-semibold text-accent">{formatPoints(guest.points)} баллов</p>
          </div>
          <Button size="sm" variant="secondary" aria-expanded={adjusting} onClick={() => setAdjusting((current) => !current)}>
            Скорректировать
          </Button>
        </div>

        {adjusting ? (
          <form onSubmit={handleAdjust} className="flex flex-col gap-3 rounded-card border border-border p-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Баллы (± целое число)">
                {(control) => <Input {...control} type="number" inputMode="numeric" step={1} value={points} onChange={(event) => setPoints(event.target.value)} required />}
              </Field>
              <Field label="Причина">{(control) => <Input {...control} value={reason} onChange={(event) => setReason(event.target.value)} required />}</Field>
            </div>
            {error && <Banner tone="danger" title={error} />}
            <DialogFooter>
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting ? "Сохранение…" : "Применить"}
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        <section className="flex flex-col gap-2">
          <h3 className="text-body-sm font-semibold text-foreground">История</h3>
          {loading ? (
            <SkeletonRows rows={3} />
          ) : (
            <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
              {history.map((entry) => (
                <div key={entry._id} className="flex items-center justify-between gap-3 text-body-sm">
                  <div>
                    <span className="font-semibold text-foreground">{KIND_LABEL[entry.kind] ?? entry.kind}</span>
                    {entry.reason ? <span className="text-muted-foreground"> — {entry.reason}</span> : null}
                    <p className="text-caption text-muted-foreground">{formatAlmatyDateTime(entry.occurredAt)}</p>
                  </div>
                  <span className={cn("font-semibold tabular-nums whitespace-nowrap", entry.points < 0 ? "text-destructive" : "text-success")}>
                    {formatPoints(entry.points, { explicitPlus: true })}
                  </span>
                </div>
              ))}
              {!history.length && <p className="text-body-sm text-muted-foreground">Движений пока нет</p>}
            </div>
          )}
        </section>
      </DialogContent>
    </Dialog>
  )
}
