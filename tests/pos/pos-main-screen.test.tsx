// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PosRail, headerDate, SyncIndicator, syncStateFrom } from "@/pos/components/pos-rail"
import { OrderPanel } from "@/pos/components/order-panel"
import { ProductCard } from "@/pos/components/product-card"
import { goBack, openView, parseRecent, pushRecent, RECENT_LIMIT, sortProducts, type CatalogNavigation, type CatalogProduct } from "@/pos/features/catalog/model/catalog-view"
import { CatalogPanel, categoryToneOf } from "@/pos/features/catalog/ui/catalog-panel"
import { ChecksSwitcher } from "@/pos/features/order-taking/ui/checks-switcher"
import { createTranslator } from "@/pos/i18n"
import { ThemeProvider } from "@/shared/components/theme-provider"
import { ToastProvider } from "@/shared/components/ui"

// W1-POS-10 (main screen: header, order panel, checks switcher) and W1-POS-11 (catalog).

type ProductsArgs = { category?: string; search?: string; enabled?: boolean; pageSize?: number }

const catalog = vi.hoisted(() => ({
  categories: [] as Array<{ externalId: string; label: string; shortLabel: string; colorToken?: string }>,
  products: [] as CatalogProduct[],
  favorites: [] as CatalogProduct[],
  favoriteIds: [] as string[],
  canLoadMore: false,
  loadMore: vi.fn(),
  productCalls: [] as ProductsArgs[],
  favoritesEnabled: [] as boolean[],
  toggleFavorite: vi.fn(async () => ({ favorite: true })),
}))

vi.mock("@/pos/features/catalog/data/use-catalog", () => ({
  useCategories: () => catalog.categories,
  useProducts: (args: ProductsArgs) => {
    catalog.productCalls.push(args)
    if (args.enabled === false) return { items: [], loading: false, loadingMore: false, canLoadMore: false, loadMore: () => {} }
    const items = catalog.products.filter((product) => (!args.category || product.category === args.category) && (!args.search || product.name.toLowerCase().includes(args.search.toLowerCase())))
    return { items, loading: false, loadingMore: false, canLoadMore: catalog.canLoadMore, loadMore: catalog.loadMore }
  },
  useFavoriteIds: () => catalog.favoriteIds,
  useFavoriteProducts: (_token: string, enabled: boolean) => {
    catalog.favoritesEnabled.push(enabled)
    return { items: enabled ? catalog.favorites : [], loading: false, canLoadMore: false, loadMore: () => {} }
  },
  useToggleFavorite: () => catalog.toggleFavorite,
  useRecentProducts: () => ({ items: [], remember: () => {} }),
  useProductConfiguration: () => undefined,
}))

vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: () => vi.fn(),
  usePaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: vi.fn() }),
}))

function product(overrides: Partial<CatalogProduct> & Pick<CatalogProduct, "_id" | "name">): CatalogProduct {
  return { externalId: `x-${overrides._id}`, nameKk: overrides.name, price: 1000, category: "c-main", popular: false, ...overrides }
}

const scrollIntoView = vi.fn()

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView
  scrollIntoView.mockClear()
  catalog.categories = [
    { externalId: "c-main", label: "Основные блюда", shortLabel: "Основные" },
    { externalId: "c-combo", label: "Комбо", shortLabel: "Комбо" },
    { externalId: "c-drinks", label: "Напитки", shortLabel: "Напитки" },
  ]
  catalog.products = [
    product({ _id: "p1", name: "Бешбармак", nameKk: "Бешбармақ", price: 5990, popular: true }),
    product({ _id: "p2", name: "Баурсаки", nameKk: "Бауырсақ", price: 900 }),
    product({ _id: "p3", name: "Айран", price: 700, category: "c-drinks", popular: true }),
  ]
  catalog.favorites = []
  catalog.favoriteIds = []
  catalog.canLoadMore = false
  catalog.loadMore.mockClear()
  catalog.productCalls = []
  catalog.favoritesEnabled = []
  catalog.toggleFavorite.mockClear()
})

afterEach(cleanup)

function renderCatalog(onAddProduct = vi.fn()) {
  render(
    <ToastProvider>
      <CatalogPanel sessionToken="s" onAddProduct={onAddProduct} />
    </ToastProvider>,
  )
  return { onAddProduct }
}

const cardNames = () => screen.getAllByRole("button").map((button) => button.textContent ?? "").filter((text) => text.includes("₸"))

describe("catalog view model (W1-POS-11)", () => {
  it("← goes back through the opened views; opening the same view twice is not a step", () => {
    let state: CatalogNavigation = { current: { kind: "all" }, back: [] }
    state = openView(state, { kind: "category", categoryExternalId: "a" })
    state = openView(state, { kind: "category", categoryExternalId: "a" })
    state = openView(state, { kind: "favorites" })
    expect(state.back).toHaveLength(2)
    state = goBack(state)
    expect(state.current).toEqual({ kind: "category", categoryExternalId: "a" })
    state = goBack(goBack(state))
    expect(state.current).toEqual({ kind: "all" })
    expect(goBack(state)).toBe(state)
  })

  it("sorts by name, by price and popular first", () => {
    const items = catalog.products
    expect(sortProducts(items, "name").map((item) => item.name)).toEqual(["Айран", "Баурсаки", "Бешбармак"])
    expect(sortProducts(items, "price").map((item) => item.price)).toEqual([700, 900, 5990])
    expect(sortProducts(items, "popular").map((item) => item.name)).toEqual(["Айран", "Бешбармак", "Баурсаки"])
  })

  it("«Последние» keeps each dish once, newest first, and ignores a broken stored value", () => {
    let list: CatalogProduct[] = []
    for (const item of catalog.products) list = pushRecent(list, item)
    list = pushRecent(list, catalog.products[0])
    expect(list.map((item) => item._id)).toEqual(["p1", "p3", "p2"])
    for (let index = 0; index < RECENT_LIMIT + 5; index += 1) list = pushRecent(list, product({ _id: `n${index}`, name: `Блюдо ${index}` }))
    expect(list).toHaveLength(RECENT_LIMIT)
    expect(parseRecent("{not json")).toEqual([])
    expect(parseRecent(JSON.stringify([{ _id: "p1", name: "Бешбармак", price: 5990 }, { junk: true }]))).toHaveLength(1)
  })
})

describe("CatalogPanel (W1-POS-11)", () => {
  it("has the toolbar ← ⌂ ☆ 🕘 and a 48px search — no counter, sort or hint row", () => {
    renderCatalog()
    for (const name of ["Назад", "Все блюда", "Избранное", "Последние"]) expect(screen.getByRole("button", { name }).className).toContain("size-12")
    expect((screen.getByRole("button", { name: "Назад" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole("searchbox", { name: "Поиск по меню…" }).className).toContain("h-[var(--control-h-pos)]")
    expect(screen.queryByText(/загружено/)).toBeNull()
    expect(screen.queryByText("Нажмите на карточку, чтобы добавить позицию")).toBeNull()
    expect(screen.queryByRole("combobox", { name: "Сортировка" })).toBeNull()
    // Sorted by name by default.
    expect(cardNames().map((name) => name.split(/\d/)[0])).toEqual(["Айран", "БаурсакиБауырсақ", "БешбармакБешбармақ"])
  })

  it("puts the toolbar action (the kitchen screen) at the right end of the toolbar", () => {
    render(
      <ToastProvider>
        <CatalogPanel sessionToken="s" onAddProduct={() => {}} toolbarAction={<button type="button">Экран кухни</button>} />
      </ToastProvider>,
    )
    const search = screen.getByRole("searchbox")
    const kitchen = screen.getByRole("button", { name: "Экран кухни" })
    expect(search.compareDocumentPosition(kitchen) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("colors a category by its stored colorToken first and the label guess only as a fallback", () => {
    expect(categoryToneOf({ label: "Салаты", colorToken: "cat-tea" })).toBe("tea")
    expect(categoryToneOf({ label: "Салаты" })).toBe("green")
    expect(categoryToneOf({ label: "Салаты", colorToken: null })).toBe("green")
    expect(categoryToneOf({ label: "Соусы" })).toBeUndefined()
    // A renamed iiko group keeps the office's color.
    expect(categoryToneOf({ label: "Жаңа мәзір", colorToken: "cat-meat" })).toBe("meat")
    catalog.categories = [
      { externalId: "c-main", label: "Новое меню", shortLabel: "Новое", colorToken: "cat-bread" },
      { externalId: "c-drinks", label: "Напитки", shortLabel: "Напитки" },
    ]
    renderCatalog()
    expect(screen.getByRole("button", { name: "Новое" }).className).toContain("before:bg-cat-bread")
    expect(screen.getByRole("button", { name: "Напитки" }).className).toContain("before:bg-cat-dairy")
  })

  it("filters by the category's externalId, not its label (L-1), and ← returns to all", () => {
    renderCatalog()
    fireEvent.click(screen.getByRole("button", { name: "Напитки" }))
    expect(catalog.productCalls.at(-2)).toMatchObject({ category: "c-drinks", enabled: true })
    expect(cardNames()).toHaveLength(1)
    expect(screen.getByRole("button", { name: "Напитки" }).getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "Назад" }))
    expect(cardNames()).toHaveLength(3)
  })

  it("a chip past the edge scrolls only inside its strip (L-2)", () => {
    renderCatalog()
    const chip = screen.getByRole("button", { name: "Напитки" })
    fireEvent.click(chip)
    expect(scrollIntoView).toHaveBeenCalledWith({ inline: "nearest", block: "nearest" })
    expect(scrollIntoView.mock.contexts[0]).toBe(chip)
    const strip = screen.getByRole("group", { name: "Категории" })
    expect(strip.className).toContain("overflow-x-auto")
    // The panel and the grid clip horizontally, so nothing outside the strip can scroll sideways.
    expect(screen.getByRole("region", { name: "Меню" }).className).toContain("overflow-x-clip")
  })

  it("an empty category shows «Ничего не найдено» with «Показать популярное», which opens popular dishes", () => {
    renderCatalog()
    fireEvent.click(screen.getByRole("button", { name: "Комбо" }))
    expect(screen.getByText("Ничего не найдено")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Показать популярное" }))
    expect(screen.getByRole("button", { name: "Популярное" }).getAttribute("aria-pressed")).toBe("true")
    const popularCall = catalog.productCalls.at(-1)
    expect(popularCall).toMatchObject({ enabled: true, pageSize: 100 })
    expect(popularCall?.category).toBeUndefined()
    const names = cardNames()
    expect(names).toHaveLength(2)
    expect(names[0]).toMatch(/^Айран/)
    expect(names[1]).toMatch(/^Бешбармак/)
  })

  it("☆ view reads favoriteProducts; the star toggles by externalId", async () => {
    renderCatalog()
    fireEvent.click(screen.getByRole("button", { name: "Избранное" }))
    expect(catalog.favoritesEnabled.at(-1)).toBe(true)
    expect(screen.getByText("В избранном пусто")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Все блюда" }))
    fireEvent.click(screen.getByRole("button", { name: "В избранное: Бешбармак" }))
    await waitFor(() => expect(catalog.toggleFavorite).toHaveBeenCalledWith({ sessionToken: "s", productExternalId: "x-p1" }))
  })

  it("adds a plain dish at once and offers «Показать ещё» when more pages exist", () => {
    catalog.canLoadMore = true
    const { onAddProduct } = renderCatalog()
    fireEvent.click(screen.getByRole("button", { name: /^Баурсаки/ }))
    expect(onAddProduct).toHaveBeenCalledWith({ productId: "p2", name: "Баурсаки", nameKk: "Бауырсақ", price: 900 })
    fireEvent.click(screen.getByRole("button", { name: "Показать ещё" }))
    expect(catalog.loadMore).toHaveBeenCalled()
  })

  it("search replaces the category and shows the empty state for no match", () => {
    renderCatalog()
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "пицца" } })
    expect(catalog.productCalls.at(-2)).toMatchObject({ search: "пицца", enabled: true })
    expect(screen.getByText("Проверьте запрос или выберите другую категорию.")).toBeTruthy()
  })
})

describe("ProductCard (W1-POS-11)", () => {
  it("shows the photo 4:3, RU 16px and KZ 14px muted, the badge, and the whole card adds", () => {
    const onClick = vi.fn()
    render(<ProductCard name="Бешбармак" nameKk="Бешбармақ" price={5990} imageUrl="/images/cymbal-3.jpg" badge="Комбо" onClick={onClick} />)
    const card = screen.getByRole("button", { name: /Бешбармак/ })
    expect(card.querySelector("img")?.parentElement?.className).toContain("aspect-[4/3]")
    expect(screen.getByText("Бешбармак").className).toContain("text-body")
    expect(screen.getByText("Бешбармақ").className).toContain("text-body-sm")
    expect(screen.getByText("Бешбармақ").className).toContain("text-muted-foreground")
    expect(screen.getByText("Комбо")).toBeTruthy()
    fireEvent.click(card)
    expect(onClick).toHaveBeenCalled()
  })

  it("a stop-listed dish is dimmed, says «нет в наличии» and does not add", () => {
    const onClick = vi.fn()
    render(<ProductCard name="Шұбат" nameKk="Шұбат" price={850} available={false} onClick={onClick} />)
    const card = screen.getByRole("button", { name: "Шұбат — нет в наличии" }) as HTMLButtonElement
    expect(card.disabled).toBe(true)
    expect(screen.getByText("нет в наличии")).toBeTruthy()
    expect(card.parentElement?.className).toContain("opacity-50")
  })
})

describe("ChecksSwitcher (W1-POS-10, hall grid)", () => {
  it("«Зал · N открыто» is a 48px button beside the current table and opens the hall", () => {
    const onOpenFloor = vi.fn()
    render(<ChecksSwitcher tableLabel="Стол 7" orderNumber={100004} openCount={2} onOpenFloor={onOpenFloor} />)
    const hall = screen.getByRole("button", { name: "Зал · 2 открыто" })
    expect(hall.className).toContain("h-[var(--control-h-pos)]")
    expect(screen.getByText("Стол 7")).toBeTruthy()
    expect(screen.getByText("· №100004")).toBeTruthy()
    fireEvent.click(hall)
    expect(onOpenFloor).toHaveBeenCalled()
  })

  it("a check with no table yet reads «Новый заказ»", () => {
    render(<ChecksSwitcher tableLabel="" openCount={0} onOpenFloor={() => {}} />)
    expect(screen.getByText("Новый заказ")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Зал · 0 открыто" })).toBeTruthy()
  })
})

describe("PosRail (W1-POS-10, redesign 2026-10)", () => {
  const renderHeader = (props: Partial<Parameters<typeof PosRail>[0]> = {}) =>
    render(
      <ThemeProvider>
        <PosRail restaurantName="Алматы" terminalName="Главная касса" city="Алматы" employeeName="Айгерим" employeeRole="Менеджер" shiftNumber={12} onOpenShiftInfo={() => {}} onLock={() => {}} {...props} />
      </ThemeProvider>,
    )

  it("sections «Касса», «Зал», «Экран кухни», «Главное меню»; «Офис» only when asked (manager, administrator)", () => {
    const onFloor = vi.fn()
    const onKitchen = vi.fn()
    const onMenu = vi.fn()
    renderHeader({ onFloor, onKitchen, onMenu, kitchenCount: 3 })
    const nav = screen.getByRole("navigation", { name: "Раздел" })
    expect(within(nav).getByRole("button", { name: "Касса" }).getAttribute("aria-current")).toBe("page")
    expect(within(nav).queryByRole("link", { name: "Офис" })).toBeNull()
    fireEvent.click(within(nav).getByRole("button", { name: "Зал" }))
    fireEvent.click(within(nav).getByRole("button", { name: "Экран кухни · 3" }))
    fireEvent.click(within(nav).getByRole("button", { name: "Главное меню" }))
    expect([onFloor, onKitchen, onMenu].every((handler) => handler.mock.calls.length === 1)).toBe(true)
    cleanup()
    renderHeader({ showOfficeSwitch: true, view: "kitchen", onKitchen })
    const office = screen.getByRole("navigation", { name: "Раздел" })
    expect(within(office).getByRole("link", { name: "Офис" }).getAttribute("href")).toBe("/office")
    expect(within(office).getByRole("button", { name: "Экран кухни" }).getAttribute("aria-current")).toBe("page")
    expect(within(office).getByRole("button", { name: "Касса" }).getAttribute("aria-current")).toBeNull()
  })

  it("brand and «<касса> · <город>» in the mark's tooltip, profile with role and date, a 72/96px rail with 48px targets", () => {
    renderHeader({ now: Date.UTC(2026, 8, 24, 6), onNotifications: () => {} })
    expect(screen.getByRole("img", { name: "Sandyq" }).getAttribute("title")).toBe("Sandyq · Алматы\nГлавная касса · Алматы")
    const profile = screen.getByRole("button", { name: "Профиль: Айгерим" })
    expect(profile.getAttribute("title")).toContain("Менеджер · 24 сентября")
    expect(profile.textContent).toBe("А")
    const rail = screen.getByRole("banner")
    expect(rail.className).toContain("w-[72px]")
    expect(rail.className).toContain("min-[1280px]:w-24")
    for (const name of ["Профиль: Айгерим", "Уведомления", "Заблокировать кассу"]) expect(screen.getByRole("button", { name }).className).toContain("size-12")
    expect(headerDate(Date.UTC(2026, 8, 24, 20))).toBe("25 сентября")
    expect(headerDate(Date.UTC(2026, 8, 24, 20), createTranslator("kk"))).toBe("25 қыркүйек")
    expect(headerDate(Date.UTC(2026, 11, 31, 20), createTranslator("kk"))).toBe("1 қаңтар")
  })

  it("«Синхронизировано»: an icon with a dot, the word for screen readers; offline and slow requests", () => {
    renderHeader({ syncIndicator: <SyncIndicator state="synced" /> })
    const label = screen.getByText("Синхронизировано")
    expect(label.className).toContain("sr-only")
    expect(label.parentElement?.getAttribute("title")).toBe("Синхронизировано")
    expect(syncStateFrom({ isWebSocketConnected: true })).toBe("synced")
    expect(syncStateFrom({ isWebSocketConnected: true }, true)).toBe("syncing")
    expect(syncStateFrom({ isWebSocketConnected: false, hasEverConnected: true })).toBe("offline")
    expect(syncStateFrom({ isWebSocketConnected: false, hasEverConnected: false })).toBe("syncing")
  })
})

describe("OrderPanel header and empty state (W1-POS-10)", () => {
  function renderPanel(props: Partial<Parameters<typeof OrderPanel>[0]> = {}) {
    const onMore = vi.fn()
    render(
      <OrderPanel
        tableLabel=""
        lines={[]}
        itemCount={0}
        orderTypeOptions={[{ value: "dine-in", label: "В зале", mode: "dine-in" }]}
        orderTypeValue="dine-in"
        onOrderTypeChange={() => {}}
        subtotal={0}
        discountPercent={0}
        discountAmount={0}
        serviceChargePercent={15}
        serviceChargeAmount={0}
        total={0}
        saving={false}
        error={null}
        canSendToKitchen={false}
        onIncrement={() => {}}
        onDecrement={() => {}}
        onRemove={() => {}}
        onVoid={() => {}}
        onSendToKitchen={() => {}}
        onHold={() => {}}
        onCheckout={() => {}}
        onDiscount={() => {}}
        onMore={onMore}
        {...props}
      />,
    )
    return { onMore }
  }

  it("says the order is empty, shows the status, counts positions once and has one entry to the actions («Ещё»)", () => {
    const { onMore } = renderPanel({ orderStatus: "held", titleSlot: <span>Стол 7 ▾</span> })
    expect(screen.getByText("Заказ пока пуст")).toBeTruthy()
    expect(screen.getByText("Выберите товар в меню справа.")).toBeTruthy()
    expect(screen.getByText("Стол 7 ▾")).toBeTruthy()
    expect(screen.getByText("Отложен")).toBeTruthy()
    expect(screen.queryByText(/Текущий чек/)).toBeNull()
    expect(screen.getAllByText(/0 позиций/)).toHaveLength(1)
    expect(screen.queryByRole("button", { name: "Действия с заказом" })).toBeNull()
    const more = screen.getByRole("button", { name: "Ещё" })
    expect(more.className).toContain("h-16")
    fireEvent.click(more)
    expect(onMore).toHaveBeenCalled()
    // One primary on the screen: «Оплатить».
    expect(screen.getByRole("region", { name: "Заказ" }).querySelectorAll(".bg-primary")).toHaveLength(1)
  })
})
