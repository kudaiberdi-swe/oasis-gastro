import { useEffect, useId, useMemo, useState } from "react"
import { ArrowLeft, Hash, ShoppingBag, Users } from "lucide-react"

import { Button } from "@/shared/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog"
import { EmptyState } from "@/shared/components/ui/empty-state"
import { Input } from "@/shared/components/ui/input"
import { Money } from "@/shared/components/ui/money"
import { PinPad } from "@/shared/components/ui/pin-pad"
import { SegmentedControl } from "@/shared/components/ui/segmented-control"
import { Skeleton } from "@/shared/components/ui/skeleton"
import { TonePill } from "@/shared/components/ui/status-pill"
import { FilterTabs } from "@/shared/components/ui/tabs"
import { posErrorMessage, ruT, useT, type Translator } from "@/pos/i18n"
import { cn, focusRingClass } from "@/shared/lib/utils"

/** One open check of orders.floor. */
export type FloorCheck = {
  orderId: string
  number: number
  tableLabel?: string
  hallLabel?: string
  status: string
  total: number
  createdAt: number
  kitchenSentAt: number | null
  mine: boolean
  terminalName?: string
}

export type FloorTable = { tableId: string; label: string; capacity: number; checks: FloorCheck[] }

/** orders.floor: active tables by hall, the terminal's checks that sit at no table, and whether the lists were capped. */
export type FloorData = { halls: Array<{ name: string; tables: FloorTable[] }>; orphans: FloorCheck[]; tableCount: number; truncated: boolean }

export type FloorSeat = { tableLabel?: string; hallLabel?: string }

type SortKey = "label" | "age" | "total"

/** Search and sort only pay off in a big hall; below this the whole hall fits on screen. */
export const SEARCH_FROM_TABLES = 30

const SORT_KEYS = { label: "floor.sortNumber", age: "floor.sortTime", total: "floor.sortTotal" } as const satisfies Record<SortKey, string>

/**
 * The draft's own table in «move»: hall + label (the draft carries its hallLabel). A check saved without
 * a hall matches by label only, as orders.floor places it.
 */
export function isCurrentTable(current: FloorSeat | undefined, label: string, hall: string) {
  if (!current?.tableLabel?.trim() || current.tableLabel.trim() !== label) return false
  const currentHall = current.hallLabel?.trim()
  return !currentHall || currentHall === hall
}

/** «только что», «42 мин», «1 ч 05 мин» (kk «жаңа ғана», «1 сағ 05 мин») — how long a check has been open. */
export function checkAge(openedAt: number, now: number, t: Translator = ruT) {
  const minutes = Math.max(0, Math.floor((now - openedAt) / 60_000))
  if (minutes < 1) return t("floor.ageJustNow")
  if (minutes < 60) return t("floor.ageMinutes", { minutes })
  return t("floor.ageHours", { hours: Math.floor(minutes / 60), minutes: String(minutes % 60).padStart(2, "0") })
}

/** «Стол 7», or «Без стола» for takeaway and checks opened without a table. */
export function checkTitle(check: Pick<FloorCheck, "tableLabel">, t: Translator = ruT) {
  return check.tableLabel?.trim() || t("floor.noTable")
}

const byLabel = (a: string, b: string) => a.localeCompare(b, "ru", { numeric: true, sensitivity: "base" })

type PlacedTable = { table: FloorTable; hall: string }

function sortTables(rows: PlacedTable[], sort: SortKey) {
  const oldest = (table: FloorTable) => Math.min(...table.checks.map((check) => check.createdAt))
  const total = (table: FloorTable) => table.checks.filter((check) => check.mine).reduce((sum, check) => sum + check.total, 0)
  return [...rows].sort(({ table: a }, { table: b }) => {
    if (sort !== "label") {
      // Taken tables first — the oldest (or the largest) on top; free ones follow by number.
      const taken = Number(b.checks.length > 0) - Number(a.checks.length > 0)
      if (taken) return taken
      if (a.checks.length && b.checks.length) {
        const delta = sort === "age" ? oldest(a) - oldest(b) : total(b) - total(a)
        if (delta) return delta
      }
    }
    return byLabel(a.label, b.label)
  })
}

function useNow(fixed?: number) {
  const [now, setNow] = useState(() => fixed ?? Date.now())
  useEffect(() => {
    if (fixed !== undefined) return
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [fixed])
  return fixed ?? now
}

// Pressed feedback on touch: a 1px drop and a background shift, 150ms (the redesign brief).
const tileClass = cn(
  "relative flex min-h-28 flex-col items-start justify-between gap-2 overflow-hidden rounded-control border p-3 text-left transition-[background-color,transform] duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0",
  focusRingClass,
)
// The current check: 2px foreground frame and a gold strip on the left — never primary (POS-DESIGN §6.2).
const activeClass = "border-foreground ring-1 ring-inset ring-foreground pl-4 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-gold"

function CheckMark({ check }: { check: FloorCheck }) {
  const t = useT()
  if (check.status === "held") return <TonePill tone="warning">{t("status.order.held")}</TonePill>
  if (check.kitchenSentAt) return <TonePill tone="info">{t("floor.onKitchen")}</TonePill>
  return null
}

/**
 * «Зал» (POS-DESIGN §6.2 «Столы/чеки»): the restaurant's tables as tiles by hall. A free table opens a new
 * check at once, a taken one opens its check — no typing, so no on-screen keyboard on a touch terminal.
 * Without a floor plan it shows the open checks and a digit pad for the table number. «move» picks the
 * free table the current check moves to.
 */
export function FloorGrid({
  open,
  onOpenChange,
  mode = "open",
  floor,
  activeOrderId,
  currentTable,
  onOpenTable,
  onSelectCheck,
  onMove,
  now,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode?: "open" | "move"
  /** undefined while loading. */
  floor: FloorData | undefined
  activeOrderId: string | null
  /** The current check's table (for «move»). */
  currentTable?: FloorSeat
  /** A new check at this table; without a label — a check with no table (takeaway). */
  onOpenTable: (seat: FloorSeat) => void
  onSelectCheck: (orderId: string) => void
  onMove?: (seat: { tableLabel: string; hallLabel?: string }) => Promise<unknown>
  /** Fixed clock for tests. */
  now?: number
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[calc(100dvh-2rem)] max-w-[min(1280px,calc(100%-2rem))] flex-col gap-4"
        // Radix focuses the first field on open — the search box would pop the on-screen keyboard. Focus the dialog itself.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          const content = event.currentTarget as HTMLElement | null
          content?.focus()
        }}
      >
        {open && (
          <FloorBody
            mode={mode}
            floor={floor}
            activeOrderId={activeOrderId}
            currentTable={currentTable}
            onOpenTable={(seat) => {
              onOpenChange(false)
              onOpenTable(seat)
            }}
            onSelectCheck={(orderId) => {
              onOpenChange(false)
              if (orderId !== activeOrderId) onSelectCheck(orderId)
            }}
            onMove={onMove}
            onDone={() => onOpenChange(false)}
            fixedNow={now}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

type View = { kind: "grid" } | { kind: "chooser"; tableId: string } | { kind: "pad" }

function FloorBody({
  mode,
  floor,
  activeOrderId,
  currentTable,
  onOpenTable,
  onSelectCheck,
  onMove,
  onDone,
  fixedNow,
}: {
  mode: "open" | "move"
  floor: FloorData | undefined
  activeOrderId: string | null
  currentTable?: FloorSeat
  onOpenTable: (seat: FloorSeat) => void
  onSelectCheck: (orderId: string) => void
  onMove?: (seat: { tableLabel: string; hallLabel?: string }) => Promise<unknown>
  onDone: () => void
  fixedNow?: number
}) {
  const t = useT()
  const now = useNow(fixedNow)
  const panelId = useId()
  const [view, setView] = useState<View>({ kind: "grid" })
  const [hallChoice, setHallChoice] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<SortKey>("label")
  const [digits, setDigits] = useState("")
  const [moving, setMoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const halls = useMemo(() => floor?.halls ?? [], [floor])
  const allTables = useMemo<PlacedTable[]>(() => halls.flatMap((hall) => hall.tables.map((table) => ({ table, hall: hall.name }))), [halls])
  // Open on the hall of the current check (for «move» also the hall the draft sits in), else the first one.
  const activeHall = allTables.find(({ table }) => table.checks.some((check) => check.orderId === activeOrderId))?.hall ?? (mode === "move" ? allTables.find(({ table, hall }) => isCurrentTable(currentTable, table.label, hall))?.hall : undefined)
  const hall = halls.find((row) => row.name === hallChoice)?.name ?? activeHall ?? halls[0]?.name
  const searchable = (floor?.tableCount ?? 0) >= SEARCH_FROM_TABLES
  const needle = searchable ? search.trim().toLocaleLowerCase("ru") : ""
  const visible = needle ? allTables.filter(({ table }) => table.label.toLocaleLowerCase("ru").includes(needle)) : allTables.filter((row) => row.hall === hall)
  const sorted = sortTables(visible, sort)
  const orphans = mode === "open" ? (floor?.orphans ?? []).filter((check) => !needle || checkTitle(check, t).toLocaleLowerCase("ru").includes(needle)) : []
  const noPlan = floor !== undefined && floor.tableCount === 0
  const freeCount = allTables.filter(({ table }) => table.checks.length === 0).length

  async function moveTo(seat: { tableLabel: string; hallLabel?: string }) {
    if (!onMove || moving) return
    setMoving(true)
    setError(null)
    try {
      await onMove(seat)
      onDone()
    } catch (caught) {
      setError(posErrorMessage(t, caught, t("floor.moveFailed")))
    } finally {
      setMoving(false)
    }
  }

  function chooseTable(table: FloorTable, hallName: string) {
    const mine = table.checks.filter((check) => check.mine)
    if (mode === "move") {
      if (!table.checks.length) void moveTo({ tableLabel: table.label, hallLabel: hallName })
      return
    }
    if (!table.checks.length) onOpenTable({ tableLabel: table.label, hallLabel: hallName })
    else if (mine.length === 1) onSelectCheck(mine[0].orderId)
    else if (mine.length > 1) setView({ kind: "chooser", tableId: table.tableId })
  }

  /** The digit pad: a table of the plan by its number, else a check already open under that label, else a new one. */
  function submitDigits() {
    if (!digits) return
    // «Стол N» is how a table is named in the plan and on the check (data, not interface text).
    const candidates = [`Стол ${digits}`, digits]
    const planned = allTables.find(({ table }) => candidates.some((label) => byLabel(label, table.label) === 0))
    if (planned) {
      if (planned.table.checks.length && mode === "move") return setError(t("floor.tableTaken", { table: planned.table.label }))
      if (planned.table.checks.length && !planned.table.checks.some((check) => check.mine)) return setError(t("floor.tableElsewhere", { table: planned.table.label }))
      return chooseTable(planned.table, planned.hall)
    }
    const label = `Стол ${digits}`
    if (mode === "move") return void moveTo({ tableLabel: label })
    const existing = floor?.orphans.find((check) => candidates.some((candidate) => byLabel(candidate, checkTitle(check)) === 0))
    if (existing) onSelectCheck(existing.orderId)
    else onOpenTable({ tableLabel: label })
  }

  const title = mode === "move" ? t("actions.moveTable") : t("floor.title")
  const description =
    mode === "move"
      ? t("floor.moveDescription", { table: currentTable?.tableLabel?.trim() || t("floor.moveNoTable") })
      : noPlan
        ? t("floor.noPlan")
        : floor
          ? t("floor.freeOf", { free: freeCount, total: floor.tableCount })
          : t("floor.loadingEllipsis")

  if (view.kind === "pad") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{mode === "move" ? t("floor.padMoveTitle") : t("floor.padTitle")}</DialogTitle>
          <DialogDescription>{t("floor.padDescription")}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto">
          <PinPad
            value={digits}
            onValueChange={(value) => {
              setDigits(value)
              setError(null)
            }}
            maxLength={3}
            label={t("floor.tableNumber")}
            onSubmit={submitDigits}
            disabled={moving}
          />
          {error && (
            <p role="alert" className="text-body-sm font-semibold text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => {
              setView({ kind: "grid" })
              setDigits("")
              setError(null)
            }}
            disabled={moving}
          >
            <ArrowLeft /> {t("common.back")}
          </Button>
          <Button size="lg" onClick={submitDigits} disabled={!digits || moving}>
            {moving ? t("floor.moving") : mode === "move" ? t("floor.moveTo", { digits }).trim() : t("floor.openTable", { digits }).trim()}
          </Button>
        </DialogFooter>
      </>
    )
  }

  // The chooser follows the live floor: a check paid meanwhile drops out of it.
  const chosen = view.kind === "chooser" ? allTables.find(({ table }) => table.tableId === view.tableId)?.table : undefined
  if (chosen) {
    const checks = chosen.checks.filter((check) => check.mine)
    return (
      <>
        <DialogHeader>
          <DialogTitle>
            {chosen.label} · {t("floor.checks", { count: checks.length })}
          </DialogTitle>
          <DialogDescription>{t("floor.chooserDescription")}</DialogDescription>
        </DialogHeader>
        <ul aria-label={t("floor.chooserAria", { table: chosen.label })} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {checks.map((check) => (
            <li key={check.orderId}>
              <button
                type="button"
                aria-current={check.orderId === activeOrderId ? "true" : undefined}
                onClick={() => onSelectCheck(check.orderId)}
                className={cn(tileClass, "min-h-16 w-full flex-row items-center bg-card hover:bg-muted active:bg-muted", check.orderId === activeOrderId ? activeClass : "border-input")}
              >
                <span className="flex flex-wrap items-center gap-2 text-body">
                  <span className="font-semibold">№{check.number}</span>
                  <span className="text-muted-foreground">{checkAge(check.createdAt, now, t)}</span>
                  <CheckMark check={check} />
                </span>
                <Money value={check.total} size="lg" />
              </button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="secondary" size="lg" onClick={() => setView({ kind: "grid" })}>
            <ArrowLeft /> {t("floor.backToHall")}
          </Button>
        </DialogFooter>
      </>
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      {halls.length > 1 && !needle && (
        <FilterTabs
          aria-label={t("floor.halls")}
          panelId={panelId}
          value={hall ?? ""}
          onValueChange={setHallChoice}
          items={halls.map((row) => ({ value: row.name, label: row.name, count: row.tables.filter((table) => table.checks.length).length }))}
          className="shrink-0 overflow-x-auto [&>button]:h-12 [&>button]:shrink-0 [&>button]:text-body"
        />
      )}

      {searchable && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Input
            type="search"
            aria-label={t("floor.findTable")}
            placeholder={t("floor.findTable")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-[var(--control-h-pos)] max-w-72 flex-1 text-body"
          />
          <SegmentedControl aria-label={t("floor.tableOrder")} size="pos" value={sort} onValueChange={setSort} options={(Object.keys(SORT_KEYS) as SortKey[]).map((value) => ({ value, label: t(SORT_KEYS[value]) }))} />
        </div>
      )}

      {error && (
        <p role="alert" className="shrink-0 text-body-sm font-semibold text-destructive">
          {error}
        </p>
      )}

      <div id={panelId} role={halls.length > 1 && !needle ? "tabpanel" : undefined} aria-label={hall ? t("floor.tablesAria", { name: needle ? t("floor.search") : hall }) : undefined} className="-m-1.5 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-1.5">
        {floor === undefined ? (
          <div role="status" aria-label={t("floor.loading")} className="grid grid-cols-[repeat(auto-fill,minmax(144px,1fr))] gap-2">
            {Array.from({ length: 12 }, (_, index) => (
              <Skeleton key={index} className="h-28" />
            ))}
          </div>
        ) : (
          <>
            {!noPlan &&
              (sorted.length ? (
                <ul aria-label={t("floor.tables")} className="grid grid-cols-[repeat(auto-fill,minmax(144px,1fr))] gap-2">
                  {sorted.map(({ table, hall: hallName }) => (
                    <li key={table.tableId}>
                      <TableTile
                        table={table}
                        hall={hallName}
                        showHall={Boolean(needle) && halls.length > 1}
                        mode={mode}
                        activeOrderId={activeOrderId}
                        currentTable={currentTable}
                        now={now}
                        busy={moving}
                        onChoose={() => chooseTable(table, hallName)}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-6 text-center text-body text-muted-foreground">{needle ? t("floor.noMatch") : t("floor.noTables")}</p>
              ))}

            {orphans.length > 0 && (
              <section aria-label={noPlan ? t("floor.openChecks") : t("floor.outOfPlan")} className="flex flex-col gap-2">
                <h3 className="text-body font-semibold text-muted-foreground">
                  {noPlan ? t("floor.openChecks") : t("floor.outOfPlan")} · {orphans.length}
                </h3>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(144px,1fr))] gap-2">
                  {orphans.map((check) => (
                    <li key={check.orderId}>
                      <CheckTile check={check} active={check.orderId === activeOrderId} now={now} onChoose={() => onSelectCheck(check.orderId)} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {noPlan && orphans.length === 0 && <EmptyState title={t("floor.noOpenChecks")} description={t("floor.noOpenChecksHint")} />}
            {floor.truncated && <p className="text-body-sm text-muted-foreground">{t("floor.truncated")}</p>}
          </>
        )}
      </div>

      <DialogFooter className="shrink-0 sm:justify-start">
        {mode === "open" && (
          <Button variant="secondary" size="lg" onClick={() => onOpenTable({})}>
            <ShoppingBag /> {t("floor.noTable")}
          </Button>
        )}
        <Button
          variant="secondary"
          size="lg"
          onClick={() => {
            setError(null)
            setView({ kind: "pad" })
          }}
          disabled={moving}
        >
          <Hash /> {t("floor.padTitle")}
        </Button>
      </DialogFooter>
    </>
  )
}

function TableTile({
  table,
  hall,
  showHall,
  mode,
  activeOrderId,
  currentTable,
  now,
  busy,
  onChoose,
}: {
  table: FloorTable
  hall: string
  /** The hall name on the tile, when a search spans several halls. */
  showHall: boolean
  mode: "open" | "move"
  activeOrderId: string | null
  currentTable?: FloorSeat
  now: number
  busy: boolean
  onChoose: () => void
}) {
  const t = useT()
  const mine = table.checks.filter((check) => check.mine)
  const taken = table.checks.length > 0
  const active = table.checks.some((check) => check.orderId === activeOrderId) || (mode === "move" && isCurrentTable(currentTable, table.label, hall))
  const elsewhere = taken && mine.length === 0 ? (table.checks[0].terminalName ?? t("floor.otherTerminal")) : null
  const disabled = busy || (mode === "move" ? taken || active : Boolean(elsewhere))
  const oldest = taken ? Math.min(...table.checks.map((check) => check.createdAt)) : 0
  const total = mine.reduce((sum, check) => sum + check.total, 0)
  const places = t("floor.places", { count: table.capacity })
  const state = !taken ? t("floor.free") : elsewhere ? t("floor.takenAt", { terminal: elsewhere }) : mine.length > 1 ? t("floor.checks", { count: mine.length }) : t("floor.taken")
  // One mark per tile: a held check matters more than one already on the kitchen ticket.
  const marked = mine.find((check) => check.status === "held") ?? mine.find((check) => check.kitchenSentAt) ?? null

  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      aria-label={`${table.label}${showHall ? `, ${hall}` : ""}: ${state}${taken && !elsewhere ? `, ${checkAge(oldest, now, t)}` : ""}, ${places}`}
      disabled={disabled}
      onClick={onChoose}
      className={cn(
        tileClass,
        "w-full",
        !taken ? "border-dashed border-input bg-transparent hover:bg-muted active:bg-muted" : elsewhere ? "border-border bg-muted" : "border-input bg-card hover:bg-muted active:bg-muted",
        mode === "move" && taken && "opacity-60",
        active && activeClass,
      )}
    >
      <span className="flex w-full items-start justify-between gap-2">
        <span className="min-w-0 truncate font-display text-title font-semibold">{table.label}</span>
        {mine.length > 1 && <span className="shrink-0 text-body-sm font-semibold text-muted-foreground tabular-nums">{t("floor.checks", { count: mine.length })}</span>}
      </span>
      {showHall && <span className="-mt-2 text-body-sm text-muted-foreground">{hall}</span>}
      {!taken ? (
        <span className="flex items-center gap-1.5 text-body-sm text-muted-foreground">
          <Users aria-hidden className="size-4" /> {places}
        </span>
      ) : elsewhere ? (
        <span className="text-body-sm text-muted-foreground">
          {t("floor.takenShort", { terminal: elsewhere })}
        </span>
      ) : (
        <span className="flex w-full flex-col items-start gap-1">
          <Money value={total} size="lg" />
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-muted-foreground">
            <span className="tabular-nums">{checkAge(oldest, now, t)}</span>
            {marked && <CheckMark check={marked} />}
          </span>
        </span>
      )}
    </button>
  )
}

function CheckTile({ check, active, now, onChoose }: { check: FloorCheck; active: boolean; now: number; onChoose: () => void }) {
  const t = useT()
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      aria-label={t("floor.checkAria", { title: checkTitle(check, t), number: check.number, age: checkAge(check.createdAt, now, t) })}
      onClick={onChoose}
      className={cn(tileClass, "w-full border-input bg-card hover:bg-muted active:bg-muted", active && activeClass)}
    >
      <span className="w-full min-w-0 truncate font-display text-title font-semibold">{checkTitle(check, t)}</span>
      <span className="flex w-full flex-col items-start gap-1">
        <Money value={check.total} size="lg" />
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-muted-foreground">
          <span className="tabular-nums">
            №{check.number} · {checkAge(check.createdAt, now, t)}
          </span>
          <CheckMark check={check} />
        </span>
      </span>
    </button>
  )
}
