import { Search } from "lucide-react"
import { Component, useState, type ReactNode } from "react"

import { OfficeStatePage } from "@/office/components/state-page"
import { ConfirmDialog, Input, Switch } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

/** Marks a field that comes from iiko: the office never writes it (iiko stays read-only). */
export const IIKO_READ_ONLY_HINT = "Из iiko, только чтение"

/** A failed query (Convex hooks throw during render) becomes the error state with «Повторить» (OFFICE-DESIGN §7). */
export class CorporationErrorBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { error: unknown }> {
  state: { error: unknown } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-6 xl:p-8">
          <OfficeStatePage state={{ kind: "error", error: this.state.error, onRetry: this.props.onRetry }} />
        </div>
      )
    }
    return this.props.children
  }
}

/** Remounts the screen on «Повторить», so the queries subscribe again. */
export function WithErrorBoundary({ children }: { children: () => ReactNode }) {
  const [attempt, setAttempt] = useState(0)
  return (
    <CorporationErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      {children()}
    </CorporationErrorBoundary>
  )
}

export function EditorBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4" aria-label={title}>
      <h3 className="text-body font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  )
}

export function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (value: string) => void; placeholder: string; label: string }) {
  return (
    <label className="relative w-full max-w-[480px] min-w-[240px] flex-1 sm:flex-none sm:basis-[360px]">
      <span className="sr-only">{label}</span>
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="pl-9" />
    </label>
  )
}

/**
 * «Активна» switch: turning on saves at once, turning off asks first (OFFICE-DESIGN §7: disabling is a
 * dangerous action) and shows the server's refusal in the dialog.
 */
export function ActiveSwitch({
  id,
  label,
  active,
  disabled,
  confirmTitle,
  confirmDescription,
  onChange,
}: {
  id: string
  label: string
  active: boolean
  disabled?: boolean
  confirmTitle: string
  confirmDescription: string
  onChange: (active: boolean) => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function apply(next: boolean) {
    setBusy(true)
    setError(null)
    try {
      await onChange(next)
      setConfirming(false)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось изменить статус"))
      if (next) setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-body-sm font-medium text-foreground">
          {label}
        </label>
        <Switch
          id={id}
          checked={active}
          disabled={disabled || busy}
          onCheckedChange={(checked) => {
            if (checked) void apply(true)
            else {
              setError(null)
              setConfirming(true)
            }
          }}
        />
      </div>
      {error && !confirming ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirming(false)
        }}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel="Отключить"
        submitting={busy}
        error={error}
        onConfirm={() => apply(false)}
      />
    </div>
  )
}

/** Read-only facts in the card (Код, версия, источник). */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body-sm">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
