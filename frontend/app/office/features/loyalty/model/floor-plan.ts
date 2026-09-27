// Geometry of the floor plan (W2-LOY-07): tables live in grid units (convex diningTables x/y/width/height),
// the SVG draws them with a viewBox in the same units. Pure functions — the screen and the tests share them.

export type TableShape = "rect" | "circle"

export interface PlanTable {
  externalId?: string
  label: string
  capacity: number
  shape: TableShape
  x: number
  y: number
  width: number
  height: number
  rotation: number
  active: boolean
}

export interface Point {
  x: number
  y: number
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Snap step of drag and resize, grid units. */
export const GRID_STEP = 1
/** Smallest table side, grid units. */
export const MIN_SIDE = 1
/** saveTable accepts positions from 0 to 10 000. */
export const MAX_COORDINATE = 10_000
/** The plan is never drawn smaller than this, so an empty hall still shows a grid to place tables on. */
export const MIN_PLAN: Point = { x: 24, y: 14 }
/** Side of the resize handle in the bottom-right corner, grid units. */
export const HANDLE_SIZE = 0.8

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Rounds to the nearest grid step (1 → whole cells, 0.5 → half cells). */
export function snapToGrid(value: number, step = GRID_STEP) {
  const snapped = Math.round(value / step) * step
  // −0 and float dust (2.0000000004) never reach the server.
  return Number(snapped.toFixed(6)) + 0
}

/** Pointer position in screen pixels → grid units of the plan. null while the SVG has no size (not laid out). */
export function clientToGrid(client: Point, rect: { left: number; top: number; width: number; height: number }, viewBox: Box): Point | null {
  if (!(rect.width > 0 && rect.height > 0)) return null
  // preserveAspectRatio="xMinYMin meet": one scale for both axes, the plan sits in the top-left corner.
  const scale = Math.min(rect.width / viewBox.width, rect.height / viewBox.height)
  return { x: viewBox.x + (client.x - rect.left) / scale, y: viewBox.y + (client.y - rect.top) / scale }
}

export function tableCenter(table: Pick<PlanTable, "x" | "y" | "width" | "height">): Point {
  return { x: table.x + table.width / 2, y: table.y + table.height / 2 }
}

/** Rotates a point around a center, degrees clockwise (the SVG `rotate()` direction, y grows down). */
export function rotatePoint(point: Point, center: Point, degrees: number): Point {
  if (!degrees) return point
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const dx = point.x - center.x
  const dy = point.y - center.y
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
}

/** The point in the table's own (unrotated) frame. */
function toLocal(table: PlanTable, point: Point) {
  return rotatePoint(point, tableCenter(table), -table.rotation)
}

/** Whether a point is on the table: rectangles by their rotated bounds, circles (ellipses) by the equation. */
export function containsPoint(table: PlanTable, point: Point) {
  const local = toLocal(table, point)
  if (table.shape === "circle") {
    const center = tableCenter(table)
    const rx = table.width / 2
    const ry = table.height / 2
    return ((local.x - center.x) / rx) ** 2 + ((local.y - center.y) / ry) ** 2 <= 1
  }
  return local.x >= table.x && local.x <= table.x + table.width && local.y >= table.y && local.y <= table.y + table.height
}

/** The table under the pointer: the one drawn last (on top) wins. */
export function hitTest<T extends PlanTable>(tables: readonly T[], point: Point): T | null {
  for (let index = tables.length - 1; index >= 0; index -= 1) {
    if (containsPoint(tables[index], point)) return tables[index]
  }
  return null
}

/** Whether the point is on the resize handle in the table's bottom-right corner (in its own frame). */
export function hitResizeHandle(table: PlanTable, point: Point, size = HANDLE_SIZE) {
  const local = toLocal(table, point)
  const right = table.x + table.width
  const bottom = table.y + table.height
  return local.x >= right - size && local.x <= right + size / 2 && local.y >= bottom - size && local.y <= bottom + size / 2
}

/** Drag: the table follows the pointer by the distance moved since the grab, snapped and kept on the plan. */
export function moveTable<T extends PlanTable>(table: T, grab: { origin: Point; pointer: Point }, pointer: Point, step = GRID_STEP): T {
  const x = clamp(snapToGrid(grab.origin.x + pointer.x - grab.pointer.x, step), 0, MAX_COORDINATE)
  const y = clamp(snapToGrid(grab.origin.y + pointer.y - grab.pointer.y, step), 0, MAX_COORDINATE)
  return x === table.x && y === table.y ? table : { ...table, x, y }
}

/** Resize from the bottom-right handle: the top-left corner stays, sides snap and never go below MIN_SIDE. */
export function resizeTable<T extends PlanTable>(table: T, pointer: Point, step = GRID_STEP): T {
  const local = toLocal(table, pointer)
  const width = Math.max(MIN_SIDE, snapToGrid(local.x - table.x, step))
  const height = Math.max(MIN_SIDE, snapToGrid(local.y - table.y, step))
  return width === table.width && height === table.height ? table : { ...table, width, height }
}

/** Moves a table by whole steps (arrow keys in the editing mode). */
export function nudgeTable<T extends PlanTable>(table: T, dx: number, dy: number, step = GRID_STEP): T {
  return { ...table, x: clamp(snapToGrid(table.x + dx * step, step), 0, MAX_COORDINATE), y: clamp(snapToGrid(table.y + dy * step, step), 0, MAX_COORDINATE) }
}

/** Axis-aligned bounds of a (possibly rotated) table. */
export function tableBounds(table: PlanTable): Box {
  if (!table.rotation || (table.shape === "circle" && table.width === table.height)) return { x: table.x, y: table.y, width: table.width, height: table.height }
  const center = tableCenter(table)
  const corners = [
    { x: table.x, y: table.y },
    { x: table.x + table.width, y: table.y },
    { x: table.x, y: table.y + table.height },
    { x: table.x + table.width, y: table.y + table.height },
  ].map((corner) => rotatePoint(corner, center, table.rotation))
  const xs = corners.map((corner) => corner.x)
  const ys = corners.map((corner) => corner.y)
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}

/** The drawn area: every table plus a two-cell margin, never smaller than MIN_PLAN. Starts at 0:0. */
export function planViewBox(tables: readonly PlanTable[], margin = 2): Box {
  let width = MIN_PLAN.x
  let height = MIN_PLAN.y
  for (const table of tables) {
    const bounds = tableBounds(table)
    width = Math.max(width, Math.ceil(bounds.x + bounds.width + margin))
    height = Math.max(height, Math.ceil(bounds.y + bounds.height + margin))
  }
  return { x: 0, y: 0, width, height }
}

function overlaps(a: Box, b: Box) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** Where a new table of the given size goes: the first free cell row by row (one cell apart from others). */
export function freeSpot(tables: readonly PlanTable[], size: { width: number; height: number }, planWidth = MIN_PLAN.x): Point {
  const taken = tables.map((table) => {
    const bounds = tableBounds(table)
    return { x: bounds.x - 1, y: bounds.y - 1, width: bounds.width + 2, height: bounds.height + 2 }
  })
  const columns = Math.max(planWidth - size.width, 1)
  for (let y = 1; y < 1_000; y += 1) {
    for (let x = 1; x <= columns; x += 1) {
      const box = { x, y, ...size }
      if (!taken.some((other) => overlaps(box, other))) return { x, y }
    }
  }
  return { x: 1, y: 1 }
}

/** «Стол 7» after «Стол 6»: the next number after the largest one in the labels. */
export function nextTableLabel(tables: readonly Pick<PlanTable, "label">[]) {
  const numbers = tables.map((table) => Number(/(\d+)\s*$/.exec(table.label)?.[1] ?? 0))
  return `Стол ${Math.max(0, ...numbers) + 1}`
}

// ── Colour by the reservations of the chosen day ──────────────────────────────

export type Occupancy = "free" | "draft" | "pending-approval" | "approved" | "completed"

type ReservationStatus = "draft" | "pending-approval" | "approved" | "completed" | "cancelled"

// The most binding booking of the day decides the colour: a confirmed one over one waiting for approval.
const PRIORITY: Record<Exclude<Occupancy, "free">, number> = { approved: 4, "pending-approval": 3, draft: 2, completed: 1 }

export function tableOccupancy(reservations: readonly { status: ReservationStatus }[]): Occupancy {
  let best: Occupancy = "free"
  for (const { status } of reservations) {
    if (status === "cancelled") continue
    if (best === "free" || PRIORITY[status] > PRIORITY[best]) best = status
  }
  return best
}

export const OCCUPANCY_LABELS: Record<Occupancy, string> = {
  free: "Свободен",
  draft: "Черновик брони",
  "pending-approval": "На согласовании",
  approved: "Забронирован",
  completed: "Бронь проведена",
}

/** SVG classes per occupancy — theme tokens only, so the plan follows the day and night themes. */
export const OCCUPANCY_CLASSES: Record<Occupancy, { shape: string; swatch: string }> = {
  free: { shape: "fill-card stroke-input", swatch: "border-input bg-card" },
  draft: { shape: "fill-muted stroke-muted-foreground", swatch: "border-muted-foreground bg-muted" },
  "pending-approval": { shape: "fill-warning/20 stroke-warning", swatch: "border-warning bg-warning/20" },
  approved: { shape: "fill-accent/20 stroke-accent", swatch: "border-accent bg-accent/20" },
  completed: { shape: "fill-success/15 stroke-success", swatch: "border-success bg-success/15" },
}
