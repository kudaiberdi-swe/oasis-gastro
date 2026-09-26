// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createScanDetector, SCAN_MAX_GAP_MS } from "@/pos/features/hotkeys/model/barcode-scanner"
import { hotkeyAction, isEditableTarget } from "@/pos/features/hotkeys/model/hotkeys"
import { BARCODE_FIELD_ATTRIBUTE, useBarcodeScanner, usePosHotkeys, type PosHotkeyHandlers, type ScanSource } from "@/pos/features/hotkeys/ui/use-pos-hotkeys"
import { ProfileDialog } from "@/pos/features/session/ui/profile-dialog"
import { Dialog, DialogContent, DialogTitle } from "@/shared/components/ui"

// W3-POS-01: F2 search, F4 payment, F8 hold, Esc close — never inside a field or a dialog; the barcode
// scanner is fast keyboard input ending with Enter.

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("barcode scan detector", () => {
  it("takes a fast burst ending with Enter and ignores the same keys typed by hand", () => {
    const detector = createScanDetector()
    const feed = (keys: string[], gap: number, start = 0) => keys.map((key, index) => detector.key(key, start + index * gap))
    expect(feed([..."4870200012345", "Enter"], 8).at(-1)).toBe("4870200012345")
    expect(feed([..."4870200012345", "Enter"], 150, 10_000).at(-1)).toBeNull()
    // Too short for a code (a person hitting Enter after two fast keys).
    expect(feed(["1", "2", "Enter"], 5, 20_000).at(-1)).toBeNull()
    // A hand-typed prefix before the scan is not part of the code.
    detector.key("9", 30_000)
    expect(feed([..."SQ-0001", "Enter"], 5, 30_000 + SCAN_MAX_GAP_MS + 100).at(-1)).toBe("SQ-0001")
    // Arrow keys in the middle break the burst.
    expect(feed(["1", "2", "3", "ArrowDown", "4", "5", "6", "Enter"], 5, 40_000).at(-1)).toBeNull()
  })
})

describe("hotkey map", () => {
  it("maps F2/F4/F8/Esc and never fires inside fields, dialogs or with modifiers", () => {
    const button = document.createElement("button")
    const input = document.createElement("input")
    document.body.append(button, input)
    const key = (value: string, target: EventTarget, extra: Partial<KeyboardEvent> = {}) =>
      hotkeyAction({ key: value, target, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, repeat: false, defaultPrevented: false, ...extra })
    expect(["F2", "F4", "F8", "Escape"].map((value) => key(value, button))).toEqual(["search", "pay", "hold", "close"])
    expect(key("F4", input)).toBeNull()
    expect(key("F4", button, { ctrlKey: true })).toBeNull()
    expect(key("F4", button, { repeat: true })).toBeNull()
    expect(key("F5", button)).toBeNull()
    expect(isEditableTarget(input)).toBe(true)
    const dialog = document.createElement("div")
    dialog.setAttribute("role", "dialog")
    document.body.append(dialog)
    expect(key("F4", button)).toBeNull()
    document.body.replaceChildren()
  })
})

function Harness({ handlers, onScan }: { handlers: PosHotkeyHandlers; onScan: (code: string, source: ScanSource) => void }) {
  usePosHotkeys(handlers)
  useBarcodeScanner(onScan)
  return (
    <div>
      <button type="button">Карточка</button>
      <input aria-label="Поиск" {...BARCODE_FIELD_ATTRIBUTE} />
      <input aria-label="Комментарий" />
    </div>
  )
}

function type(target: Element, text: string, gapMs: number) {
  for (const key of [...text, "Enter"]) {
    fireEvent.keyDown(target, { key })
    vi.advanceTimersByTime(gapMs)
  }
}

describe("cashier screen keyboard", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-09-26T06:00:00Z"))
  })

  it("F4 opens the payment and F8 holds from the screen; inside the comment field nothing happens", () => {
    const handlers = { pay: vi.fn(), hold: vi.fn(), search: vi.fn(), close: vi.fn(() => false) }
    render(<Harness handlers={handlers} onScan={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole("button", { name: "Карточка" }), { key: "F4" })
    fireEvent.keyDown(document.body, { key: "F8" })
    expect(handlers.pay).toHaveBeenCalledTimes(1)
    expect(handlers.hold).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByLabelText("Комментарий"), { key: "F4" })
    fireEvent.keyDown(screen.getByLabelText("Поиск"), { key: "F8" })
    expect(handlers.pay).toHaveBeenCalledTimes(1)
    expect(handlers.hold).toHaveBeenCalledTimes(1)
    // Esc with nothing to close keeps its default.
    expect(fireEvent.keyDown(document.body, { key: "Escape" })).toBe(true)
    expect(fireEvent.keyDown(document.body, { key: "F2" })).toBe(false)
  })

  it("a scan adds the item: from the screen and from the search field, not from another field or by hand", () => {
    const onScan = vi.fn()
    render(<Harness handlers={{}} onScan={onScan} />)
    type(screen.getByRole("button", { name: "Карточка" }), "4870200012345", 5)
    expect(onScan).toHaveBeenLastCalledWith("4870200012345", { fromField: false })
    type(screen.getByLabelText("Поиск"), "SQ-0001", 5)
    expect(onScan).toHaveBeenLastCalledWith("SQ-0001", { fromField: true })
    type(screen.getByLabelText("Комментарий"), "4870200012345", 5)
    type(document.body, "4870200012345", 120)
    expect(onScan).toHaveBeenCalledTimes(2)
  })

  it("ignores a scan while a dialog is open", () => {
    const onScan = vi.fn()
    render(
      <>
        <Harness handlers={{}} onScan={onScan} />
        <Dialog open>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Оплата</DialogTitle>
            <button type="button">Наличные</button>
          </DialogContent>
        </Dialog>
      </>,
    )
    type(screen.getByRole("button", { name: "Наличные" }), "4870200012345", 5)
    expect(onScan).not.toHaveBeenCalled()
  })
})

describe("hints in «Профиль сотрудника»", () => {
  it("lists the keys and the scanner", () => {
    render(
      <ProfileDialog
        open
        onOpenChange={() => {}}
        access={{ employee: { id: "e1", code: "101", displayName: "Айгерим", role: "cashier" }, restaurant: { externalId: "r", name: "Sandyq Абая" }, terminal: { externalId: "t", name: "Касса 1" } } as never}
        attendance={null}
        onClockIn={async () => {}}
        onClockOut={async () => {}}
        onLock={() => {}}
        onLogout={() => {}}
      />,
    )
    const hints = screen.getByRole("region", { name: "Горячие клавиши" })
    expect([...hints.querySelectorAll("kbd")].map((node) => node.textContent)).toEqual(["F2", "F4", "F8", "Esc"])
    expect(hints.textContent).toContain("Отложить заказ")
    expect(hints.textContent).toContain("Сканер штрихкодов")
  })
})
