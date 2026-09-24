// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { createMemoryRouter, Link, RouterProvider } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Can, CapabilitiesProvider } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { SaveStatus, UnsavedChangesDialog } from "@/office/components/unsaved-changes"
import { useUnsavedChanges } from "@/office/hooks/use-unsaved-changes"
import { DataTable } from "@/shared/components/ui"
import { breakpointForWidth } from "@/shared/hooks/use-breakpoint"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("Can (W0-UI-02)", () => {
  it("hides actions without the right instead of disabling them", () => {
    render(
      <CapabilitiesProvider capabilities={["office.stock.view"]}>
        <Can capability="office.stock.view">
          <button>Открыть</button>
        </Can>
        <Can capability="office.receipts.post">
          <button>Провести</button>
        </Can>
      </CapabilitiesProvider>,
    )
    expect(screen.getByRole("button", { name: "Открыть" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Провести" })).toBeNull()
  })
})

describe("office states", () => {
  it("renders loading, empty, error with retry and no access", async () => {
    const onRetry = vi.fn()
    const { rerender } = render(<OfficeStatePage state={{ kind: "loading" }} />)
    expect(screen.getByRole("status", { name: "Загрузка" })).toBeTruthy()
    rerender(<OfficeStatePage state={{ kind: "empty" }} />)
    expect(screen.getByText("Записей пока нет")).toBeTruthy()
    rerender(<OfficeStatePage state={{ kind: "error", error: new Error("Сеть недоступна"), onRetry }} />)
    expect(screen.getByRole("alert").textContent).toContain("Сеть недоступна")
    await userEvent.click(screen.getByRole("button", { name: "Повторить" }))
    expect(onRetry).toHaveBeenCalledOnce()
    rerender(<OfficeStatePage state={{ kind: "denied" }} />)
    expect(screen.getByText("Нет доступа")).toBeTruthy()
  })

  it("shows the save indicator", () => {
    const { rerender } = render(<SaveStatus state="dirty" />)
    expect(screen.getByRole("status").textContent).toContain("Есть несохранённые изменения")
    rerender(<SaveStatus state="saved" />)
    expect(screen.getByRole("status").textContent).toContain("Все изменения сохранены")
  })
})

describe("useUnsavedChanges", () => {
  function Editor() {
    const [dirty, setDirty] = useState(false)
    const blocker = useUnsavedChanges(dirty)
    return (
      <>
        <button onClick={() => setDirty(true)}>Изменить</button>
        <Link to="/other">Другой раздел</Link>
        <UnsavedChangesDialog blocker={blocker} />
      </>
    )
  }

  it("asks before leaving with edits and lets the user stay or go", async () => {
    const router = createMemoryRouter([{ path: "/editor", element: <Editor /> }, { path: "/other", element: <p>Другая страница</p> }], { initialEntries: ["/editor"] })
    render(<RouterProvider router={router} />)

    await userEvent.click(screen.getByRole("button", { name: "Изменить" }))
    await userEvent.click(screen.getByRole("link", { name: "Другой раздел" }))
    expect(screen.getByText("Уйти без сохранения?")).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Остаться" }))
    expect(router.state.location.pathname).toBe("/editor")

    await userEvent.click(screen.getByRole("link", { name: "Другой раздел" }))
    await userEvent.click(screen.getByRole("button", { name: "Уйти без сохранения" }))
    expect(await screen.findByText("Другая страница")).toBeTruthy()
  })

  it("leaves freely when nothing changed", async () => {
    const router = createMemoryRouter([{ path: "/editor", element: <Editor /> }, { path: "/other", element: <p>Другая страница</p> }], { initialEntries: ["/editor"] })
    render(<RouterProvider router={router} />)
    await userEvent.click(screen.getByRole("link", { name: "Другой раздел" }))
    expect(await screen.findByText("Другая страница")).toBeTruthy()
  })
})

describe("adaptive office (OFFICE-DESIGN §8)", () => {
  it("maps widths to breakpoints", () => {
    expect(breakpointForWidth(800)).toBe("mobile")
    expect(breakpointForWidth(1024)).toBe("tablet")
    expect(breakpointForWidth(1280)).toBe("laptop")
    expect(breakpointForWidth(1440)).toBe("desktop")
  })

  it("turns table rows into cards under 1024px", () => {
    vi.stubGlobal("innerWidth", 800)
    act(() => void window.dispatchEvent(new Event("resize")))
    render(
      <DataTable
        columns={[
          { key: "name", header: "Блюдо", cell: (row: { id: string; name: string; total: number }) => row.name },
          { key: "total", header: "Сумма", numeric: true, cell: (row) => row.total },
        ]}
        rows={[{ id: "a", name: "Қазақ ет", total: 7990 }]}
        getRowId={(row) => row.id}
      />,
    )
    expect(screen.queryByRole("table")).toBeNull()
    expect(screen.getByRole("listitem").textContent).toContain("Қазақ ет")
    expect(screen.getByRole("definition").textContent).toBe("7990")
  })
})
