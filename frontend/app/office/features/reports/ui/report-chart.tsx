import { useId, useState } from "react"

import { formatBusinessDay } from "../model/format"

// Time-series line (OFFICE-DESIGN §3.7/§3.8): inline SVG, no chart dependency. One series → no legend,
// the title names it; the line is --accent 2px on a recessive --border grid. Hover or focus shows a
// crosshair with the day and value; a visually hidden table carries the same numbers for screen readers.

export type ChartPoint = { date: string; value: number }

const WIDTH = 600
const HEIGHT = 180

export function ReportChart({ title, points, format }: { title: string; points: ChartPoint[]; format: (value: number) => string }) {
  const titleId = useId()
  const [active, setActive] = useState<number | null>(null)
  if (points.length < 2) return null

  const values = points.map((point) => point.value)
  const max = Math.max(...values, 0)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const x = (index: number) => (index / (points.length - 1)) * WIDTH
  const y = (value: number) => HEIGHT - ((value - min) / span) * HEIGHT
  const line = points.map((point, index) => `${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ")
  const current = active === null ? null : points[active]

  const pick = (clientX: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    if (!rect.width) return
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    setActive(Math.round(ratio * (points.length - 1)))
  }

  return (
    <figure aria-labelledby={titleId} className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
      <figcaption id={titleId} className="text-body-sm font-semibold text-foreground">
        {title}
      </figcaption>
      <div className="grid grid-cols-[auto_1fr] gap-x-3">
        <div aria-hidden className="flex h-44 flex-col justify-between text-right text-caption text-muted-foreground tabular-nums">
          <span>{format(max)}</span>
          <span>{format(min)}</span>
        </div>
        <div
          className="relative h-44 touch-none"
          onPointerMove={(event) => pick(event.clientX, event.currentTarget)}
          onPointerLeave={() => setActive(null)}
        >
          <svg aria-hidden viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
            {[0, 0.5, 1].map((share) => (
              <line key={share} x1={0} x2={WIDTH} y1={HEIGHT * share} y2={HEIGHT * share} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            <polyline points={line} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {current && active !== null ? (
            <>
              <span aria-hidden className="absolute inset-y-0 w-px bg-border" style={{ left: `${(active / (points.length - 1)) * 100}%` }} />
              <span
                aria-hidden
                className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-round bg-accent ring-2 ring-card"
                style={{ left: `${(active / (points.length - 1)) * 100}%`, top: `${(y(current.value) / HEIGHT) * 100}%` }}
              />
              <span
                role="status"
                className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-control border border-border bg-popover px-2 py-1 text-caption whitespace-nowrap text-foreground shadow-float"
                style={{ left: `${Math.min(90, Math.max(10, (active / (points.length - 1)) * 100))}%` }}
              >
                <span className="text-muted-foreground">{formatBusinessDay(current.date)}</span> · <span className="font-semibold tabular-nums">{format(current.value)}</span>
              </span>
            </>
          ) : null}
        </div>
        <span aria-hidden />
        <div aria-hidden className="mt-1 flex justify-between text-caption text-muted-foreground tabular-nums">
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
