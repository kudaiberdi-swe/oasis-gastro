import { useId, useState } from "react"

import { cn } from "@/shared/lib/utils"

import { formatBusinessDay } from "../model/format"

// Time series as violet bars (OFFICE-DESIGN §3.7/§3.8): plain divs, no chart dependency. One series → no
// legend, the title names it; bars grow from the zero line over a recessive --border grid, refunds below
// it in --destructive. Hovering a bar dims the others and shows the day and value; a visually hidden
// table carries the same numbers for screen readers.

export type ChartPoint = { date: string; value: number }

export function ReportChart({ title, points, format, className }: { title: string; points: ChartPoint[]; format: (value: number) => string; className?: string }) {
  const titleId = useId()
  const [active, setActive] = useState<number | null>(null)
  if (points.length < 2) return null

  const values = points.map((point) => point.value)
  const max = Math.max(...values, 0)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  // Distance from the top in % of the plot height.
  const top = (value: number) => ((max - value) / span) * 100
  const zero = top(0)
  const slot = 100 / points.length
  const current = active === null ? null : points[active]

  const pick = (clientX: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    if (!rect.width) return
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    setActive(Math.min(points.length - 1, Math.floor(ratio * points.length)))
  }

  return (
    <figure aria-labelledby={titleId} className={cn("flex flex-col gap-4 rounded-card border border-border bg-card p-5", className)}>
      <figcaption id={titleId} className="text-body font-semibold text-foreground">
        {title}
      </figcaption>
      <div className="grid grid-cols-[auto_1fr] gap-x-3">
        <div aria-hidden className="flex h-48 flex-col justify-between text-right text-caption text-muted-foreground tabular-nums">
          <span>{format(max)}</span>
          <span>{format(min)}</span>
        </div>
        <div className="relative h-48 touch-none" onPointerMove={(event) => pick(event.clientX, event.currentTarget)} onPointerLeave={() => setActive(null)}>
          {[0, 50, 100].map((share) => (
            <span key={share} aria-hidden className="absolute inset-x-0 border-t border-dashed border-border" style={{ top: `${share}%` }} />
          ))}
          {min < 0 ? <span aria-hidden className="absolute inset-x-0 border-t border-input" style={{ top: `${zero}%` }} /> : null}
          {points.map((point, index) => {
            const negative = point.value < 0
            const from = negative ? zero : top(point.value)
            const to = negative ? top(point.value) : zero
            return (
              <span key={point.date} aria-hidden className="absolute inset-y-0" style={{ left: `${index * slot}%`, width: `${slot}%` }}>
                <span
                  className={cn(
                    "absolute left-1/2 w-[62%] max-w-7 min-w-[3px] -translate-x-1/2 transition-opacity duration-150",
                    negative ? "rounded-b-box bg-destructive" : "rounded-t-box bg-primary",
                    active !== null && active !== index && "opacity-35",
                  )}
                  style={{ top: `${from}%`, height: `max(${to - from}%, ${point.value === 0 ? 0 : 2}px)` }}
                />
              </span>
            )
          })}
          {current && active !== null ? (
            <span
              role="status"
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-control border border-border bg-popover px-2.5 py-1.5 text-caption whitespace-nowrap text-foreground shadow-float"
              style={{ left: `${Math.min(90, Math.max(10, (active + 0.5) * slot))}%` }}
            >
              <span className="text-muted-foreground">{formatBusinessDay(current.date)}</span> · <span className="font-semibold tabular-nums">{format(current.value)}</span>
            </span>
          ) : null}
        </div>
        <span aria-hidden />
        <div aria-hidden className="mt-2 flex justify-between text-caption text-muted-foreground tabular-nums">
          <span>{formatBusinessDay(points[0].date)}</span>
          <span>{formatBusinessDay(points[points.length - 1].date)}</span>
        </div>
      </div>
      <table className="sr-only">
        <caption>{title}: данные графика</caption>
        <thead>
          <tr>
            <th scope="col">Дата</th>
            <th scope="col">Значение</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.date}>
              <td>{formatBusinessDay(point.date)}</td>
              <td>{format(point.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
