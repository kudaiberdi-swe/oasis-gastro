import { polygonSelfIntersects, type GeoPoint } from "@convex/lib/deliveryCore"

// Zone geometry without a map provider (W2-DLV-06, L-24): «одна координата latitude,longitude на строку»
// and an SVG preview. The self-intersection check is the server's own (convex/lib/deliveryCore.ts).

export type { GeoPoint }

export type CoordinateError = { line: number; message: string }

export type ParsedPolygon = { points: GeoPoint[]; errors: CoordinateError[] }

export const MIN_POLYGON_POINTS = 3
export const MAX_POLYGON_POINTS = 200

const NUMBER = String.raw`[-+]?\d+(?:[.,]\d+)?`
// «43.25, 76.95», «43.25;76.95», «43.25 76.95», «43,25; 76,95» (decimal commas need a «;» or a space).
const LINE = new RegExp(String.raw`^(${NUMBER})\s*[;\s]\s*(${NUMBER})$|^([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)$`)

const toNumber = (text: string) => Number(text.replace(",", "."))

/** Parses one point per line; blank lines are skipped, every bad line is reported with its number. */
export function parseCoordinates(text: string): ParsedPolygon {
  const points: GeoPoint[] = []
  const errors: CoordinateError[] = []
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim()
    if (!line) return
    const match = LINE.exec(line)
    if (!match) {
      errors.push({ line: index + 1, message: "Нужен формат latitude,longitude" })
      return
    }
    const latitude = toNumber(match[1] ?? match[3])
    const longitude = toNumber(match[2] ?? match[4])
    if (!(Math.abs(latitude) <= 90)) {
      errors.push({ line: index + 1, message: "Широта должна быть от −90 до 90" })
      return
    }
    if (!(Math.abs(longitude) <= 180)) {
      errors.push({ line: index + 1, message: "Долгота должна быть от −180 до 180" })
      return
    }
    points.push({ latitude, longitude })
  })
  return { points, errors }
}

export function formatCoordinates(points: readonly GeoPoint[]) {
  return points.map((point) => `${point.latitude},${point.longitude}`).join("\n")
}

/** The first problem that keeps the zone from saving, in the server's words; null when it is fine. */
export function polygonProblem(parsed: ParsedPolygon): string | null {
  if (parsed.errors.length) {
    const [first] = parsed.errors
    return `Строка ${first.line}: ${first.message.toLocaleLowerCase("ru")}`
  }
  if (parsed.points.length < MIN_POLYGON_POINTS) return "Зона должна содержать минимум три точки"
  if (parsed.points.length > MAX_POLYGON_POINTS) return "Не больше 200 точек в зоне"
  if (polygonSelfIntersects(parsed.points)) return "Границы зоны пересекают сами себя"
  return null
}

export type ProjectedPolygon = { points: { x: number; y: number }[]; path: string }

/**
 * Fits the polygon into a `size`×`size` box with `padding`: longitude → x, latitude → y (north up),
 * longitude scaled by cos(latitude) so the shape is not stretched at Almaty's 43°.
 */
export function projectPolygon(points: readonly GeoPoint[], size = 240, padding = 16): ProjectedPolygon {
  if (points.length === 0) return { points: [], path: "" }
  const meanLatitude = points.reduce((sum, point) => sum + point.latitude, 0) / points.length
  const scaleX = Math.cos((meanLatitude * Math.PI) / 180) || 1
  const xs = points.map((point) => point.longitude * scaleX)
  const ys = points.map((point) => point.latitude)
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const span = Math.max(maxX - minX, maxY - minY) || 1
  const scale = (size - padding * 2) / span
  const offsetX = (size - (maxX - minX) * scale) / 2
  const offsetY = (size - (maxY - minY) * scale) / 2
  const projected = points.map((_, index) => ({
    x: Math.round((offsetX + (xs[index] - minX) * scale) * 100) / 100,
    y: Math.round((offsetY + (maxY - ys[index]) * scale) * 100) / 100,
  }))
  const path = projected.length >= 3 ? `M ${projected.map((point) => `${point.x} ${point.y}`).join(" L ")} Z` : `M ${projected.map((point) => `${point.x} ${point.y}`).join(" L ")}`
  return { points: projected, path }
}
