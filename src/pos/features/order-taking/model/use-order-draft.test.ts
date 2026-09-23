// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useOrderDraft } from "./use-order-draft"

const backend = vi.hoisted(() => ({ saveDraft: vi.fn() }))

vi.mock("../data/use-orders", () => ({
  useOrderMutations: () => backend,
}))

function hydratedCheck(id: string, tableLabel: string, productName: string, unitPrice: number) {
  return {
    _id: id as any,
    version: 1,
    tableLabel,
    discountPercent: 0,
    discountReason: undefined,
    comment: "",
    lines: [{ productId: `${id}-product` as any, productName, unitPrice, quantity: 1, modifiers: [], product: { nameKk: productName } }],
  }
}

describe("useOrderDraft — selection sync", () => {
  beforeEach(() => {
    backend.saveDraft.mockReset()
  })

  function renderDraft(props: { hydrated: ReturnType<typeof hydratedCheck> | null | undefined; initialOrderId: string | null; initialTableLabel?: string; selectionKey: number }) {
    return renderHook((p: typeof props) => useOrderDraft({ sessionToken: "session", terminalExternalId: "terminal-1", orderType: "dine-in", ...p, initialOrderId: p.initialOrderId as any }), {
      initialProps: props,
    })
  }

  it("loads the newly selected check's own data, replacing a previously selected check's", () => {
    const checkA = hydratedCheck("order-a", "Стол 1", "Плов", 2500)
    const checkB = hydratedCheck("order-b", "Стол 2", "Лагман", 1800)

    const { result, rerender } = renderDraft({ hydrated: undefined, initialOrderId: null, selectionKey: 0 })
    expect(result.current.orderId).toBeNull()

    rerender({ hydrated: checkA, initialOrderId: "order-a", selectionKey: 1 })
    expect(result.current.orderId).toBe("order-a")
    expect(result.current.tableLabel).toBe("Стол 1")
    expect(result.current.lines).toHaveLength(1)
    expect(result.current.lines[0].name).toBe("Плов")

    // The regression this guards: switching to a different already-open check must load *its*
    // data, not keep showing check A's under check B's id.
    rerender({ hydrated: checkB, initialOrderId: "order-b", selectionKey: 2 })
    expect(result.current.orderId).toBe("order-b")
    expect(result.current.tableLabel).toBe("Стол 2")
    expect(result.current.lines).toHaveLength(1)
    expect(result.current.lines[0].name).toBe("Лагман")
  })

  it("waits for the matching hydrated data before syncing, instead of flashing stale state under the new id", () => {
    const checkA = hydratedCheck("order-a", "Стол 1", "Плов", 2500)
    const { result, rerender } = renderDraft({ hydrated: checkA, initialOrderId: "order-a", selectionKey: 1 })
    expect(result.current.orderId).toBe("order-a")

    // Selection moved to order-b, but its query hasn't resolved yet (still returns undefined).
    rerender({ hydrated: undefined, initialOrderId: "order-b", selectionKey: 2 })
    expect(result.current.orderId).toBe("order-a")
    expect(result.current.tableLabel).toBe("Стол 1")

    const checkB = hydratedCheck("order-b", "Стол 2", "Лагман", 1800)
    rerender({ hydrated: checkB, initialOrderId: "order-b", selectionKey: 2 })
    expect(result.current.orderId).toBe("order-b")
    expect(result.current.tableLabel).toBe("Стол 2")
  })

  it("resets to a blank draft on every new-check selection, including two in a row", async () => {
    const checkA = hydratedCheck("order-a", "Стол 1", "Плов", 2500)
    const { result, rerender } = renderDraft({ hydrated: checkA, initialOrderId: "order-a", selectionKey: 1 })
    expect(result.current.lines).toHaveLength(1)

    rerender({ hydrated: undefined, initialOrderId: null, selectionKey: 2 })
    expect(result.current.orderId).toBeNull()
    expect(result.current.lines).toEqual([])
    expect(result.current.tableLabel).toBe("")

    backend.saveDraft.mockResolvedValue({ _id: "order-c", version: 1 })
    await act(async () => {
      result.current.addItem({ productId: "product-x", name: "Шай", nameKk: "Шай", price: 500 })
    })
    expect(result.current.lines).toHaveLength(1)

    // A second consecutive "new check" selection (initialOrderId stays null both times) must still
    // reset — this is exactly the case initialOrderId alone can't distinguish, which is why
    // selectionKey exists.
    rerender({ hydrated: undefined, initialOrderId: null, initialTableLabel: "Стол 5", selectionKey: 3 })
    expect(result.current.orderId).toBeNull()
    expect(result.current.lines).toEqual([])
    expect(result.current.tableLabel).toBe("Стол 5")
  })
})
