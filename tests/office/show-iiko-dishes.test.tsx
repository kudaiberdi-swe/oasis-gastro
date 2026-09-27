// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ToastProvider } from "@/shared/components/ui"
import { ShowIikoDishesButton } from "@/office/features/nomenclature/ui/show-iiko-dishes"

const mocks = vi.hoisted(() => ({
  previewIikoMenuSwitch: vi.fn(),
  showPricedIikoDishes: vi.fn(),
  hidePdfMenu: vi.fn(),
}))

vi.mock("@/office/features/nomenclature/data/use-nomenclature", () => ({
  useNomenclatureMutations: () => ({ previewIikoMenuSwitch: mocks.previewIikoMenuSwitch, showPricedIikoDishes: mocks.showPricedIikoDishes, hidePdfMenu: mocks.hidePdfMenu }),
}))

function renderButton() {
  return render(
    <ToastProvider>
      <ShowIikoDishesButton />
    </ToastProvider>,
  )
}

describe("«Показать блюда iiko с ценой» — the switch to the iiko menu", () => {
  afterEach(cleanup)
  beforeEach(() => {
    mocks.previewIikoMenuSwitch.mockReset()
    mocks.showPricedIikoDishes.mockReset()
    mocks.hidePdfMenu.mockReset()
  })

  it("counts with one read, then shows the iiko dishes and hides the PDF menu on confirm", async () => {
    mocks.previewIikoMenuSwitch.mockResolvedValue({ toShow: 3, hiddenService: 1, pdfHidden: 107, pdfPrices: 19 })
    mocks.showPricedIikoDishes.mockResolvedValue({ shown: 3, hiddenService: 1, productIds: [], isDone: true, continueCursor: "", dryRun: false })
    mocks.hidePdfMenu.mockResolvedValue({ hidden: 107, pricesDropped: 19, isDone: true, continueCursor: "", dryRun: false })
    renderButton()

    fireEvent.click(screen.getByRole("button", { name: /Показать блюда iiko с ценой/ }))
    expect(await screen.findByText(/Показать на кассе 3 блюда iiko/)).toBeTruthy()
    // Counting changes nothing: one read, no mutation yet.
    expect(mocks.previewIikoMenuSwitch).toHaveBeenCalledTimes(1)
    expect(mocks.showPricedIikoDishes).not.toHaveBeenCalled()
    expect(mocks.hidePdfMenu).not.toHaveBeenCalled()
    expect(screen.getByText(/Временное меню из PDF \(107 блюд\) будет скрыто/)).toBeTruthy()
    expect(screen.getByText(/снимутся цены из PDF \(19\)/)).toBeTruthy()
    expect(screen.getByText(/Служебные позиции/)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Показать на кассе" }))
    await waitFor(() => expect(mocks.showPricedIikoDishes).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false, paginationOpts: expect.objectContaining({ numItems: 500 }) })))
    await waitFor(() => expect(mocks.hidePdfMenu).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false })))
    expect(await screen.findByText(/На кассе показано 3 блюда iiko, меню из PDF скрыто \(107\); цены iiko для блюд, сопоставленных с PDF, появятся после следующего импорта iiko/)).toBeTruthy()
  })

  it("says so and asks nothing when there is nothing to change", async () => {
    mocks.previewIikoMenuSwitch.mockResolvedValue({ toShow: 0, hiddenService: 0, pdfHidden: 0, pdfPrices: 0 })
    renderButton()
    fireEvent.click(screen.getByRole("button", { name: /Показать блюда iiko с ценой/ }))
    expect(await screen.findByText("Скрытых блюд iiko с ценой в ваших филиалах нет")).toBeTruthy()
    expect(screen.queryByText(/Показать на кассе \d/)).toBeNull()
  })

  it("applies every page of the change", async () => {
    mocks.previewIikoMenuSwitch.mockResolvedValue({ toShow: 4, hiddenService: 0, pdfHidden: 0, pdfPrices: 0 })
    mocks.showPricedIikoDishes
      .mockResolvedValueOnce({ shown: 3, hiddenService: 0, productIds: [], isDone: false, continueCursor: "c1", dryRun: false })
      .mockResolvedValueOnce({ shown: 1, hiddenService: 0, productIds: [], isDone: true, continueCursor: "", dryRun: false })
    renderButton()
    fireEvent.click(screen.getByRole("button", { name: /Показать блюда iiko с ценой/ }))
    fireEvent.click(await screen.findByRole("button", { name: "Показать на кассе" }))
    expect(await screen.findByText(/На кассе показано 4 блюда iiko/)).toBeTruthy()
    expect(mocks.showPricedIikoDishes).toHaveBeenLastCalledWith(expect.objectContaining({ paginationOpts: expect.objectContaining({ cursor: "c1" }) }))
    expect(mocks.hidePdfMenu).not.toHaveBeenCalled()
  })
})
