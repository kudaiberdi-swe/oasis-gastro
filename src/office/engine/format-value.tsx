import type { ReactNode } from "react"

import { StatusPill } from "@/shared/components/ui"
import { formatAlmatyDate, formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { formatHours, formatPercent, formatQuantity, formatTenge } from "@/shared/lib/format"
import type { StatusDomain } from "@/shared/lib/status-dictionary"

import type { ValueKind } from "./module-config"

/** One place that turns a typed value into text: hours are «8 ч», never «8 ₸» (L-10). */
export function formatValue(kind: ValueKind, value: unknown, options: { unit?: string; statusDomain?: StatusDomain } = {}): ReactNode {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground">—</span>
  switch (kind) {
    case "money":
      return formatTenge(Number(value))
    case "hours":
      return formatHours(Number(value))
    case "percent":
      return formatPercent(Number(value))
    case "qty":
      return formatQuantity(Number(value), options.unit)
    case "date":
      return formatAlmatyDate(Number(value))
    case "datetime":
      return formatAlmatyDateTime(Number(value))
    case "status":
      return <StatusPill domain={options.statusDomain ?? "document"} status={String(value)} />
    case "boolean":
      return value ? "Да" : "Нет"
    case "ref":
    case "text":
      return String(value)
  }
}

export function isNumericKind(kind: ValueKind) {
  return kind === "money" || kind === "hours" || kind === "percent" || kind === "qty"
}
