// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Banner, ConfirmDialog, DataTable, Dialog, DialogContent, DialogTitle, PinPad, StatusPill, type Column } from "@/shared/components/ui"
import { useReveal } from "@/shared/hooks/use-reveal"

afterEach(cleanup)

describe("PinPad (S-14)", () => {
  function Harness({ onSubmit }: { onSubmit: (value: string) => void }) {
    const [value, setValue] = useState("")
    return <PinPad label="PIN-код" secret value={value} onValueChange={setValue} maxLength={6} onSubmit={() => onSubmit(value)} />
  }

  it("takes digits, Backspace and Enter from the physical keyboard", async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    await userEvent.keyboard("12345678")
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("PIN-код: введено 6 из 6")
    await userEvent.keyboard("{Backspace}{Enter}")
    expect(onSubmit).toHaveBeenCalledWith("12345")
  })

  it("takes taps on the keys and ignores typing inside other fields", async () => {
    const onSubmit = vi.fn()
    render(
      <>
        <Harness onSubmit={onSubmit} />
        <input aria-label="Поиск" />
      </>,
    )
    await userEvent.click(screen.getByRole("button", { name: "7" }))
    await userEvent.click(screen.getByRole("button", { name: "Стереть" }))
    await userEvent.click(screen.getByRole("button", { name: "4" }))
    await userEvent.type(screen.getByLabelText("Поиск"), "99")
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("PIN-код: введено 1 из 6")
  })
})

describe("StatusPill", () => {
  it("shows the Russian label, never the raw value", () => {
    render(<StatusPill domain="document" status="POSTED" />)
    expect(screen.getByText("Проведён")).toBeTruthy()
    expect(screen.queryByText("POSTED")).toBeNull()
  })
})

describe("Dialog", () => {
  it("has a Russian close button", () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Скидка</DialogTitle>
        </DialogContent>
      </Dialog>,
    )
    expect(screen.getByRole("button", { name: "Закрыть" })).toBeTruthy()
  })

  it("ConfirmDialog keeps confirm disabled until a reason is given", async () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog open onOpenChange={() => {}} title="Отменить заказ?" confirmLabel="Отменить заказ" reasonLabel="Причина" onConfirm={onConfirm} />)
    const confirm = screen.getByRole("button", { name: "Отменить заказ" })
    expect(confirm).toHaveProperty("disabled", true)
    await userEvent.type(screen.getByLabelText("Причина"), "Гость ушёл")
    await userEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledWith("Гость ушёл")
  })
})

type Row = { id: string; name: string; total: number }
const columns: Column<Row>[] = [
  { key: "name", header: "Блюдо", cell: (row) => row.name, sortValue: (row) => row.name },
  { key: "total", header: "Сумма", cell: (row) => row.total, numeric: true, sortValue: (row) => row.total },
]
const rows: Row[] = [
  { id: "a", name: "Қазақ ет", total: 7990 },
  { id: "b", name: "Бауырсақ", total: 900 },
  { id: "c", name: "Шұбат", total: 2850 },
]

describe("DataTable (L-23)", () => {
  const bodyNames = () =>
    screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[0].textContent)

  it("sorts by a header click: ascending, descending, off", async () => {
    render(<DataTable columns={columns} rows={rows} getRowId={(row) => row.id} />)
    const header = screen.getByRole("button", { name: "Сумма" })
    await userEvent.click(header)
    expect(bodyNames()).toEqual(["Бауырсақ", "Шұбат", "Қазақ ет"])
    expect(screen.getByRole("columnheader", { name: /Сумма/ }).getAttribute("aria-sort")).toBe("ascending")
    await userEvent.click(header)
    expect(bodyNames()).toEqual(["Қазақ ет", "Шұбат", "Бауырсақ"])
    await userEvent.click(header)
    expect(bodyNames()).toEqual(["Қазақ ет", "Бауырсақ", "Шұбат"])
  })

  it("opens a row by click or Enter and marks the selected one", async () => {
    const onRowClick = vi.fn()
    render(<DataTable columns={columns} rows={rows} getRowId={(row) => row.id} onRowClick={onRowClick} selectedId="b" />)
    const [, first, second] = screen.getAllByRole("row")
    expect(second.getAttribute("aria-selected")).toBe("true")
    fireEvent.keyDown(first, { key: "Enter" })
    expect(onRowClick).toHaveBeenCalledWith(rows[0])
  })

  it("pages with «Показать ещё» and shows loaded of total", async () => {
    const onLoadMore = vi.fn()
    render(<DataTable columns={columns} rows={rows} getRowId={(row) => row.id} loadMore={{ loaded: 3, total: 40, canLoadMore: true, onLoadMore }} />)
    expect(screen.getByText("Загружено 3 из 40")).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Показать ещё" }))
    expect(onLoadMore).toHaveBeenCalledOnce()
  })

  it("renders loading, empty and error states", () => {
    const { rerender } = render(<DataTable columns={columns} rows={undefined} getRowId={(row) => row.id} />)
    expect(screen.getByRole("status", { name: "Загрузка" })).toBeTruthy()
    rerender(<DataTable columns={columns} rows={[]} getRowId={(row) => row.id} empty={<p>Чеков пока нет</p>} />)
    expect(screen.getByText("Чеков пока нет")).toBeTruthy()
    rerender(<DataTable columns={columns} rows={[]} getRowId={(row) => row.id} error="Сеть недоступна" />)
    expect(screen.getByRole("alert").textContent).toContain("Сеть недоступна")
  })
})

describe("useReveal: an error banner out of sight in a scrolled panel", () => {
  function Harness() {
    const [error, setError] = useState<string | null>(null)
    const ref = useReveal(error)
    return (
      <>
        {error ? (
          <Banner ref={ref} tabIndex={-1} tone="danger" title="Не удалось выполнить действие">
            {error}
          </Banner>
        ) : null}
        <button type="button" onClick={() => setError("Стол «5» уже забронирован")}>
          Сохранить
        </button>
      </>
    )
  }

  it("scrolls the banner into view (nearest) and focuses it when an error appears", () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    render(<Harness />)
    expect(scroll).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    const banner = screen.getByRole("alert")
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" })
    expect(document.activeElement).toBe(banner)
  })
})
