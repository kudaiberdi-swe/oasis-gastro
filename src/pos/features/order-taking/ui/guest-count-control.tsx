import { useState } from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { Minus, Plus, Users } from "lucide-react"

import { Button } from "@/shared/components/ui/button"

export const GUESTS_MIN = 1
export const GUESTS_MAX = 30

/**
 * «Гостей: —» in the order panel's title area: tapping it opens a small stepper (48 px targets, 1–30)
 * and «Готово» saves the number with the check (saveDraft guestCount). Unset stays «—»: the count is
 * never guessed from the table's capacity.
 */
export function GuestCountControl({ value, onChange, disabled }: { value?: number; onChange: (count: number) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value ?? GUESTS_MIN)

  function toggle(next: boolean) {
    if (next) setDraft(value ?? GUESTS_MIN)
    setOpen(next)
  }

  function save() {
    setOpen(false)
    if (draft !== value) onChange(draft)
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={toggle}>
      <PopoverPrimitive.Trigger asChild>
        <Button variant="ghost" className="h-12 shrink-0 px-2 text-body" disabled={disabled} aria-label={`Гостей: ${value ?? "не указано"}`}>
          <Users aria-hidden />
          <span>
            Гостей: <span className="font-semibold tabular-nums">{value ?? "—"}</span>
          </span>
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content align="start" sideOffset={4} aria-label="Число гостей" className="z-50 flex flex-col gap-3 rounded-card border border-border bg-popover p-3 text-popover-foreground shadow-float">
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="icon" className="size-12" aria-label="Меньше гостей" onClick={() => setDraft((count) => Math.max(GUESTS_MIN, count - 1))} disabled={draft <= GUESTS_MIN}>
              <Minus />
            </Button>
            <output aria-live="polite" aria-label="Гостей" className="w-12 text-center font-display text-title font-semibold tabular-nums">
              {draft}
            </output>
            <Button variant="secondary" size="icon" className="size-12" aria-label="Больше гостей" onClick={() => setDraft((count) => Math.min(GUESTS_MAX, count + 1))} disabled={draft >= GUESTS_MAX}>
              <Plus />
            </Button>
          </div>
          <Button className="h-12" onClick={save}>
            Готово
          </Button>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
