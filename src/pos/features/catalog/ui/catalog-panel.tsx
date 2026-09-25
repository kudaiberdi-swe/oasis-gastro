import { useMemo, useState, type ReactNode } from "react"
import { ArrowLeft, Clock3, House, Search, Star } from "lucide-react"

import { useCategories, useFavoriteIds, useFavoriteProducts, useProducts, useRecentProducts, useToggleFavorite } from "@/pos/features/catalog/data/use-catalog"
import {
  ALL_VIEW,
  emptyCopy,
  goBack,
  openView,
  POPULAR_VIEW,
  SORT_OPTIONS,
  sortProducts,
  type CatalogNavigation,
  type CatalogProduct,
  type CatalogSort,
  type CatalogView,
} from "@/pos/features/catalog/model/catalog-view"
import { needsConfiguration } from "@/pos/features/catalog/model/modifier-selection"
import { ModifierDialog, type ConfigurableProduct } from "@/pos/features/catalog/ui/modifier-dialog"
import type { CatalogItem } from "@/pos/features/order-taking/model/draft-lines"
import { ProductCard } from "@/pos/components/product-card"
import { Button } from "@/shared/components/ui/button"
import { Chip, type CategoryTone } from "@/shared/components/ui/chip"
import { EmptyState } from "@/shared/components/ui/empty-state"
import { Input } from "@/shared/components/ui/input"
import { Select } from "@/shared/components/ui/select"
import { Skeleton } from "@/shared/components/ui/skeleton"
import { useToast } from "@/shared/components/ui/toast"
import { errorMessage } from "@/shared/lib/error-message"

// Category strip colour (POS-DESIGN §2.3). Categories carry no tone field yet, so it is read from the
// bilingual label; categories that match nothing (sauces, garnishes, «Прочее») get no strip.
// --cat-turkistan is reserved for dishes marked Туркестан and is never assigned to a category.
const CATEGORY_TONES: Array<[RegExp, CategoryTone]> = [
  [/салат/i, "green"],
  [/выпечк|нан-тоқаш|баурсак/i, "bread"],
  [/десерт|тәтті|чай/i, "tea"],
  [/напит|сусын|фреш|лимонад/i, "dairy"],
  [/основн|втор|деликатес|суп|компанию/i, "meat"],
]

export function categoryTone(label: string): CategoryTone | undefined {
  return CATEGORY_TONES.find(([pattern]) => pattern.test(label))?.[1]
}

// «Популярное» has no server filter yet: it is the popular flag over a larger first page.
const POPULAR_PAGE = 100

// Toolbar icon buttons: 44px ghost on --card; the pressed one gets the --nav fill like an active chip.
const toolbarButton = "text-foreground aria-pressed:bg-nav aria-pressed:text-nav-foreground aria-pressed:hover:bg-nav"

/**
 * POS catalog (W1-POS-11, POS-DESIGN §6.2/§11.2): toolbar ← ⌂ ☆ 🕘 + search + counter, category
 * chips that scroll only inside their own strip (L-2), sort, cards, «Показать ещё», empty states.
 */
export function CatalogPanel({
  sessionToken,
  onAddProduct,
  recentStorageKey,
  footerAction,
  menuLabel = "Sandyq",
}: {
  sessionToken: string
  onAddProduct: (item: CatalogItem) => void
  /** localStorage key of «Последние» (per employee); omitted — kept for this screen only. */
  recentStorageKey?: string
  /** Extra control on the right of the footer (the kitchen screen button). */
  footerAction?: ReactNode
  menuLabel?: string
}) {
  const toast = useToast()
  const categories = useCategories(sessionToken)
  // A dish with sizes or modifier groups opens the dialog (W1-POS-12); any other is added at once.
  const [configuring, setConfiguring] = useState<CatalogProduct | null>(null)
  const [navigation, setNavigation] = useState<CatalogNavigation>({ current: ALL_VIEW, back: [] })
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<CatalogSort>("name")
  const view = navigation.current
  const searching = search.trim().length > 0
  const listKind = searching ? "list" : view.kind === "all" || view.kind === "category" ? "list" : view.kind

  const listed = useProducts({ sessionToken, category: !searching && view.kind === "category" ? view.categoryExternalId : undefined, search: searching ? search.trim() : undefined, enabled: listKind === "list" })
  const popular = useProducts({ sessionToken, enabled: listKind === "popular", pageSize: POPULAR_PAGE })
  const favorites = useFavoriteProducts(sessionToken, listKind === "favorites")
  const favoriteIds = useFavoriteIds(sessionToken)
  const toggleFavorite = useToggleFavorite()
  const recent = useRecentProducts(recentStorageKey)

  const favoriteSet = useMemo(() => new Set(favoriteIds ?? []), [favoriteIds])
  const toneByCategory = useMemo(() => new Map(categories.map((category) => [category.externalId, categoryTone(category.label)] as const)), [categories])

  const source: { items: CatalogProduct[]; loading: boolean; canLoadMore: boolean; loadMore: () => void } =
    listKind === "popular"
      ? { ...popular, items: popular.items.filter((product) => product.popular) }
      : listKind === "favorites"
        ? favorites
        : listKind === "recent"
          ? { items: recent.items, loading: false, canLoadMore: false, loadMore: () => {} }
          : listed
  // «Последние» keeps its own order (newest first) unless the cashier picks another sort.
  const items = listKind === "recent" && sort === "name" ? source.items : sortProducts(source.items, sort)

  function go(next: CatalogView) {
    setSearch("")
    setNavigation((state) => openView(state, next))
  }

  function chooseChip(next: CatalogView, element: HTMLElement) {
    go(next)
    // L-2: bring the chip into view inside the strip only; the panel itself is overflow-x: clip.
    element.scrollIntoView({ inline: "nearest", block: "nearest" })
  }

  function add(product: CatalogProduct) {
    if (product.available === false) return
    if (needsConfiguration(product)) return setConfiguring(product)
    recent.remember(product)
    onAddProduct({ productId: product._id, name: product.name, nameKk: product.nameKk, price: product.price })
  }

  const configurable: ConfigurableProduct | null = configuring
    ? { productId: configuring._id, externalId: configuring.externalId, name: configuring.name, nameKk: configuring.nameKk, price: configuring.price, description: configuring.description, imageUrl: configuring.imageUrl ?? configuring.imagePath }
    : null

  async function star(product: CatalogProduct) {
    try {
      await toggleFavorite({ sessionToken, productExternalId: product.externalId })
    } catch (caught) {
      toast(errorMessage(caught, "Не удалось изменить избранное"), "error")
    }
  }

  const empty = emptyCopy(view, searching ? search : "")
  const activeCategory = !searching && view.kind === "category" ? view.categoryExternalId : undefined

  return (
    <section aria-label="Меню" className="flex h-full min-w-0 flex-1 flex-col overflow-x-clip rounded-panel border border-border bg-card">
      <div className="flex items-center gap-1 border-b border-border px-2 py-2">
        <Button variant="ghost" size="icon" aria-label="Назад" className={toolbarButton} disabled={!navigation.back.length} onClick={() => setNavigation(goBack)}>
          <ArrowLeft />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Все блюда" aria-pressed={!searching && view.kind === "all"} className={toolbarButton} onClick={() => go(ALL_VIEW)}>
          <House />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Избранное" aria-pressed={!searching && view.kind === "favorites"} className={toolbarButton} onClick={() => go({ kind: "favorites" })}>
          <Star />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Последние" aria-pressed={!searching && view.kind === "recent"} className={toolbarButton} onClick={() => go({ kind: "recent" })}>
          <Clock3 />
        </Button>
        <div className="relative ml-1 min-w-0 flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск блюда или напитка"
            aria-label="Поиск блюда или напитка"
            className="h-[var(--control-h-pos)] pl-10 text-body"
          />
        </div>
        <p className="shrink-0 pl-2 text-right text-body-sm leading-tight text-muted-foreground" aria-live="polite">
          В каталоге
          <br />
          <span className="font-semibold text-foreground tabular-nums">{source.loading ? "…" : items.length}</span> загружено
        </p>
      </div>

      <div className="flex items-center gap-2 border-b border-border px-2 py-2">
        <div role="group" aria-label="Категории" className="no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto overscroll-x-contain">
          <Chip size="lg" active={!searching && view.kind === "popular"} onClick={(event) => chooseChip(POPULAR_VIEW, event.currentTarget)}>
            Популярное
          </Chip>
          {categories.map((category) => (
            <Chip
              key={category.externalId}
              size="lg"
              tone={categoryTone(category.label)}
              active={activeCategory === category.externalId}
              onClick={(event) => chooseChip({ kind: "category", categoryExternalId: category.externalId }, event.currentTarget)}
            >
              {category.shortLabel}
            </Chip>
          ))}
        </div>
        <Select aria-label="Сортировка" className="w-44 shrink-0" value={sort} onValueChange={(value) => setSort(value as CatalogSort)} options={SORT_OPTIONS} />
      </div>

      <div className="min-h-0 flex-1 overflow-x-clip overflow-y-auto p-2">
        {source.loading ? (
          <div role="status" aria-label="Загрузка меню" className="grid grid-cols-3 gap-2.5 min-[1280px]:grid-cols-4 min-[1920px]:grid-cols-5">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="aspect-[4/5] w-full rounded-card" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title={empty.title}
            description={empty.description}
            action={
              listKind === "popular" ? (
                <Button variant="secondary" onClick={() => go(ALL_VIEW)}>
                  Показать всё меню
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => go(POPULAR_VIEW)}>
                  Показать популярное
                </Button>
              )
            }
          />
        ) : (
          <div className="grid grid-cols-3 gap-2.5 min-[1280px]:grid-cols-4 min-[1920px]:grid-cols-5">
            {items.map((product) => (
              <ProductCard
                key={product._id}
                name={product.name}
                nameKk={product.nameKk}
                price={product.price}
                tone={toneByCategory.get(product.category)}
                imageUrl={product.imageUrl ?? product.imagePath}
                badge={product.badge}
                available={product.available !== false}
                favorite={favoriteSet.has(product.externalId)}
                onToggleFavorite={favoriteIds ? () => void star(product) : undefined}
                onClick={() => add(product)}
              />
            ))}
          </div>
        )}
        {source.canLoadMore && !source.loading && (
          <div className="py-4 text-center">
            <Button variant="secondary" onClick={source.loadMore}>
              Показать ещё
            </Button>
          </div>
        )}
      </div>

      <footer className="flex min-h-12 items-center justify-between gap-3 border-t border-border px-3 py-0.5 text-body-sm text-muted-foreground">
        <span className="truncate">Нажмите на карточку, чтобы добавить позицию</span>
        <span className="flex shrink-0 items-center gap-3">
          {footerAction}
          <span>Меню: {menuLabel}</span>
        </span>
      </footer>
      <ModifierDialog
        sessionToken={sessionToken}
        product={configurable}
        onOpenChange={(open) => !open && setConfiguring(null)}
        onAdd={(item) => {
          if (configuring) recent.remember(configuring)
          onAddProduct(item)
        }}
      />
    </section>
  )
}
