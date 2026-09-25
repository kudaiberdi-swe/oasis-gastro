// Catalog view model (W1-POS-11): what the toolbar shows, the ← history, sorting and «Последние».

/** A dish as the catalog grid shows it — listProducts, favoriteProducts and «Последние» share it. */
export type CatalogProduct = {
  _id: string
  externalId: string
  name: string
  nameKk: string
  price: number
  category: string
  popular?: boolean
  badge?: string
  description?: string
  imagePath?: string
  customizable?: boolean
  sizeScaleId?: string
  /** false — in the branch stop list («нет в наличии»). */
  available?: boolean
  imageUrl?: string
}

export type CatalogView = { kind: "all" } | { kind: "popular" } | { kind: "favorites" } | { kind: "recent" } | { kind: "category"; categoryExternalId: string }

export type CatalogSort = "name" | "price" | "popular"

export const SORT_OPTIONS: { value: CatalogSort; label: string }[] = [
  { value: "name", label: "По названию" },
  { value: "price", label: "По цене" },
  { value: "popular", label: "Популярные" },
]

export const ALL_VIEW: CatalogView = { kind: "all" }
export const POPULAR_VIEW: CatalogView = { kind: "popular" }

export function sameView(a: CatalogView, b: CatalogView) {
  if (a.kind !== b.kind) return false
  return a.kind !== "category" || a.categoryExternalId === (b as { categoryExternalId: string }).categoryExternalId
}

/** The ← history of views: opening a view pushes the current one; the same view twice is not a step. */
export type CatalogNavigation = { current: CatalogView; back: CatalogView[] }

const HISTORY_LIMIT = 20

export function openView(state: CatalogNavigation, next: CatalogView): CatalogNavigation {
  if (sameView(state.current, next)) return state
  return { current: next, back: [...state.back, state.current].slice(-HISTORY_LIMIT) }
}

export function goBack(state: CatalogNavigation): CatalogNavigation {
  if (!state.back.length) return state
  return { current: state.back[state.back.length - 1], back: state.back.slice(0, -1) }
}

const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true })

/** Sorts the loaded page; the server already returns «По названию». Ties fall back to the name. */
export function sortProducts<T extends CatalogProduct>(items: T[], sort: CatalogSort): T[] {
  const byName = (a: T, b: T) => collator.compare(a.name, b.name)
  if (sort === "name") return [...items].sort(byName)
  if (sort === "price") return [...items].sort((a, b) => a.price - b.price || byName(a, b))
  return [...items].sort((a, b) => Number(Boolean(b.popular)) - Number(Boolean(a.popular)) || byName(a, b))
}

/** «Последние»: the most recent first, each dish once. */
export const RECENT_LIMIT = 24

export function pushRecent(list: CatalogProduct[], product: CatalogProduct): CatalogProduct[] {
  return [product, ...list.filter((item) => item._id !== product._id)].slice(0, RECENT_LIMIT)
}

/** Keeps only the fields the grid needs, so a stored entry never carries the whole document. */
export function recentEntry(product: CatalogProduct): CatalogProduct {
  const { _id, externalId, name, nameKk, price, category, popular, badge, description, imagePath, imageUrl, customizable, sizeScaleId, available } = product
  return { _id, externalId, name, nameKk, price, category, popular, badge, description, imagePath, imageUrl, customizable, sizeScaleId, available }
}

export function parseRecent(raw: string | null): CatalogProduct[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is CatalogProduct => typeof item === "object" && item !== null && typeof item._id === "string" && typeof item.name === "string" && typeof item.price === "number")
      .slice(0, RECENT_LIMIT)
  } catch {
    return []
  }
}

/** Title and hint of the empty grid (pos/24, pos/27). */
export function emptyCopy(view: CatalogView, search: string): { title: string; description: string } {
  if (search) return { title: "Ничего не найдено", description: "Проверьте запрос или выберите другую категорию." }
  if (view.kind === "favorites") return { title: "В избранном пусто", description: "Нажмите ☆ на карточке блюда, чтобы добавить его сюда." }
  if (view.kind === "recent") return { title: "Последних блюд нет", description: "Здесь появятся блюда, которые вы добавляли в заказы." }
  return { title: "Ничего не найдено", description: "Проверьте запрос или выберите другую категорию." }
}
