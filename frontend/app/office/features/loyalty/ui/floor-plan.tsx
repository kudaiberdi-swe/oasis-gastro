import { ChevronLeft, ChevronRight, Pencil, Plus } from "lucide-react"
import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"

import { Banner, Button, ConfirmDialog, EmptyState, Field, Input, SegmentedControl, Select, Skeleton, StatusPill, Switch, useToast } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatQuantity } from "@/shared/lib/format"
import { cn, focusRingClass } from "@/shared/lib/utils"
import { plural } from "@/office/features/dashboard/model/dashboard"

import { useFloorPlan, useReservationMutations, type FloorTable, type TableBooking } from "../data/use-reservations"
import {
  clientToGrid,
  freeSpot,
  hitResizeHandle,
  hitTest,
  moveTable,
  nextTableLabel,
  nudgeTable,
  OCCUPANCY_CLASSES,
  OCCUPANCY_LABELS,
  planViewBox,
  resizeTable,
  tableCenter,
  tableOccupancy,
  type Occupancy,
  type PlanTable,
  type Point,
  type TableShape,
} from "../model/floor-plan"
import { almatyToday, formatTimeRange, RECORD_TYPE_LABELS, shiftDate, type ReservationPrefill } from "../model/reservations"

// The floor plan above the register (W2-LOY-07, L-24): tables of a hall on a grid, coloured by the
// bookings of the chosen day; «Редактировать схему» moves, resizes and adds tables and saves them
// through saveTables in one transaction. Geometry (hit test, snapping, pointer → grid) lives in model/floor-plan.ts.

const DEFAULT_HALL = "Основной зал"
const NEW_HALL = "__new-hall__"
const ROTATIONS = [0, 45, 90, 135, 180, 225, 270, 315]

/** A table as the plan draws it: the server row or its unsaved edit; `key` is the externalId or a temporary id. */
export type PlanItem = PlanTable & { key: string; hall: string; reservations: TableBooking[] }

const seats = (count: number) => `${formatQuantity(count)} ${plural(count, ["место", "места", "мест"])}`
const guests = (count: number) => `${formatQuantity(count)} ${plural(count, ["гость", "гостя", "гостей"])}`

function toItem(table: FloorTable): PlanItem {
  return { key: table.externalId, externalId: table.externalId, hall: table.hall, label: table.label, capacity: table.capacity, shape: table.shape, x: table.x, y: table.y, width: table.width, height: table.height, rotation: table.rotation, active: table.active, reservations: table.reservations }
}

const sameGeometry = (a: PlanItem, b: PlanItem) =>
  a.label === b.label && a.capacity === b.capacity && a.shape === b.shape && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.rotation === b.rotation && a.active === b.active && a.hall === b.hall

export interface FloorPlanSectionProps {
  restaurantExternalId: string | undefined
  canEdit: boolean
  editing: boolean
  onEditingChange: (editing: boolean) => void
  /** «Сохранить схему» is the one primary only while no card is open. */
  primaryAllowed: boolean
  onOpenReservation: (externalId: string) => void
  /** «Новая бронь за этим столом»; absent without the edit right. */
  onCreate?: (prefill: ReservationPrefill) => void
}

export function FloorPlanSection({ restaurantExternalId, canEdit, editing, onEditingChange, primaryAllowed, onOpenReservation, onCreate }: FloorPlanSectionProps) {
  const [date, setDate] = useState(() => almatyToday())
  const plan = useFloorPlan(restaurantExternalId, date)
  const { saveTables } = useReservationMutations()
  const toast = useToast()
  const [hallChoice, setHallChoice] = useState<string | null>(null)
  const [extraHalls, setExtraHalls] = useState<string[]>([])
  const [naming, setNaming] = useState(false)
  const [hallName, setHallName] = useState("")
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, PlanItem>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const serverItems = useMemo(() => (plan?.tables ?? []).map(toItem), [plan])
  const halls = useMemo(() => {
    const names = [...(plan?.halls ?? []), ...extraHalls, ...Object.values(drafts).map((draft) => draft.hall)]
    return [...new Set(names)].sort((a, b) => a.localeCompare(b, "ru"))
  }, [plan, extraHalls, drafts])
  const hall = hallChoice && halls.includes(hallChoice) ? hallChoice : (halls[0] ?? DEFAULT_HALL)

  // Server rows with their unsaved edits on top, plus tables added in this session.
  const items = useMemo(() => {
    const merged = serverItems.map((item) => (drafts[item.key] ? { ...drafts[item.key], reservations: item.reservations } : item))
    const added = Object.values(drafts).filter((draft) => !draft.externalId)
    return [...merged, ...added]
  }, [serverItems, drafts])
  const visible = items.filter((item) => item.hall === hall && (editing || item.active))
  const selected = visible.find((item) => item.key === selectedKey) ?? null
  const dirtyKeys = Object.keys(drafts)
  const dirty = dirtyKeys.length > 0

  const change = (next: PlanItem) => {
    const original = serverItems.find((item) => item.key === next.key)
    setDrafts((current) => {
      const copy = { ...current }
      if (original && sameGeometry(original, next)) delete copy[next.key]
      else copy[next.key] = next
      return copy
    })
  }

  const addTable = () => {
    const size = { width: 2, height: 2 }
    const spot = freeSpot(visible, size)
    const key = `new-${crypto.randomUUID()}`
    const table: PlanItem = { key, hall, label: nextTableLabel(items.filter((item) => item.hall === hall)), capacity: 4, shape: "rect", ...spot, ...size, rotation: 0, active: true, reservations: [] }
    setDrafts((current) => ({ ...current, [key]: table }))
    setSelectedKey(key)
  }

  const finishEditing = () => {
    setDrafts({})
    setExtraHalls([])
    setError(null)
    setNaming(false)
    onEditingChange(false)
  }

  async function saveAll() {
    if (!restaurantExternalId || saving) return
    const pending = Object.values(drafts)
    const invalid = pending.find((table) => !table.label.trim() || !(Number.isInteger(table.capacity) && table.capacity >= 1 && table.capacity <= 200))
    if (invalid) {
      setSelectedKey(invalid.key)
      setError(`Проверьте стол «${invalid.label || "без названия"}»: название и вместимость от 1 до 200`)
      return
    }
    if (pending.length > 100) {
      setError(`Изменено столов: ${pending.length}. За один раз сохраняется не больше 100 — отмените часть изменений`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      // One transaction: every changed table is saved, or none (a clash leaves all edits on screen).
      await saveTables({
        restaurantExternalId,
        tables: pending.map((table) => ({
          ...(table.externalId ? { externalId: table.externalId } : {}),
          hall: table.hall,
          label: table.label.trim(),
          capacity: table.capacity,
          shape: table.shape,
          x: table.x,
          y: table.y,
          width: table.width,
          height: table.height,
          rotation: table.rotation,
          active: table.active,
        })),
      })
      toast("Схема зала сохранена", "success")
      setSelectedKey(null)
      finishEditing()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить схему"))
    } finally {
      setSaving(false)
    }
  }

  const addHall = () => {
    const name = hallName.trim()
    if (!name) return
    setExtraHalls((current) => [...current, name])
    setHallChoice(name)
    setHallName("")
    setNaming(false)
    setSelectedKey(null)
  }

  // A restaurant without tables starts with «Основной зал».
  const hallOptions = [...(halls.length ? halls : [DEFAULT_HALL]).map((name) => ({ value: name, label: name })), ...(editing ? [{ value: NEW_HALL, label: "Новый зал…" }] : [])]

  return (
    <section aria-label="Схема зала" className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-panel">
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="mr-auto font-display text-title font-semibold">Схема зала</h2>
        <div className="flex items-end gap-1">
          <Button variant="ghost" size="icon" aria-label="Предыдущий день" onClick={() => setDate((current) => shiftDate(current, -1))}>
            <ChevronLeft aria-hidden />
          </Button>
          <label className="flex flex-col gap-1">
            <span className="sr-only">Дата схемы</span>
            <Input type="date" aria-label="Дата схемы" className="w-44" value={date} onChange={(event) => event.target.value && setDate(event.target.value)} />
          </label>
          <Button variant="ghost" size="icon" aria-label="Следующий день" onClick={() => setDate((current) => shiftDate(current, 1))}>
            <ChevronRight aria-hidden />
          </Button>
        </div>
        {hallOptions.length > 1 || editing ? (
          <Select
            aria-label="Зал"
            className="w-full sm:w-56"
            value={hall}
            onValueChange={(value) => {
              if (value === NEW_HALL) setNaming(true)
              else {
                setHallChoice(value)
                setSelectedKey(null)
              }
            }}
            options={hallOptions}
          />
        ) : halls.length === 1 ? (
          <span className="flex h-[var(--control-h)] items-center text-body-sm text-muted-foreground">{hall}</span>
        ) : null}
        {canEdit && restaurantExternalId ? (
          editing ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={addTable} disabled={saving}>
                <Plus aria-hidden />
                Добавить стол
              </Button>
              <Button variant="ghost" onClick={() => (dirty ? setConfirmDiscard(true) : finishEditing())} disabled={saving}>
                Отменить
              </Button>
              <Button variant={primaryAllowed ? "primary" : "secondary"} onClick={() => void saveAll()} disabled={saving || !dirty}>
                {saving ? "Сохранение…" : "Сохранить схему"}
              </Button>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => onEditingChange(true)}>
              <Pencil aria-hidden />
              Редактировать схему
            </Button>
          )
        ) : null}
      </div>

      {naming ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            addHall()
          }}
        >
          <Field label="Название нового зала" className="w-full sm:w-72">
            {(control) => <Input {...control} value={hallName} onChange={(event) => setHallName(event.target.value)} autoFocus />}
          </Field>
          <Button type="submit" variant="secondary" disabled={!hallName.trim()}>
            Добавить зал
          </Button>
          <Button variant="ghost" onClick={() => setNaming(false)}>
            Отмена
          </Button>
        </form>
      ) : null}

      {error ? (
        <Banner tone="danger" title="Схема не сохранена">
          {error}
        </Banner>
      ) : null}
      {editing ? <p className="text-caption text-muted-foreground">Перетащите стол, чтобы переместить; уголок справа снизу меняет размер. Стрелки на клавиатуре сдвигают выбранный стол на клетку.</p> : <Legend />}

      {!restaurantExternalId ? (
        <EmptyState title="Нет ресторана" description="Схема зала строится по ресторану — у вашей роли нет доступных ресторанов." />
      ) : plan === undefined ? (
        <Skeleton className="h-72 w-full" />
      ) : !visible.length && !editing ? (
        <EmptyState
          title="Столов пока нет"
          description={canEdit ? "Нажмите «Редактировать схему», чтобы расставить столы зала." : "Столы зала расставляет администратор в режиме «Редактировать схему»."}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <FloorPlanCanvas hall={hall} tables={visible} selectedKey={selected?.key ?? null} editing={editing} onSelect={setSelectedKey} onChange={change} />
          <aside aria-label="Выбранный стол" className="flex flex-col gap-3 rounded-card border border-border p-3">
            {selected ? (
              editing ? (
                <TableProperties table={selected} onChange={change} />
              ) : (
                <TableBookings table={selected} date={date} onOpenReservation={onOpenReservation} onCreate={onCreate ? () => onCreate({ date, hall, tableExternalIds: selected.externalId ? [selected.externalId] : [] }) : undefined} />
              )
            ) : (
              <p className="text-body-sm text-muted-foreground">{editing ? "Выберите стол на схеме или добавьте новый." : "Выберите стол на схеме — появятся его брони на этот день."}</p>
            )}
          </aside>
        </div>
      )}

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Отменить изменения схемы?"
        description={`Несохранённых столов: ${dirtyKeys.length}. Они вернутся к сохранённому виду.`}
        confirmLabel="Отменить изменения"
        cancelLabel="Продолжить редактирование"
        onConfirm={() => {
          setConfirmDiscard(false)
          setSelectedKey(null)
          finishEditing()
        }}
      />
    </section>
  )
}

function Legend() {
  const order: Occupancy[] = ["free", "draft", "pending-approval", "approved", "completed"]
  return (
    <ul aria-label="Обозначения" className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground">
      {order.map((occupancy) => (
        <li key={occupancy} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn("size-3 rounded-control border", OCCUPANCY_CLASSES[occupancy].swatch)} />
          {OCCUPANCY_LABELS[occupancy]}
        </li>
      ))}
    </ul>
  )
}

type Drag = { kind: "move" | "resize"; key: string; table: PlanItem; origin: Point; pointer: Point; pointerId: number }

export interface FloorPlanCanvasProps {
  hall: string
  tables: PlanItem[]
  selectedKey: string | null
  editing: boolean
  onSelect: (key: string | null) => void
  onChange: (table: PlanItem) => void
}

/** The SVG: a grid in table units, tables as rectangles and circles, drag and resize in the editing mode. */
export function FloorPlanCanvas({ hall, tables, selectedKey, editing, onSelect, onChange }: FloorPlanCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag | null>(null)
  const patternId = `plan-grid-${useId().replace(/[^a-zA-Z0-9]/g, "")}`
  // While dragging the drawn area only grows, so the scale does not change under the pointer.
  const fitted = planViewBox(tables)
  const grown = useRef(fitted)
  const viewBox = drag.current ? { ...fitted, width: Math.max(fitted.width, grown.current.width), height: Math.max(fitted.height, grown.current.height) } : fitted
  grown.current = viewBox

  const pointOf = (event: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    return clientToGrid({ x: event.clientX, y: event.clientY }, rect, viewBox)
  }

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!editing || event.button !== 0) return
    const point = pointOf(event)
    if (!point) return
    const current = tables.find((table) => table.key === selectedKey)
    const resizing = current && hitResizeHandle(current, point) ? current : null
    const target = resizing ?? hitTest(tables, point)
    if (!target) {
      onSelect(null)
      return
    }
    event.preventDefault()
    onSelect(target.key)
    drag.current = { kind: resizing ? "resize" : "move", key: target.key, table: target, origin: { x: target.x, y: target.y }, pointer: point, pointerId: event.pointerId }
    svgRef.current?.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    const point = pointOf(event)
    if (!point) return
    const next = state.kind === "move" ? moveTable(state.table, { origin: state.origin, pointer: state.pointer }, point) : resizeTable(state.table, point)
    const shown = tables.find((table) => table.key === state.key)
    if (shown && (next.x !== shown.x || next.y !== shown.y || next.width !== shown.width || next.height !== shown.height)) onChange(next)
  }

  const endDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    svgRef.current?.releasePointerCapture?.(event.pointerId)
  }

  const onTableKey = (table: PlanItem) => (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      onSelect(table.key)
      return
    }
    if (!editing) return
    const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    onSelect(table.key)
    onChange(nudgeTable(table, move[0], move[1]))
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-card border border-border bg-background">
      <svg
        ref={svgRef}
        role="group"
        aria-label={`Схема зала «${hall}»`}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        preserveAspectRatio="xMinYMin meet"
        className={cn("block h-auto max-h-[520px] w-full select-none", editing && "touch-none")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <defs>
          <pattern id={patternId} width={1} height={1} patternUnits="userSpaceOnUse">
            <path d="M 1 0 L 0 0 0 1" className="fill-none stroke-border" strokeWidth={0.03} />
          </pattern>
        </defs>
        <rect x={0} y={0} width={viewBox.width} height={viewBox.height} fill={`url(#${patternId})`} />
        {tables.map((table) => (
          <TableShapeView key={table.key} table={table} selected={table.key === selectedKey} editing={editing} onClick={() => onSelect(table.key)} onKeyDown={onTableKey(table)} />
        ))}
      </svg>
    </div>
  )
}

function TableShapeView({ table, selected, editing, onClick, onKeyDown }: { table: PlanItem; selected: boolean; editing: boolean; onClick: () => void; onKeyDown: (event: KeyboardEvent<SVGGElement>) => void }) {
  const occupancy = tableOccupancy(table.reservations)
  const center = tableCenter(table)
  const classes = OCCUPANCY_CLASSES[occupancy]
  const outline = (className: string, grow: number, strokeWidth: number) =>
    table.shape === "circle" ? (
      <ellipse cx={center.x} cy={center.y} rx={table.width / 2 + grow} ry={table.height / 2 + grow} strokeWidth={strokeWidth} strokeDasharray={table.active ? undefined : "0.2 0.15"} className={className} />
    ) : (
      <rect x={table.x - grow} y={table.y - grow} width={table.width + grow * 2} height={table.height + grow * 2} rx={0.25 + grow} strokeWidth={strokeWidth} strokeDasharray={table.active ? undefined : "0.2 0.15"} className={className} />
    )
  const small = Math.min(table.width, table.height) < 1.6
  return (
    <g
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${table.label}, ${seats(table.capacity)}, ${table.active ? OCCUPANCY_LABELS[occupancy].toLocaleLowerCase("ru") : "отключён"}`}
      transform={table.rotation ? `rotate(${table.rotation} ${center.x} ${center.y})` : undefined}
      className={cn("group cursor-pointer outline-none focus-visible:outline-none", editing && "cursor-move", !table.active && "opacity-60")}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {outline("fill-none stroke-ring opacity-0 group-focus-visible:opacity-100", 0.28, 0.08)}
      {outline(classes.shape, 0, 0.08)}
      {selected ? outline("fill-none stroke-gold", 0.14, 0.1) : null}
      <text x={center.x} y={center.y - (small ? 0 : 0.12)} textAnchor="middle" dominantBaseline="middle" fontSize={small ? 0.4 : 0.5} fontWeight={600} className="pointer-events-none fill-foreground">
        {table.label}
      </text>
      {small ? null : (
        <text x={center.x} y={center.y + 0.45} textAnchor="middle" dominantBaseline="middle" fontSize={0.36} className="pointer-events-none fill-muted-foreground">
          {seats(table.capacity)}
        </text>
      )}
      {editing && selected ? <rect aria-hidden x={table.x + table.width - 0.4} y={table.y + table.height - 0.4} width={0.8} height={0.8} rx={0.1} className="cursor-nwse-resize fill-gold stroke-card" strokeWidth={0.06} /> : null}
    </g>
  )
}

function TableBookings({ table, date, onOpenReservation, onCreate }: { table: PlanItem; date: string; onOpenReservation: (externalId: string) => void; onCreate?: () => void }) {
  const day = date.split("-").reverse().join(".")
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <h3 className="text-body font-semibold">{table.label}</h3>
        <p className="text-caption text-muted-foreground">
          {seats(table.capacity)} · брони на {day}
        </p>
      </div>
      {table.reservations.length ? (
        <ul aria-label={`Брони стола ${table.label}`} className="flex flex-col divide-y divide-border rounded-card border border-border">
          {table.reservations.map((booking) => (
            <li key={booking.externalId}>
              <button type="button" className={cn("flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-muted", focusRingClass)} onClick={() => onOpenReservation(booking.externalId)}>
                <span className="flex items-center justify-between gap-2">
                  <span className="text-body-sm font-semibold">{booking.number}</span>
                  <StatusPill domain="document" status={booking.status} />
                </span>
                <span className="text-caption text-muted-foreground tabular-nums">
                  {formatTimeRange(booking.start, booking.end)} · {RECORD_TYPE_LABELS[booking.recordType]} · {guests(booking.guestCount)}
                </span>
                <span className="truncate text-body-sm">{booking.guestName}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-sm text-muted-foreground">На этот день броней нет</p>
      )}
      {onCreate && table.externalId && table.active ? (
        <Button variant="secondary" onClick={onCreate}>
          <Plus aria-hidden />
          Новая бронь за этим столом
        </Button>
      ) : null}
    </>
  )
}

function TableProperties({ table, onChange }: { table: PlanItem; onChange: (table: PlanItem) => void }) {
  const set = (patch: Partial<PlanItem>) => onChange({ ...table, ...patch })
  const number = (value: string, fallback: number) => {
    const parsed = Number(value.replace(",", "."))
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return (
    <div className="flex flex-col gap-3" role="group" aria-label={`Свойства стола ${table.label}`}>
      <Field label="Название стола">{(control) => <Input {...control} value={table.label} onChange={(event) => set({ label: event.target.value })} />}</Field>
      <Field label="Вместимость, мест">
        {(control) => <Input {...control} type="number" inputMode="numeric" min={1} max={200} value={table.capacity} onChange={(event) => set({ capacity: Math.round(number(event.target.value, table.capacity)) })} />}
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-body-sm font-medium text-muted-foreground">Форма</span>
        <SegmentedControl<TableShape>
          aria-label="Форма стола"
          value={table.shape}
          onValueChange={(shape) => set({ shape })}
          options={[
            { value: "rect", label: "Прямоугольник" },
            { value: "circle", label: "Круг" },
          ]}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ширина, клеток">
          {(control) => <Input {...control} type="number" inputMode="numeric" min={1} step={1} value={table.width} onChange={(event) => set({ width: Math.max(1, Math.round(number(event.target.value, table.width))) })} />}
        </Field>
        <Field label="Высота, клеток">
          {(control) => <Input {...control} type="number" inputMode="numeric" min={1} step={1} value={table.height} onChange={(event) => set({ height: Math.max(1, Math.round(number(event.target.value, table.height))) })} />}
        </Field>
      </div>
      <Field label="Поворот">
        {(control) => <Select {...control} value={String(table.rotation)} onValueChange={(value) => set({ rotation: Number(value) })} options={ROTATIONS.map((degrees) => ({ value: String(degrees), label: `${degrees}°` }))} />}
      </Field>
      <label className="flex items-center justify-between gap-3 text-body-sm">
        <span className="flex flex-col">
          <span className="font-medium">Стол активен</span>
          <span className="text-caption text-muted-foreground">Отключённый стол не бронируется и скрыт со схемы</span>
        </span>
        <Switch checked={table.active} onCheckedChange={(active) => set({ active })} aria-label="Стол активен" />
      </label>
    </div>
  )
}
