import * as React from "react"
import { Delete } from "lucide-react"

import { cn, focusRingClass } from "@/shared/lib/utils"

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "backspace"] as const

export interface PinPadProps {
  value: string
  onValueChange: (value: string) => void
  maxLength: number
  /** Enter on the physical keyboard (and the caller's own "Войти" button). */
  onSubmit?: () => void
  /** Dots instead of digits. */
  secret?: boolean
  label: string
  disabled?: boolean
  /** Listen to the physical keyboard while mounted (only one PinPad on screen should). */
  captureKeyboard?: boolean
  className?: string
}

function isTypingInField(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
}

/** 3×4 keypad, 72×64 keys, Cormorant digits, gold dots; digits, Backspace and Enter also from the keyboard (S-14). */
export function PinPad({ value, onValueChange, maxLength, onSubmit, secret = false, label, disabled = false, captureKeyboard = true, className }: PinPadProps) {
  const latest = React.useRef({ value, onValueChange, onSubmit, maxLength, disabled })
  latest.current = { value, onValueChange, onSubmit, maxLength, disabled }

  const press = React.useCallback((key: string) => {
    const { value: current, onValueChange: change, maxLength: max, disabled: off } = latest.current
    if (off) return
    if (key === "backspace") change(current.slice(0, -1))
    else if (current.length < max) change(current + key)
  }, [])

  React.useEffect(() => {
    if (!captureKeyboard) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingInField(event.target)) return
      if (/^\d$/.test(event.key)) press(event.key)
      else if (event.key === "Backspace") press("backspace")
      else if (event.key === "Enter" && !latest.current.disabled) {
        // A focused button handles its own Enter; submitting twice would log in twice.
        if (event.target instanceof HTMLButtonElement) return
        latest.current.onSubmit?.()
      } else return
      event.preventDefault()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [captureKeyboard, press])

  const keyClass = cn(
    "flex h-16 w-[72px] items-center justify-center rounded-control border border-input bg-card text-foreground transition-colors hover:bg-muted active:bg-secondary disabled:opacity-45",
    focusRingClass,
  )

  return (
    <div className={cn("flex flex-col items-center gap-4", className)}>
      <div role="status" aria-label={`${label}: введено ${value.length} из ${maxLength}`} className="flex h-10 items-center justify-center gap-3">
        {secret ? (
          Array.from({ length: Math.max(value.length, 4) }, (_, index) => (
            <span key={index} className={cn("size-3.5 rounded-round border-2 border-gold", index < value.length && "bg-gold")} />
          ))
        ) : (
          <span className="sq-price text-display font-semibold tracking-[0.2em] text-foreground">{value || " "}</span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2" aria-label={label} role="group">
        {KEYS.map((key, index) =>
          key === "" ? (
            <span key={`spacer-${index}`} />
          ) : key === "backspace" ? (
            <button key={key} type="button" className={keyClass} disabled={disabled} onClick={() => press(key)} aria-label="Стереть">
              <Delete className="size-6" />
            </button>
          ) : (
            <button key={key} type="button" className={cn(keyClass, "sq-price text-[28px] font-semibold")} disabled={disabled} onClick={() => press(key)}>
              {key}
            </button>
          ),
        )}
      </div>
    </div>
  )
}
