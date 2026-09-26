// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { applyOrder, favoriteTile, moveId, type FavoriteRow } from "@/office/features/favorites/model/favorites"
import { FavoriteStar } from "@/office/features/favorites/ui/favorite-star"
import { FavoritesWorkspace } from "@/office/features/favorites/ui/favorites-workspace"
import { ToastProvider } from "@/shared/components/ui"

// W3-ADM-13 «Избранное»: tiles of pinned sections and report views, the star in the page header,
// reorder by keyboard and drag.

const mocks = vi.hoisted(() => ({
  items: [] as FavoriteRow[] | undefined,
  toggle: vi.fn(async (_args: unknown) => ({ favorite: true })),
  reorder: vi.fn(async (_args: unknown) => null),
}))

vi.mock("@/office/features/favorites/data/use-office-favorites", () => ({
  useOfficeFavorites: () => mocks.items,
  useFavoriteActions: () => ({ toggle: mocks.toggle, reorder: mocks.reorder }),
}))

const STOCK: FavoriteRow = { id: "section:stock", kind: "section", targetId: "stock", label: "Остатки", sortOrder: 0 }
const RECEIPTS: FavoriteRow = { id: "section:receipts", kind: "section", targetId: "receipts", label: "Приходные накладные", sortOrder: 1 }
const REPORT: FavoriteRow = { id: "report:v1", kind: "report", targetId: "v1", label: "Неделя Абая", sortOrder: 2, reportId: "sales-01", reportTitle: "Выручка по дням" }

beforeEach(() => {
  mocks.items = [STOCK, RECEIPTS, REPORT]
  mocks.toggle.mockClear()
  mocks.reorder.mockClear()
})

afterEach(cleanup)

function renderWith(node: ReactNode) {
  return render(
    <ToastProvider>
      <MemoryRouter>{node}</MemoryRouter>
    </ToastProvider>,
  )
}

describe("favorites model", () => {
  it("turns rows into tiles with the menu's labels and moves ids", () => {
    expect(favoriteTile(STOCK)).toMatchObject({ href: "/office/stock", caption: "Товары и склады", title: "Остатки" })
    expect(favoriteTile(REPORT)).toMatchObject({ href: "/office/report-favorites/v1", caption: "Отчёт · Выручка по дням", title: "Неделя Абая" })
    expect(favoriteTile({ id: "document:receipts/r-1", kind: "document", targetId: "receipts/r-1", label: "Приход №1", sortOrder: 3 })).toMatchObject({ href: "/office/receipts/r-1", title: "Приход №1" })
    const ids = ["a", "b", "c"]
    expect(moveId(ids, "c", 0)).toEqual(["c", "a", "b"])
    expect(moveId(ids, "a", 99)).toEqual(["b", "c", "a"])
    expect(moveId(ids, "a", -1)).toBe(ids)
    expect(applyOrder([STOCK, RECEIPTS, REPORT], ["report:v1", "section:stock"]).map((row) => [row.id, row.sortOrder])).toEqual([
      ["report:v1", 0],
      ["section:stock", 1],
      ["section:receipts", 2],
    ])
  })
})

describe("«Избранное» screen", () => {
  it("shows pinned sections and report views as links, in order", () => {
    renderWith(<FavoritesWorkspace />)
    const list = screen.getByRole("list", { name: "Избранное" })
    expect(within(list).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/office/stock", "/office/receipts", "/office/report-favorites/v1"])
    expect(within(list).getByText("Отчёт · Выручка по дням")).toBeTruthy()
  })

  it("moves a tile with the arrow keys on its handle and announces the new place", async () => {
    renderWith(<FavoritesWorkspace />)
    fireEvent.keyDown(screen.getByRole("button", { name: "Переместить «Приходные накладные»" }), { key: "ArrowUp" })
    expect(mocks.reorder).toHaveBeenCalledWith({ ids: ["section:receipts", "section:stock", "report:v1"] })
    expect(screen.getByText("«Приходные накладные» — позиция 1 из 3")).toBeTruthy()
    fireEvent.keyDown(screen.getByRole("button", { name: "Переместить «Остатки»" }), { key: "End" })
    expect(mocks.reorder).toHaveBeenLastCalledWith({ ids: ["section:receipts", "report:v1", "section:stock"] })
    // Already first: nothing to send.
    fireEvent.keyDown(screen.getByRole("button", { name: "Переместить «Остатки»" }), { key: "Home" })
    fireEvent.keyDown(screen.getByRole("button", { name: "Переместить «Остатки»" }), { key: "ArrowLeft" })
    expect(mocks.reorder).toHaveBeenCalledTimes(2)
  })

  it("moves a tile by dragging it onto another one", () => {
    renderWith(<FavoritesWorkspace />)
    const [stock, , report] = within(screen.getByRole("list", { name: "Избранное" })).getAllByRole("listitem")
    const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" }
    fireEvent.dragStart(report, { dataTransfer })
    fireEvent.dragOver(stock, { dataTransfer })
    fireEvent.drop(stock, { dataTransfer })
    expect(mocks.reorder).toHaveBeenCalledWith({ ids: ["report:v1", "section:stock", "section:receipts"] })
  })

  it("unpins a tile", async () => {
    renderWith(<FavoritesWorkspace />)
    fireEvent.click(screen.getByRole("button", { name: "Убрать «Неделя Абая» из избранного" }))
    await waitFor(() => expect(mocks.toggle).toHaveBeenCalledWith({ kind: "report", targetId: "v1", label: "Неделя Абая" }))
    expect(await screen.findByText("«Неделя Абая» убрано из избранного")).toBeTruthy()
  })

  it("explains how to pin when empty, and shows a skeleton while loading", () => {
    mocks.items = []
    renderWith(<FavoritesWorkspace />)
    expect(screen.getByText("В избранном пока пусто")).toBeTruthy()
    expect(screen.getByText(/Закрепите раздел звёздочкой в шапке страницы/)).toBeTruthy()
    cleanup()
    mocks.items = undefined
    renderWith(<FavoritesWorkspace />)
    expect(screen.getByRole("status", { name: "Загрузка избранного" })).toBeTruthy()
  })
})

describe("«В избранное» star", () => {
  it("shows whether the section is pinned and toggles it", async () => {
    renderWith(<FavoriteStar sectionId="stock" label="Остатки" />)
    const pinned = screen.getByRole("button", { name: "Убрать из избранного" })
    expect(pinned.getAttribute("aria-pressed")).toBe("true")
    cleanup()
    mocks.items = []
    renderWith(<FavoriteStar sectionId="stock" label="Остатки" />)
    fireEvent.click(screen.getByRole("button", { name: "В избранное" }))
    await waitFor(() => expect(mocks.toggle).toHaveBeenCalledWith({ kind: "section", targetId: "stock", label: "Остатки" }))
    expect(await screen.findByText("«Остатки» в избранном")).toBeTruthy()
  })
})
