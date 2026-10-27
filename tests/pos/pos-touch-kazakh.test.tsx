// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { ConvexError } from "convex/values"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PosRail } from "@/pos/components/pos-rail"
import { OrderPanel, showServiceCharge, type OrderTypeOption } from "@/pos/components/order-panel"
import { ProductCard } from "@/pos/components/product-card"
import { groupHint } from "@/pos/features/catalog/model/modifier-selection"
import { RefundPanel } from "@/pos/features/history/ui/refund-panel"
import type { OrderDraftLine } from "@/pos/features/order-taking/model/draft-lines"
import { OrderActionsDialog } from "@/pos/features/order-taking/ui/order-actions-dialog"
import { LoginScreen } from "@/pos/features/session/ui/login-screen"
import { ProfileDialog } from "@/pos/features/session/ui/profile-dialog"
import { ThemeProvider } from "@/shared/components/theme-provider"
import { Banner, StatusPill } from "@/shared/components/ui"
import { buttonVariants } from "@/shared/components/ui/button"
import { DEFAULT_ERROR_MESSAGE, errorMessage, NETWORK_ERROR_MESSAGE } from "@/shared/lib/error-message"

// POS redesign, items 3–7: 48px targets and Kazakh names, direct copy, distilled header/catalog/actions,
// distinct status colors, the Sandyq logo and pressed feedback.

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute("data-theme")
  document.documentElement.removeAttribute("data-density")
  try {
    window.localStorage.clear()
  } catch {
    // storage blocked: nothing to reset
  }
})

describe("ProductCard — Kazakh name and the media area", () => {
  it("shows the Kazakh name second with lang=kk on up to two lines", () => {
    render(<ProductCard name="Бешбармак" nameKk="Бешбармақ ет тағамы" price={5990} onClick={() => {}} />)
    const kk = screen.getByText("Бешбармақ ет тағамы")
    expect(kk.getAttribute("lang")).toBe("kk")
    expect(kk.className).toContain("line-clamp-2")
  })

  it("hides the Kazakh line when it repeats the Russian name", () => {
    render(<ProductCard name="Айран" nameKk="Айран" price={700} onClick={() => {}} />)
    expect(document.querySelector('[lang="kk"]')).toBeNull()
  })

  it("a card without a photo keeps the same 4:3 rounded media area with a placeholder, not a taller body", () => {
    render(
      <>
        <ProductCard name="Бешбармак" nameKk="Бешбармақ" price={5990} imageUrl="/images/beshbarmak.jpg" onClick={() => {}} />
        <ProductCard name="Айран" nameKk="Айран" price={700} onClick={() => {}} />
      </>,
    )
    const media = screen.getAllByTestId("dish-photo")
    expect(media).toHaveLength(2)
    for (const area of media) expect(area.className).toContain("aspect-[4/3]")
    for (const area of media) expect(area.className).toContain("rounded-card")
    expect(screen.getAllByTestId("dish-placeholder")).toHaveLength(1)
    // The placeholder is an icon: it is not part of the card's name.
    expect(screen.getByRole("button", { name: /^Айран/ }).textContent?.startsWith("Айран")).toBe(true)
  })

  it("a broken photo falls back to the placeholder instead of the browser's broken-image glyph", () => {
    render(<ProductCard name="Шұбат" nameKk="Шұбат" price={850} imageUrl="/images/missing.jpg" onClick={() => {}} />)
    const image = document.querySelector("img")!
    expect(screen.queryByTestId("dish-placeholder")).toBeNull()
    fireEvent.error(image)
    expect(document.querySelector("img")).toBeNull()
    expect(screen.getByTestId("dish-placeholder")).toBeTruthy()
  })

  it("the ☆ zone is 48px", () => {
    render(<ProductCard name="Бешбармак" nameKk="Бешбармақ" price={5990} onClick={() => {}} onToggleFavorite={() => {}} />)
    expect(screen.getByRole("button", { name: "В избранное: Бешбармак" }).className).toContain("size-12")
  })
})

const DINE_IN: OrderTypeOption = { value: "dine-in", label: "В зале", mode: "dine-in" }
const TAKEAWAY: OrderTypeOption = { value: "takeaway", label: "С собой", mode: "takeaway" }

function line(overrides: Partial<OrderDraftLine> = {}): OrderDraftLine {
  return { clientLineId: "l1", productId: "p1", name: "Бешбармак", nameKk: "Бешбармақ", unitPrice: 5000, quantity: 2, modifiers: [], modifierLabels: [], ...overrides }
}

function renderPanel(props: Partial<Parameters<typeof OrderPanel>[0]> = {}) {
  return render(
    <OrderPanel
      tableLabel="Стол 7"
      lines={[line()]}
      itemCount={2}
      orderTypeOptions={[DINE_IN, TAKEAWAY]}
      orderTypeValue="dine-in"
      onOrderTypeChange={() => {}}
      subtotal={10_000}
      discountPercent={0}
      discountAmount={0}
      serviceChargePercent={15}
      serviceChargeAmount={1500}
      total={11_500}
      saving={false}
      error={null}
      canSendToKitchen
      onIncrement={() => {}}
      onDecrement={() => {}}
      onRemove={() => {}}
      onVoid={() => {}}
      onSendToKitchen={() => {}}
      onHold={() => {}}
      onCheckout={() => {}}
      onDiscount={() => {}}
      onGuest={() => {}}
      onMore={() => {}}
      {...props}
    />,
  )
}

describe("OrderPanel — service charge, Kazakh lines, 48px targets", () => {
  it("shows «Қызмет ақысы» in the hall and hides it for takeaway and at 0 %", () => {
    expect(showServiceCharge({ mode: "dine-in", percent: 15, amount: 0 })).toBe(true)
    expect(showServiceCharge({ mode: "takeaway", percent: 15, amount: 0 })).toBe(false)
    expect(showServiceCharge({ mode: "dine-in", percent: 0, amount: 0 })).toBe(false)
    // Money the server did charge is never hidden, so the lines still add up to «К оплате».
    expect(showServiceCharge({ mode: "takeaway", percent: 15, amount: 900 })).toBe(true)

    renderPanel()
    expect(screen.getByText(/сервисный сбор 15%/)).toBeTruthy()
    cleanup()
    renderPanel({ orderTypeValue: "takeaway", serviceChargeAmount: 0, total: 10_000 })
    expect(screen.queryByText(/сервисный сбор/)).toBeNull()
    cleanup()
    renderPanel({ serviceChargePercent: 0, serviceChargeAmount: 0, total: 10_000 })
    expect(screen.queryByText(/сервисный сбор/)).toBeNull()
  })

  it("a line shows the Kazakh name second with lang=kk", () => {
    renderPanel({ lines: [line(), line({ clientLineId: "l2", name: "Айран", nameKk: "Айран" })] })
    const kk = screen.getByText("Бешбармақ")
    expect(kk.getAttribute("lang")).toBe("kk")
    expect(screen.getAllByText("Айран")).toHaveLength(1)
  })

  it("steppers, the bin and the action bar are 48px; the bin is apart from the line total", () => {
    renderPanel()
    for (const name of ["Убрать одну порцию: Бешбармак", "Добавить порцию: Бешбармак", "Удалить: Бешбармак"]) expect(screen.getByRole("button", { name }).className).toContain("size-12")
    for (const name of ["Скидка", "На кухню", "Отложить", "Ещё"]) expect(screen.getByRole("button", { name }).className).toContain("h-16")
    const bin = screen.getByRole("button", { name: "Удалить: Бешбармак" })
    expect(bin.parentElement?.className).toContain("justify-between")
  })
})

const ACCESS = {
  employee: { id: "e1", code: "101", displayName: "Айгерим", role: "cashier" as const },
  restaurant: { id: "r", externalId: "almaty", name: "Sandyq Алматы", city: "Алматы" },
  terminal: { id: "t", externalId: "t1", name: "Главная касса", terminalNumber: 1 },
}

function renderProfile() {
  return render(
    <ThemeProvider>
      <ProfileDialog open onOpenChange={() => {}} access={ACCESS as never} attendance={null} onClockIn={async () => {}} onClockOut={async () => {}} onLock={() => {}} onLogout={() => {}} />
    </ThemeProvider>,
  )
}

describe("ProfileDialog — screen settings moved out of the header", () => {
  it("switches the theme and the density", () => {
    renderProfile()
    const theme = screen.getByRole("radiogroup", { name: "Тема" })
    expect(within(theme).getByRole("radio", { name: "Дневная" }).getAttribute("aria-checked")).toBe("true")
    fireEvent.click(within(theme).getByRole("radio", { name: "Ночная" }))
    expect(document.documentElement.dataset.theme).toBe("night")
    const density = screen.getByRole("radiogroup", { name: "Плотность" })
    fireEvent.click(within(density).getByRole("radio", { name: "Плотная" }))
    expect(document.documentElement.dataset.density).toBe("compact")
  })

  it("«Язык интерфейса»: Russian active by default, Kazakh available (no «скоро»)", () => {
    renderProfile()
    const language = screen.getByRole("radiogroup", { name: "Язык интерфейса" })
    expect(within(language).getByRole("radio", { name: "Русский" }).getAttribute("aria-checked")).toBe("true")
    const kazakh = within(language).getByRole("radio", { name: "Қазақша" })
    expect(kazakh).toHaveProperty("disabled", false)
    expect(within(kazakh).getByText("Қазақша").getAttribute("lang")).toBe("kk")
    expect(screen.queryByText(/скоро/)).toBeNull()
  })
})

describe("PosRail — logo, no theme/density toggles, readable shift and badge", () => {
  function renderHeader(props: Partial<Parameters<typeof PosRail>[0]> = {}) {
    return render(
      <PosRail restaurantName="Алматы" employeeName="Айгерим" shiftNumber={12} shiftOpenedAt={Date.UTC(2026, 8, 26, 4, 41)} onOpenShiftInfo={() => {}} onNotifications={() => {}} onLock={() => {}} {...props} />,
    )
  }

  it("draws the OASIS Gastro mark with an explicit height and alt «OASIS Gastro»", () => {
    renderHeader()
    const logo = screen.getByRole("img", { name: "OASIS Gastro" })
    expect(logo.getAttribute("src")).toBe("/branding/oasis-gastro-mark.svg")
    expect(logo.getAttribute("height")).toBe("64")
    expect(document.querySelector("header svg path[d^='M20 6']")).toBeNull()
  })

  it("has no theme or density button (they live in the profile)", () => {
    renderHeader()
    expect(screen.queryByRole("button", { name: /тема/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /плотн/i })).toBeNull()
  })

  it("labels the time in the shift pill as the opening time", () => {
    renderHeader()
    const pill = screen.getByRole("button", { name: "Смена №12, открыта в 09:41" })
    // «Смена №12» on the 96px rail, «№12» on the 72px one, then the opening time.
    expect(pill.textContent).toBe("Смена №12№1209:41")
  })

  it("the unread badge is set at 14px", () => {
    renderHeader({ unreadNotifications: 3 })
    const badge = screen.getByText("3")
    expect(badge.className).toContain("text-body-sm")
    expect(badge.className).not.toContain("text-caption")
  })
})

describe("LoginScreen — terminal and branch", () => {
  it("shows the terminal label and a 14px caption", () => {
    render(<LoginScreen onLogin={vi.fn()} terminalLabel="Sandyq · Алматы · Главная касса" />)
    expect(screen.getByText("Sandyq · Алматы · Главная касса")).toBeTruthy()
    const caption = screen.getByText(/Пароль офиса здесь не подходит/)
    expect(caption.className).toContain("text-body-sm")
    expect(caption.className).not.toContain("text-caption")
  })
})

describe("OrderActionsDialog — frequent tiles first, the rest under «Ещё»", () => {
  it("shows four primary tiles and a quieter «Ещё» list; no developer phrasing", () => {
    const onAction = vi.fn()
    render(<OrderActionsDialog open onOpenChange={() => {}} blocks={{}} lines={[line({ serverLineId: "ol1" })]} onAction={onAction} onVoidLine={() => {}} />)
    const more = screen.getByRole("region", { name: "Ещё" })
    expect(within(more).getAllByRole("button")).toHaveLength(3)
    for (const name of [/Удалить позицию/, /Перенести на кассу/, /Отменить заказ/]) expect(within(more).getByRole("button", { name })).toBeTruthy()
    const dialog = screen.getByRole("dialog")
    const primary = within(dialog).getAllByRole("button").filter((button) => !more.contains(button) && button.getAttribute("aria-label") !== "Закрыть")
    expect(primary.map((button) => button.querySelector(".font-semibold")?.textContent)).toEqual(["Печать предчека", "Комментарий", "Перенести на стол", "Разделить чек"])
    expect(dialog.textContent).not.toContain("Браузерная")
    fireEvent.click(within(more).getByRole("button", { name: /Отменить заказ/ }))
    expect(onAction).toHaveBeenCalledWith("cancel")
  })

  it("Esc closes it (Radix; nothing blocks onEscapeKeyDown)", () => {
    const onOpenChange = vi.fn()
    render(<OrderActionsDialog open onOpenChange={onOpenChange} blocks={{}} lines={[]} onAction={() => {}} onVoidLine={() => {}} />)
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe("RefundPanel — Kazakh names in the list", () => {
  it("shows the dish's Kazakh name second with lang=kk and 48px steppers", () => {
    render(
      <RefundPanel
        order={{ _id: "o1", number: 100_001, subtotal: 3300, total: 3300, lines: [{ _id: "ol-1", productName: "Бешбармак", productNameKk: "Бешбармақ", quantity: 2, unitPrice: 1650, lineTotal: 3300 }], payments: [{ type: "sale", method: "card", amount: 3300 }] }}
        onClose={() => {}}
        onRefund={async () => {}}
        onManagerRequired={async () => null}
      />,
    )
    expect(screen.getByText("Бешбармақ").getAttribute("lang")).toBe("kk")
    expect(screen.getByRole("button", { name: "Больше: Бешбармак" }).className).toContain("size-12")
  })
})

describe("copy", () => {
  it("modifier group rules read as a person would say them", () => {
    expect(groupHint({ minQuantity: 0, maxQuantity: 1, freeQuantity: 0, required: false })).toBe("не больше 1")
    expect(groupHint({ minQuantity: 0, maxQuantity: 2, freeQuantity: 1, required: false })).toBe("не больше 2 · 1 бесплатно")
    expect(groupHint({ minQuantity: 1, maxQuantity: 1, freeQuantity: 0, required: true })).toBe("выберите 1")
    expect(groupHint({ minQuantity: 1, maxQuantity: 3, freeQuantity: 0, required: true })).toBe("от 1 до 3")
    expect(groupHint({ minQuantity: 0, maxQuantity: 99, freeQuantity: 0, required: false })).toBe("")
  })

  it("server and network errors in short direct Russian", () => {
    expect(errorMessage(new ConvexError("Сначала откройте кассовую смену"))).toBe("Сначала откройте кассовую смену")
    expect(errorMessage(new Error("[CONVEX M(domains/orders/mutations:checkout)] [Request ID: 1a2b] Server Error"))).toBe(DEFAULT_ERROR_MESSAGE)
    expect(errorMessage(new Error("[CONVEX M(x)] Server Error"), "Не удалось отложить заказ")).toBe("Не удалось отложить заказ")
    expect(errorMessage(new TypeError("Failed to fetch"))).toBe(NETWORK_ERROR_MESSAGE)
    expect(errorMessage(new Error("Connection lost while action was in flight"))).toBe(NETWORK_ERROR_MESSAGE)
    expect(errorMessage(new Error("ArgumentValidationError: Value does not match validator."))).toBe("Проверьте введённые данные.")
    expect(errorMessage(new ConvexError({ code: "SESSION_EXPIRED" }))).toBe("Сессия истекла. Войдите снова.")
    expect(errorMessage(new ConvexError({ code: "UNKNOWN_CODE" }))).toBe(DEFAULT_ERROR_MESSAGE)
    expect(errorMessage(new Error("[CONVEX M(x)] Нет доступа к ресторану"))).toBe("Нет доступа к ресторану")
    expect(errorMessage("weird")).toBe(DEFAULT_ERROR_MESSAGE)
  })
})

describe("status colors and pressed feedback", () => {
  it("warning and danger banners use distinct opaque tints", () => {
    render(
      <>
        <Banner tone="warning" title="Смена открыта более 24 часов" />
        <Banner tone="danger" title="Нет связи" />
      </>,
    )
    expect(screen.getByRole("status").className).toContain("bg-warning-surface")
    expect(screen.getByRole("alert").className).toContain("bg-destructive-surface")
  })

  it("«Отложен», «Возвращён» and «Оплачен» are three different tones", () => {
    render(
      <>
        <StatusPill domain="order" status="held" />
        <StatusPill domain="order" status="refunded" />
        <StatusPill domain="order" status="paid" />
      </>,
    )
    expect(screen.getByText("Отложен").className).toContain("text-warning-foreground")
    expect(screen.getByText("Возвращён").className).toContain("text-destructive-muted")
    expect(screen.getByText("Оплачен").className).toContain("bg-success-surface")
  })

  it("the base button sinks 1px on press, 150ms, and not under reduced motion", () => {
    const classes = buttonVariants({})
    expect(classes).toContain("active:translate-y-px")
    expect(classes).toContain("duration-150")
    expect(classes).toContain("motion-reduce:active:translate-y-0")
  })
})
