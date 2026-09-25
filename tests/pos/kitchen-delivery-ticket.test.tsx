// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { KitchenTicket } from "@/kitchen/features/board/data/use-kitchen-board"
import { channelBadge } from "@/kitchen/features/board/model/ticket"
import { TicketCard } from "@/kitchen/features/board/ui/ticket-card"

// W2-KDS-01: a delivery or kiosk ticket carries its channel badge; a delivery one — the courier pickup time.

vi.mock("convex/react", () => ({ useQuery: () => undefined, useMutation: () => vi.fn() }))

afterEach(cleanup)

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    _id: "t1",
    _creationTime: 0,
    orderId: "o1",
    orderNumber: 17,
    status: "queued",
    fulfillment: "delivery",
    source: "delivery",
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now() - 60_000,
    pickupAt: Date.parse("2026-09-25T14:05:00Z"),
    deliveryNumber: "DEL-000017",
    lines: [{ _id: "l1", _creationTime: 0, ticketId: "t1", productExternalId: "p1", productName: "Бешбармак", quantity: 2, instructions: [] }],
    ...overrides,
  } as unknown as KitchenTicket & { status: "queued" }
}

describe("delivery and kiosk tickets on the kitchen board (W2-KDS-01)", () => {
  it("shows «Доставка» with the delivery number and «К выдаче курьеру ЧЧ:ММ» in Almaty time", () => {
    render(<TicketCard ticket={ticket()} now={Date.now()} onSetStatus={vi.fn()} />)
    const card = screen.getByRole("article", { name: "Заказ №17" })
    expect(within(card).getByText("Доставка DEL-000017")).toBeTruthy()
    expect(within(card).getByText("К выдаче курьеру 19:05")).toBeTruthy()
  })

  it("shows «Киоск» without a pickup time and nothing extra for a till ticket", () => {
    render(<TicketCard ticket={ticket({ source: "kiosk", fulfillment: "takeaway", pickupAt: null, deliveryNumber: null })} now={Date.now()} onSetStatus={vi.fn()} />)
    const card = screen.getByRole("article", { name: "Заказ №17" })
    expect(within(card).getByText("Киоск")).toBeTruthy()
    expect(within(card).queryByText(/К выдаче курьеру/)).toBeNull()

    cleanup()
    render(<TicketCard ticket={ticket({ source: "pos", fulfillment: "dine-in", tableLabel: "5", pickupAt: null, deliveryNumber: null })} now={Date.now()} onSetStatus={vi.fn()} />)
    expect(screen.queryByText(/К выдаче курьеру/)).toBeNull()
    expect(channelBadge("pos")).toBeNull()
  })
})
