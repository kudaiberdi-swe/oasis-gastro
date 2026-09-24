import { useState } from "react"

import { Button } from "@/shared/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog"
import { errorMessage } from "@/shared/lib/error-message"

import { useFindGuestByPhone } from "../data/use-loyalty"
import { cn, focusRingClass } from "@/shared/lib/utils"

export function GuestDialog({
  open,
  onOpenChange,
  currentGuest,
  sessionToken,
  onAttach,
  onDetach,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentGuest: { phone: string; name?: string; points: number } | null | undefined
  sessionToken: string
  onAttach: (phone: string, name?: string) => Promise<unknown>
  onDetach: () => Promise<unknown>
}) {
  const [phone, setPhone] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const found = useFindGuestByPhone(sessionToken, phone)

  async function handleAttach() {
    setSubmitting(true)
    setError(null)
    try {
      await onAttach(phone, name.trim() || undefined)
      setPhone("")
      setName("")
      onOpenChange(false)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось прикрепить гостя"))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDetach() {
    setSubmitting(true)
    setError(null)
    try {
      await onDetach()
      onOpenChange(false)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось открепить гостя"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Гость</DialogTitle>
        </DialogHeader>

        {currentGuest ? (
          <div className="rounded-[var(--radius-card)] border border-border bg-muted/40 p-3">
            <p className="font-semibold text-foreground">{currentGuest.name || currentGuest.phone}</p>
            {currentGuest.name && <p className="text-sm text-muted-foreground">{currentGuest.phone}</p>}
            <p className="mt-1 text-sm text-accent">{currentGuest.points} баллов</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={handleDetach} disabled={submitting}>Убрать гостя</Button>
            {error && <p className="mt-2 text-sm font-semibold text-destructive">{error}</p>}
          </div>
        ) : (
          <>
            <label className="text-sm text-muted-foreground">Телефон</label>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+7 700 000 00 00"
              className={cn("h-11 rounded-[var(--radius-control)] border border-border bg-card px-3 text-lg", focusRingClass)}
              inputMode="tel"
            />
            {found ? (
              <p className="text-sm text-success">Найден: {found.name || found.phone} · {found.points} баллов</p>
            ) : phone.replace(/\D/g, "").length >= 10 ? (
              <>
                <p className="text-sm text-muted-foreground">Новый гость</p>
                <label className="text-sm text-muted-foreground">Имя (необязательно)</label>
                <input value={name} onChange={(event) => setName(event.target.value)} className={cn("h-11 rounded-[var(--radius-control)] border border-border bg-card px-3", focusRingClass)} />
              </>
            ) : null}
            {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
            <Button size="lg" onClick={handleAttach} disabled={submitting || phone.replace(/\D/g, "").length < 10}>
              {submitting ? "Сохранение…" : "Прикрепить"}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
