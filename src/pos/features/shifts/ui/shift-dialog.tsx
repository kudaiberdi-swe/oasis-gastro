import { useState } from "react"

import { Button } from "@/shared/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog"
import { errorMessage } from "@/shared/lib/error-message"
import { formatTenge } from "@/shared/lib/utils"

export function OpenShiftDialog({ open, onOpen }: { open: boolean; onOpen: (openingCash: number, note: string) => Promise<unknown> }) {
  const [openingCash, setOpeningCash] = useState("0")
  const [note, setNote] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      await onOpen(Math.max(0, Math.round(Number(openingCash))), note)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось открыть смену"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent hideClose className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Открытие смены</DialogTitle>
        </DialogHeader>
        <label className="text-sm text-muted-foreground">Наличность в кассе на начало смены</label>
        <input
          type="number"
          value={openingCash}
          onChange={(event) => setOpeningCash(event.target.value)}
          className="h-12 rounded-[var(--radius-control)] border border-border bg-card px-3 text-right text-lg font-bold outline-none"
        />
        <label className="text-sm text-muted-foreground">Комментарий</label>
        <input value={note} onChange={(event) => setNote(event.target.value)} className="h-11 rounded-[var(--radius-control)] border border-border bg-card px-3 outline-none" />
        {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
        <Button size="lg" onClick={submit} disabled={submitting}>
          {submitting ? "Открытие…" : "Открыть смену"}
        </Button>
      </DialogContent>
    </Dialog>
  )
}

export function CloseShiftDialog({
  open,
  onOpenChange,
  expectedCash,
  blockers,
  onClose,
  onManagerRequired,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  expectedCash: number
  blockers: Array<{ number: number; tableLabel?: string }>
  onClose: (countedCash: number, note: string, managerApprovalToken?: string) => Promise<unknown>
  onManagerRequired: (reason: string) => Promise<string | null>
}) {
  const [countedCash, setCountedCash] = useState(String(expectedCash))
  const [note, setNote] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const variance = Math.round(Number(countedCash)) - expectedCash

  async function submit() {
    if (blockers.length) {
      setError("Закройте или отложите все открытые заказы")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      let managerApprovalToken: string | undefined
      if (Math.abs(variance) >= 1000) {
        const token = await onManagerRequired(`Подтвердите расхождение ${variance} ₸`)
        if (!token) {
          setSubmitting(false)
          return
        }
        managerApprovalToken = token
      }
      await onClose(Math.round(Number(countedCash)), note, managerApprovalToken)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось закрыть смену"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Закрытие смены</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Ожидается в кассе: {formatTenge(expectedCash)}</p>
        {blockers.length > 0 && (
          <div className="rounded-[var(--radius-card)] bg-destructive/10 p-3 text-sm text-destructive">
            Есть незакрытые заказы: {blockers.map((b) => b.tableLabel || `№${b.number}`).join(", ")}
          </div>
        )}
        <label className="text-sm text-muted-foreground">Фактическая наличность</label>
        <input
          type="number"
          value={countedCash}
          onChange={(event) => setCountedCash(event.target.value)}
          className="h-12 rounded-[var(--radius-control)] border border-border bg-card px-3 text-right text-lg font-bold outline-none"
        />
        {variance !== 0 && <p className={variance > 0 ? "text-sm font-semibold text-success" : "text-sm font-semibold text-destructive"}>Расхождение: {variance > 0 ? "+" : ""}{variance} ₸</p>}
        <label className="text-sm text-muted-foreground">Комментарий</label>
        <input value={note} onChange={(event) => setNote(event.target.value)} className="h-11 rounded-[var(--radius-control)] border border-border bg-card px-3 outline-none" />
        {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
        <Button size="lg" onClick={submit} disabled={submitting}>
          {submitting ? "Закрытие…" : "Закрыть смену"}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
