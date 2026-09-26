import { describeStatus, normalizeStatus, type StatusDomain, type StatusTone } from "@/shared/lib/status-dictionary"
import { useUiLabels } from "@/shared/lib/ui-labels"
import { cn } from "@/shared/lib/utils"

// Opaque tints (theme.css *-surface), so a pill reads the same on cream, on a card and on parchment;
// «Отложен» is amber, «Возвращён» the muted danger family, «Оплачен» a clear green (contrast-checked).
export const toneClass: Record<StatusTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  success: "border-success/35 bg-success-surface text-success",
  warning: "border-warning/35 bg-warning-surface text-warning-foreground",
  danger: "border-destructive/35 bg-destructive-surface text-destructive",
  "danger-muted": "border-destructive-muted/35 bg-muted text-destructive-muted",
  info: "border-accent/30 bg-accent/10 text-accent",
}

export interface StatusPillProps {
  domain: StatusDomain
  status: string
  className?: string
}

/**
 * Every status on screen goes through the dictionary: Russian label + tone, never the raw value. The POS
 * in Kazakh supplies its own label for a known status (UiLabelsProvider); the tone stays the dictionary's.
 */
export function StatusPill({ domain, status, className }: StatusPillProps) {
  const labels = useUiLabels()
  const entry = describeStatus(domain, status)
  const label = (entry.known && labels.status?.(domain, normalizeStatus(domain, status))) || entry.label
  return (
    <span
      title={entry.known ? undefined : status}
      className={cn("inline-flex h-6 items-center rounded-control border px-2 text-caption font-medium whitespace-nowrap", toneClass[entry.tone], className)}
    >
      {label}
    </span>
  )
}

/** A pill with a free label — for counts and flags that are not backend statuses. */
export function TonePill({ tone = "neutral", className, children }: { tone?: StatusTone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex h-6 items-center rounded-control border px-2 text-caption font-medium whitespace-nowrap", toneClass[tone], className)}>{children}</span>
  )
}
