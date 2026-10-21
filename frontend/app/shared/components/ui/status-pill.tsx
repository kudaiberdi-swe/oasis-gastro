import { describeStatus, normalizeStatus, type StatusDomain, type StatusTone } from "@/shared/lib/status-dictionary"
import { useUiLabels } from "@/shared/lib/ui-labels"
import { cn } from "@/shared/lib/utils"

// Round chips on opaque tints (theme.css *-surface), no outline, so a pill reads the same on the lavender
// background and on a card; «Отложен» is amber, «Возвращён» the muted danger family, «Оплачен» green,
// info the violet tint (all contrast-checked).
export const toneClass: Record<StatusTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success-surface text-success",
  warning: "bg-warning-surface text-warning-foreground",
  danger: "bg-destructive-surface text-destructive",
  "danger-muted": "bg-muted text-destructive-muted",
  info: "bg-accent-surface text-accent",
}

const pillClass = "inline-flex h-6 items-center rounded-round px-2.5 text-caption font-medium whitespace-nowrap"

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
      className={cn(pillClass, toneClass[entry.tone], className)}
    >
      {label}
    </span>
  )
}

/** A pill with a free label — for counts and flags that are not backend statuses. */
export function TonePill({ tone = "neutral", className, children }: { tone?: StatusTone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn(pillClass, toneClass[tone], className)}>{children}</span>
  )
}
