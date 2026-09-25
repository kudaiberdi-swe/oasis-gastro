import { projectPolygon, type GeoPoint } from "../model/zone-polygon"

const SIZE = 240

/**
 * SVG preview of the zone until a map provider is chosen (W2-DLV-06, POS-DESIGN §6.4): north up,
 * vertices numbered in the order of the coordinate lines.
 */
export function ZonePolygonPreview({ points, invalid }: { points: readonly GeoPoint[]; invalid?: boolean }) {
  const projected = projectPolygon(points, SIZE)
  const label = points.length >= 3 ? `Контур зоны: ${points.length} точек` : "Контур зоны появится после трёх точек"
  return (
    <figure className="flex flex-col items-center gap-2 rounded-card border border-border bg-muted p-3">
      <svg role="img" aria-label={label} viewBox={`0 0 ${SIZE} ${SIZE}`} className="aspect-square w-full max-w-[280px]">
        {projected.points.length >= 2 ? (
          <path
            d={projected.path}
            className={invalid ? "fill-destructive/10 stroke-destructive" : "fill-accent/15 stroke-accent"}
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {projected.points.map((point, index) => (
          <g key={index}>
            <circle cx={point.x} cy={point.y} r={4} className="fill-card stroke-foreground" strokeWidth={1.5} />
            <text x={point.x + 7} y={point.y - 6} className="fill-muted-foreground text-[12px]">
              {index + 1}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="text-caption text-muted-foreground">{label} · север сверху</figcaption>
    </figure>
  )
}
