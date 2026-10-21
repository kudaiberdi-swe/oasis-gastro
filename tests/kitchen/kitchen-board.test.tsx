// @vitest-environment jsdom

import { act, cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const convex = vi.hoisted(() => ({
  tickets: [] as unknown[] | undefined,
  queryArgs: [] as unknown[],
  setStatus: vi.fn(),
}))

vi.mock("convex/react", () => ({
  useQuery: (_ref: unknown, args: unknown) => {
    convex.queryArgs.push(args)
    return args === "skip" ? undefined : convex.tickets
  },
  useMutation: () => convex.setStatus,
  useAction: () => vi.fn(),
}))

import { useNewTicketChime } from "@/kitchen/features/board/model/sound"
import { KitchenBoard } from "@/kitchen/features/board/ui/kitchen-board"

const MINUTE = 60_000

function ticket(overrides: Record<string, unknown> = {}) {
  const id = String(overrides._id ?? `t${Math.random().toString(36).slice(2)}`)
  return {
    _id: id,
    _creationTime: 0,
    orderId: `o-${id}`,
    orderNumber: 100001,
    status: "queued",
    fulfillment: "dine-in",
    source: "pos",
    createdAt: Date.now() - MINUTE,
    updatedAt: Date.now() - MINUTE,
    lines: [{ _id: `l-${id}`, _creationTime: 0, ticketId: id, productExternalId: "p1", productName: "Бешбармак", quantity: 2, instructions: [] }],
    ...overrides,
  }
}

// This Node/jsdom pair exposes no working Web Storage; the kitchen only needs get/set/remove.
function memoryStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  }
}

beforeEach(() => {
  convex.tickets = []
  convex.queryArgs = []
  convex.setStatus = vi.fn().mockResolvedValue(null)
  vi.stubGlobal("localStorage", memoryStorage())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function column(title: string) {
  return screen.getByRole("region", { name: new RegExp(`^${title}`) })
}

describe("KitchenBoard (W1-KDS-02)", () => {
  it("lays tickets out in «Новые / Готовятся / Готово» with counters and one primary per ticket", () => {
    convex.tickets = [
      ticket({ _id: "a", orderNumber: 100001, tableLabel: "5", lines: [{ _id: "la", productName: "Бургер говядина", quantity: 1, instructions: ["БЕЗ ЛУКА", "+СЫР ×2"] }] }),
      ticket({ _id: "b", orderNumber: 100002, status: "preparing", fulfillment: "takeaway", source: "kiosk" }),
      ticket({ _id: "c", orderNumber: 100003, status: "ready", readyAt: Date.now() }),
      ticket({ _id: "d", orderNumber: 99990, status: "completed", completedAt: Date.now() }),
    ]
    render(<KitchenBoard sessionToken="s" />)

    expect(screen.getByRole("heading", { level: 1, name: "Заказы кухни" })).toBeTruthy()
    expect(screen.getByText("3 активных")).toBeTruthy()
    expect(within(column("Новые")).getByRole("heading", { level: 2 }).textContent).toBe("Новые(1)")

    const queued = within(column("Новые")).getByRole("article", { name: "Заказ №100001" })
    expect(within(queued).getByText("Стол 5 · Касса")).toBeTruthy()
    expect(within(queued).getByText("БЕЗ ЛУКА").className).toContain("text-destructive")
    expect(within(queued).getByText("+СЫР ×2").className).toContain("text-accent")
    expect(within(queued).getByRole("button", { name: "Начать готовить" }).className).not.toContain("bg-primary")
    expect(within(queued).queryByRole("button", { name: /Вернуть/ })).toBeNull()

    const preparing = within(column("Готовятся")).getByRole("article", { name: "Заказ №100002" })
    expect(within(preparing).getByText("С собой · Киоск")).toBeTruthy()
    expect(within(preparing).getByRole("button", { name: "Готово" }).className).toContain("bg-primary")
    expect(within(preparing).getByRole("button", { name: "Вернуть в «Новые»" })).toBeTruthy()

    const ready = within(column("Готово")).getByRole("article", { name: "Заказ №100003" })
    expect(within(ready).getByRole("button", { name: "Выдать" }).className).not.toContain("bg-primary")
    // Served tickets are in the journal only.
    expect(screen.queryByRole("article", { name: "Заказ №99990" })).toBeNull()
    expect(document.querySelectorAll("button.bg-primary")).toHaveLength(1)
  })

  it("asks the server for the journal and moves a ticket one step forward or back", async () => {
    convex.tickets = [ticket({ _id: "a" }), ticket({ _id: "b", orderNumber: 100002, status: "preparing" })]
    render(<KitchenBoard sessionToken="s" />)
    expect(convex.queryArgs.at(-1)).toEqual({ sessionToken: "s", prepArea: undefined, includeCompletedLast: 20 })

    await userEvent.click(screen.getByRole("button", { name: "Начать готовить" }))
    expect(convex.setStatus).toHaveBeenCalledWith({ sessionToken: "s", ticketId: "a", status: "preparing" })
    await userEvent.click(screen.getByRole("button", { name: "Вернуть в «Новые»" }))
    expect(convex.setStatus).toHaveBeenCalledWith({ sessionToken: "s", ticketId: "b", status: "queued" })
  })

  it("shows the server's refusal on the ticket", async () => {
    convex.tickets = [ticket({ _id: "a" })]
    convex.setStatus = vi.fn().mockRejectedValue(new Error("Недопустимый переход статуса"))
    render(<KitchenBoard sessionToken="s" />)
    await userEvent.click(screen.getByRole("button", { name: "Начать готовить" }))
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Недопустимый переход статуса")
  })

  it("colors the timer by the thresholds", () => {
    convex.tickets = [
      ticket({ _id: "fresh", orderNumber: 1, createdAt: Date.now() - MINUTE }),
      ticket({ _id: "late", orderNumber: 2, createdAt: Date.now() - 11 * MINUTE }),
      ticket({ _id: "overdue", orderNumber: 3, createdAt: Date.now() - 16 * MINUTE }),
    ]
    render(<KitchenBoard sessionToken="s" />)
    const tone = (number: number) => screen.getByRole("article", { name: `Заказ №${number}` }).dataset.timer
    expect([tone(1), tone(2), tone(3)]).toEqual(["muted", "warning", "danger"])
    expect(screen.getByRole("article", { name: "Заказ №3" }).className).toContain("ring-destructive")
  })

  it("filters by station on the server and remembers the station", async () => {
    render(<KitchenBoard sessionToken="s" />)
    await userEvent.click(screen.getByRole("button", { name: "Бар" }))
    expect(convex.queryArgs.at(-1)).toMatchObject({ prepArea: "bar" })
    expect(screen.getByRole("button", { name: "Бар" }).getAttribute("aria-pressed")).toBe("true")
    expect(window.localStorage.getItem("sandyq-kitchen-station")).toBe("bar")
    await userEvent.click(screen.getByRole("button", { name: "Все" }))
    expect(convex.queryArgs.at(-1)).toMatchObject({ prepArea: undefined })
  })

  it("fades a cancelled ticket out instead of dropping it at once", async () => {
    convex.tickets = [ticket({ _id: "a", orderNumber: 100001 }), ticket({ _id: "b", orderNumber: 100002 })]
    const { rerender } = render(<KitchenBoard sessionToken="s" />)
    convex.tickets = [convex.tickets[1]]
    rerender(<KitchenBoard sessionToken="s" />)

    const fading = document.querySelector('article[aria-label="Заказ №100001"]')
    expect(fading?.getAttribute("aria-hidden")).toBe("true")
    expect(fading?.className).toContain("animate-out")
    expect(screen.getByText("1 активный")).toBeTruthy()
    await waitFor(() => expect(document.querySelector('article[aria-label="Заказ №100001"]')).toBeNull())
  })

  it("lists served tickets in «Выданные» and sends one back to «Готово»", async () => {
    convex.tickets = [ticket({ _id: "d", orderNumber: 99990, status: "completed", completedAt: Date.now() })]
    render(<KitchenBoard sessionToken="s" />)
    await userEvent.click(screen.getByRole("button", { name: /Выданные/ }))
    const dialog = await screen.findByRole("dialog", { name: "Выданные заказы" })
    expect(within(dialog).getByText("№99990")).toBeTruthy()
    await userEvent.click(within(dialog).getByRole("button", { name: "Вернуть" }))
    expect(convex.setStatus).toHaveBeenCalledWith({ sessionToken: "s", ticketId: "d", status: "ready" })
  })

  it("has a sound switch remembered on the device", async () => {
    render(<KitchenBoard sessionToken="s" />)
    const toggle = screen.getByRole("button", { name: "Звук новых заказов включён" })
    expect(toggle.getAttribute("aria-pressed")).toBe("true")
    await userEvent.click(toggle)
    expect(screen.getByRole("button", { name: "Звук новых заказов выключен" })).toBeTruthy()
    expect(window.localStorage.getItem("sandyq-kitchen-sound")).toBe("off")
  })

  it("shows «Выйти» only when the board owns the session", () => {
    const onLock = vi.fn()
    render(<KitchenBoard sessionToken="s" onLock={onLock} restaurantName="Sandyq Алматы" employeeName="Повар" />)
    expect(screen.getByText("Sandyq Алматы · Повар")).toBeTruthy()
    act(() => screen.getByRole("button", { name: "Выйти" }).click())
    expect(onLock).toHaveBeenCalled()
    cleanup()
    render(<KitchenBoard sessionToken="s" />)
    expect(screen.queryByRole("button", { name: "Выйти" })).toBeNull()
  })
})

describe("new ticket chime", () => {
  it("is silent on the first result and on a station switch, chimes on a new ticket when on", () => {
    const play = vi.fn()
    const { rerender } = renderHook((props: { active: string[]; known: string[]; enabled: boolean; resetKey: string }) =>
      useNewTicketChime(props.active, props.known, { enabled: props.enabled, resetKey: props.resetKey, play }),
    { initialProps: { active: ["a"], known: ["x"], enabled: true, resetKey: "all" } })
    expect(play).not.toHaveBeenCalled()

    rerender({ active: ["a", "b"], known: ["x"], enabled: true, resetKey: "all" })
    expect(play).toHaveBeenCalledTimes(1)

    // A served ticket sent back to the board is not new.
    rerender({ active: ["a", "b", "x"], known: [], enabled: true, resetKey: "all" })
    expect(play).toHaveBeenCalledTimes(1)

    rerender({ active: ["c"], known: [], enabled: true, resetKey: "bar" })
    expect(play).toHaveBeenCalledTimes(1)

    rerender({ active: ["c", "d"], known: [], enabled: false, resetKey: "bar" })
    expect(play).toHaveBeenCalledTimes(1)
  })
})
