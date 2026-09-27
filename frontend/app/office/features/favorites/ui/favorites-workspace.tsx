import { GripVertical, Star } from "lucide-react"
import { useState, type DragEvent, type KeyboardEvent } from "react"
import { Link } from "react-router"

import { Button, EmptyState, Skeleton, useToast } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { cn, focusRingClass } from "@/shared/lib/utils"

import { useFavoriteActions, useOfficeFavorites, type OfficeFavorite } from "../data/use-office-favorites"
import { favoriteTile, moveId } from "../model/favorites"

// «Избранное» (W3-ADM-13, OFFICE-DESIGN §3.7, L-8): the user's own pinned sections, documents and favorite
// report views as tiles — not a copy of the start page. Pinned with the star in any page header; the
// order changes by dragging a tile or with the arrow keys on its handle, and is the order of «Быстрый доступ».

const MOVE_KEYS: Record<string, (index: number, last: number) => number> = {
  ArrowUp: (index) => index - 1,
  ArrowLeft: (index) => index - 1,
  ArrowDown: (index) => index + 1,
  ArrowRight: (index) => index + 1,
  Home: () => 0,
  End: (_index, last) => last,
}

export function FavoritesWorkspace() {
  const items = useOfficeFavorites()
  const { toggle, reorder } = useFavoriteActions()
  const toast = useToast()
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState("")

  const ids = items?.map((item) => item.id) ?? []

  function move(item: OfficeFavorite, toIndex: number) {
    const next = moveId(ids, item.id, toIndex)
    if (next === ids) return
    setAnnouncement(`«${favoriteTile(item).title}» — позиция ${next.indexOf(item.id) + 1} из ${next.length}`)
    reorder({ ids: next }).catch((caught) => toast(errorMessage(caught, "Не удалось изменить порядок"), "error"))
  }

  function onHandleKey(event: KeyboardEvent, item: OfficeFavorite, index: number) {
    const target = MOVE_KEYS[event.key]
    if (!target) return
    event.preventDefault()
    move(item, target(index, ids.length - 1))
  }

  async function remove(item: OfficeFavorite) {
    try {
      await toggle({ kind: item.kind, targetId: item.targetId, label: item.label })
      toast(`«${favoriteTile(item).title}» убрано из избранного`, "success")
    } catch (caught) {
      toast(errorMessage(caught, "Не удалось убрать из избранного"), "error")
    }
  }

  const dragProps = (item: OfficeFavorite, index: number) => ({
    draggable: true,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.effectAllowed = "move"
      event.dataTransfer.setData("text/plain", item.id)
      setDragging(item.id)
    },
    onDragOver: (event: DragEvent) => {
      if (!dragging) return
      event.preventDefault()
      event.dataTransfer.dropEffect = "move"
      setDropTarget(item.id)
    },
    onDragLeave: () => setDropTarget((current) => (current === item.id ? null : current)),
    onDrop: (event: DragEvent) => {
      event.preventDefault()
      const moved = items?.find((candidate) => candidate.id === dragging)
      if (moved) move(moved, index)
      setDragging(null)
      setDropTarget(null)
    },
    onDragEnd: () => {
      setDragging(null)
      setDropTarget(null)
    },
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      {items === undefined ? (
        <div role="status" aria-label="Загрузка избранного" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          size="lg"
          title="В избранном пока пусто"
          description="Закрепите раздел звёздочкой в шапке страницы — он появится здесь и в «Быстром доступе» стартовой страницы."
          action={
            <Button asChild variant="secondary">
              <Link to="/office/dashboard">Открыть стартовую страницу</Link>
            </Button>
          }
        />
      ) : (
        <>
          <p className="text-body-sm text-muted-foreground">Видно только вам. Порядок меняется перетаскиванием или стрелками на ручке плитки — так же плитки идут в «Быстром доступе».</p>
          <ol aria-label="Избранное" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {items.map((item, index) => {
              const tile = favoriteTile(item)
              const Icon = tile.icon
              return (
                <li
                  key={item.id}
                  {...dragProps(item, index)}
                  className={cn(
                    "group flex items-start gap-1 rounded-card border border-border bg-card transition-colors duration-150 hover:border-accent/40",
                    dragging === item.id && "opacity-50",
                    dropTarget === item.id && dragging !== item.id && "border-accent shadow-[inset_2px_0_0_var(--gold)]",
                  )}
                >
                  <button
                    type="button"
                    aria-label={`Переместить «${tile.title}»`}
                    aria-describedby="favorites-move-hint"
                    onKeyDown={(event) => onHandleKey(event, item, index)}
                    className={cn("m-1.5 grid size-9 shrink-0 cursor-grab place-items-center rounded-control text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing", focusRingClass)}
                  >
                    <GripVertical aria-hidden className="size-[18px]" />
                  </button>
                  <Link to={tile.href} draggable={false} className={cn("flex min-w-0 flex-1 items-start gap-3 rounded-card py-4 pr-1", focusRingClass)}>
                    <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-caption text-muted-foreground">{tile.caption}</span>
                      <span className="text-body-sm font-semibold text-foreground">{tile.title}</span>
                      {tile.description ? <span className="line-clamp-2 text-caption text-muted-foreground">{tile.description}</span> : null}
                    </span>
                  </Link>
                  <Button variant="ghost" size="icon-sm" className="m-1.5 text-gold" aria-label={`Убрать «${tile.title}» из избранного`} onClick={() => void remove(item)}>
                    <Star aria-hidden className="fill-current" />
                  </Button>
                </li>
              )
            })}
          </ol>
          <p id="favorites-move-hint" className="sr-only">
            Стрелки перемещают плитку, Home и End — в начало и в конец.
          </p>
          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </>
      )}
    </div>
  )
}
