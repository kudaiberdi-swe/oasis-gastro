import { useState } from "react"

import { Button } from "@/shared/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog"
import { errorMessage } from "@/shared/lib/error-message"
import { cn } from "@/shared/lib/utils"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"

import { useAdjustPoints, useGuestHistory, useGuests, type Guest } from "../data/use-office-loyalty"

const inputClass = "h-11 rounded-[var(--radius-control)] border border-border bg-background px-3 text-sm outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus:border-primary/50"

const KIND_LABEL: Record<string, string> = { accrual: "Начисление", redemption: "Списание", adjustment: "Корректировка" }

export function LoyaltyWorkspace() {
  const [search, setSearch] = useState("")
  const { guests, loading } = useGuests(search)
  const [selected, setSelected] = useState<Guest | null>(null)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по телефону или имени…" className={cn(inputClass, "h-9 w-72")} />
        <p className="text-xs text-muted-foreground">Начисление: 1 балл за каждые 100 ₸ чека</p>
      </div>

      {loading ? (
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Загрузка…</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-2 text-left">Телефон</th>
                <th className="px-3 py-2 text-left">Имя</th>
                <th className="px-3 py-2 text-right">Баллы</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {guests.map((guest) => (
                <tr key={guest._id} className="border-t border-border/60 hover:bg-muted/40">
                  <td className="px-5 py-2 font-semibold text-foreground">{guest.phone}</td>
                  <td className="px-3 py-2 text-muted-foreground">{guest.name || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-accent">{guest.points}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="secondary" onClick={() => setSelected(guest)}>Открыть</Button>
                  </td>
                </tr>
              ))}
              {!guests.length && (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-sm text-muted-foreground">Гостей пока нет</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

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
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{guest.name || guest.phone}</DialogTitle></DialogHeader>
        <div className="flex items-center justify-between rounded-[var(--radius-card)] border border-border bg-muted/40 p-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">{guest.phone}</p>
            <p className="font-display text-2xl font-semibold tabular-nums text-accent">{guest.points} баллов</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setAdjusting((current) => !current)}>Скорректировать</Button>
        </div>

        {adjusting ? (
          <form onSubmit={handleAdjust} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border p-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-muted-foreground">Баллы (± целое число)</span>
                <input type="number" step={1} value={points} onChange={(event) => setPoints(event.target.value)} className={inputClass} required />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-muted-foreground">Причина</span>
                <input value={reason} onChange={(event) => setReason(event.target.value)} className={inputClass} required />
              </label>
            </div>
            {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
            <Button type="submit" size="sm" disabled={submitting}>{submitting ? "Сохранение…" : "Применить"}</Button>
          </form>
        ) : null}

        <div>
          <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-muted-foreground">История</p>
          {loading ? (
            <p className="text-sm text-muted-foreground">Загрузка…</p>
          ) : (
            <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
              {history.map((entry) => (
                <div key={entry._id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-semibold text-foreground">{KIND_LABEL[entry.kind] ?? entry.kind}</span>
                    {entry.reason ? <span className="text-muted-foreground"> — {entry.reason}</span> : null}
                    <p className="text-xs text-muted-foreground">{formatAlmatyDateTime(entry.occurredAt)}</p>
                  </div>
                  <span className={cn("tabular-nums font-semibold", entry.points < 0 ? "text-destructive" : "text-success")}>{entry.points > 0 ? "+" : ""}{entry.points}</span>
                </div>
              ))}
              {!history.length && <p className="text-sm text-muted-foreground">Движений пока нет</p>}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
