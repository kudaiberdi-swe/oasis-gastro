// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { ConvexError } from "convex/values"
import { afterEach, describe, expect, it, vi } from "vitest"

import { OrderPanel, type OrderTypeOption } from "@/pos/components/order-panel"
import { ProductCard } from "@/pos/components/product-card"
import { PaymentDialog } from "@/pos/features/checkout/ui/payment-dialog"
import type { OrderDraftLine } from "@/pos/features/order-taking/model/draft-lines"
import { checkAge } from "@/pos/features/order-taking/ui/floor-grid"
import { orderActionBlocks, orderTypeOptions } from "@/pos/features/order-taking/ui/pos-workspace"
import { LoginScreen } from "@/pos/features/session/ui/login-screen"
import { ProfileDialog } from "@/pos/features/session/ui/profile-dialog"
import {
  bilingualName,
  createTranslator,
  formatMessage,
  LOCALE_STORAGE_KEY,
  LocaleProvider,
  messageParams,
  MESSAGES,
  pluralForm,
  posErrorMessage,
  readStoredLocale,
  useLocale,
  type Locale,
} from "@/pos/i18n"
import { kk } from "@/pos/i18n/kk"
import { ru } from "@/pos/i18n/ru"
import { ThemeProvider } from "@/shared/components/theme-provider"
import { Dialog, DialogContent, DialogTitle, StatusPill } from "@/shared/components/ui"

// The RU/KK interface language of the cashier POS (PRODUCT.md: «Kazakh + Russian interface is required»).

afterEach(() => {
  cleanup()
  document.documentElement.setAttribute("lang", "ru")
  try {
    window.localStorage.clear()
  } catch {
    // storage blocked: nothing to reset
  }
  vi.restoreAllMocks()
})

describe("dictionaries", () => {
  it("kk has every ru key and no other, and no message is empty", () => {
    const ruKeys = Object.keys(ru).sort()
    expect(Object.keys(kk).sort()).toEqual(ruKeys)
    for (const locale of ["ru", "kk"] as Locale[]) {
      for (const [key, text] of Object.entries(MESSAGES[locale])) expect(text.trim(), `${locale} ${key}`).not.toBe("")
    }
  })

  it("kk asks for the same parameters as ru in every message", () => {
    for (const key of Object.keys(ru) as Array<keyof typeof ru>) expect(messageParams(kk[key]), key).toEqual([...new Set(messageParams(ru[key]))])
  })

  it("Kazakh texts are written in Kazakh Cyrillic, not copied from Russian", () => {
    const same = (Object.keys(ru) as Array<keyof typeof ru>).filter((key) => ru[key] === kk[key] && /[а-яё]{4,}/i.test(ru[key]))
    // Only words that are the same in both languages (Касса, Кассир, Менеджер, Экран, Зал …) may repeat.
    expect(same.every((key) => /^(Касса|Кассир|Менеджер|Экран|Зал|Баланс|Карта|PIN-код|Профиль: \{name\}|лимит \{amount\}|\{minutes\} мин)$/.test(ru[key]))).toBe(true)
    expect(Object.values(kk).some((text) => /[әғқңөұүһі]/.test(text))).toBe(true)
  })
})

describe("interpolation and plurals", () => {
  it("Russian agrees with the numeral: 1 / 2–4 / 5+, 11–14 take the many form", () => {
    const forms = ["позиция", "позиции", "позиций"]
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map((count) => pluralForm("ru", count, forms))).toEqual([
      "позиция",
      "позиции",
      "позиции",
      "позиций",
      "позиций",
      "позиций",
      "позиций",
      "позиция",
      "позиции",
      "позиций",
      "позиция",
      "позиций",
    ])
  })

  it("Kazakh keeps the noun singular after any number", () => {
    expect([1, 2, 5, 21].map((count) => pluralForm("kk", count, ["позиция", "позиции", "позиций"]))).toEqual(["позиция", "позиция", "позиция", "позиция"])
    const kkT = createTranslator("kk")
    expect(kkT("order.positions", { count: 5 })).toBe("5 позиция")
    expect(kkT("floor.places", { count: 4 })).toBe("4 орын")
  })

  it("fills names and numbers; an unknown parameter stays visible", () => {
    const ruT = createTranslator("ru")
    expect(ruT("order.positions", { count: 3 })).toBe("3 позиции")
    expect(ruT("floor.checks", { count: 12 })).toBe("12 чеков")
    expect(ruT("pos.stopList", { name: "Бешбармак" })).toBe("«Бешбармак» сейчас в стоп-листе")
    expect(formatMessage("{a} и {b}", { a: 1 }, "ru")).toBe("1 и {b}")
  })

  it("model helpers default to Russian and follow the translator they are given", () => {
    const kkT = createTranslator("kk")
    expect(orderTypeOptions([]).map((option) => option.label)).toEqual(["В зале", "С собой", "Доставка"])
    expect(orderTypeOptions([], kkT).map((option) => option.label)).toEqual(["Залда", "Алып кету", "Жеткізу"])
    expect(orderActionBlocks({ orderId: null, lines: [], transferTargets: undefined }, kkT).cancel).toBe("Тапсырыс әлі сақталмаған")
    expect(checkAge(0, 65 * 60_000)).toBe("1 ч 05 мин")
    expect(checkAge(0, 65 * 60_000, kkT)).toBe("1 сағ 05 мин")
  })
})

describe("client-side errors", () => {
  it("maps known codes and the network line to Kazakh; a server's Russian message passes as it is", () => {
    const kkT = createTranslator("kk")
    expect(posErrorMessage(kkT, new ConvexError({ code: "FORBIDDEN" }))).toBe("Рұқсат жоқ.")
    expect(posErrorMessage(kkT, new Error("Failed to fetch"))).toBe("Байланыс жоқ. Қайталаңыз.")
    expect(posErrorMessage(kkT, new ConvexError("Смена уже закрыта"))).toBe("Смена уже закрыта")
    expect(posErrorMessage(kkT, new Error("Server Error"), kkT("login.failed"))).toBe("Кіру мүмкін болмады")
    expect(posErrorMessage(createTranslator("ru"), new ConvexError({ code: "FORBIDDEN" }))).toBe("Нет доступа.")
  })
})

function LocaleProbe() {
  const { locale } = useLocale()
  return <output data-testid="locale">{locale}</output>
}

describe("LocaleProvider", () => {
  it("reads the terminal's stored language, defaults to ru, survives blocked storage", () => {
    expect(readStoredLocale()).toBe("ru")
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "kk")
    expect(readStoredLocale()).toBe("kk")
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "en")
    expect(readStoredLocale()).toBe("ru")
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    expect(readStoredLocale()).toBe("ru")
  })

  it("a reload keeps the chosen language, and <html lang> follows it", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "kk")
    render(
      <LocaleProvider>
        <LocaleProbe />
        <LoginScreen onLogin={vi.fn()} />
      </LocaleProvider>,
    )
    expect(screen.getByTestId("locale").textContent).toBe("kk")
    expect(screen.getByRole("heading", { name: "Кассаға кіру" })).toBeTruthy()
    expect(document.documentElement.getAttribute("lang")).toBe("kk")
  })

  it("switching on the sign-in screen applies at once and is remembered on the terminal", () => {
    render(
      <LocaleProvider>
        <LoginScreen onLogin={vi.fn()} />
      </LocaleProvider>,
    )
    expect(screen.getByRole("heading", { name: "Вход в кассу" })).toBeTruthy()
    expect(screen.getByText("Код сотрудника")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Язык интерфейса" }))
    expect(screen.getByRole("heading", { name: "Кассаға кіру" })).toBeTruthy()
    expect(screen.getByText("Қызметкер коды")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Әрі қарай" })).toBeTruthy()
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("kk")
    expect(document.documentElement.getAttribute("lang")).toBe("kk")
    // The link names the other language in itself.
    expect(within(screen.getByRole("button", { name: "Интерфейс тілі" })).getByText("Русский").getAttribute("lang")).toBe("ru")
  })

  it("«Язык интерфейса» in the profile switches the dialog without a reload", () => {
    const access = {
      employee: { id: "e1", code: "101", displayName: "Айгерим", role: "cashier" as const },
      restaurant: { id: "r", externalId: "almaty", name: "Sandyq Алматы", city: "Алматы" },
      terminal: { id: "t", externalId: "t1", name: "Главная касса", terminalNumber: 1 },
    }
    render(
      <LocaleProvider>
        <ThemeProvider>
          <ProfileDialog open onOpenChange={() => {}} access={access as never} attendance={null} onClockIn={async () => {}} onClockOut={async () => {}} onLock={() => {}} onLogout={() => {}} />
        </ThemeProvider>
      </LocaleProvider>,
    )
    expect(screen.getByRole("heading", { name: "Профиль сотрудника" })).toBeTruthy()
    act(() => {
      fireEvent.click(within(screen.getByRole("radiogroup", { name: "Язык интерфейса" })).getByRole("radio", { name: "Қазақша" }))
    })
    expect(screen.getByRole("heading", { name: "Қызметкер профилі" })).toBeTruthy()
    expect(screen.getByText(/Кассир · коды 101/)).toBeTruthy()
    expect(within(screen.getByRole("radiogroup", { name: "Интерфейс тілі" })).getByRole("radio", { name: "Қазақша" }).getAttribute("aria-checked")).toBe("true")
    expect(screen.getByRole("button", { name: "Жабу" })).toBeTruthy()
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("kk")
  })

  it("shared primitives speak the POS language only inside the provider (the office stays Russian)", () => {
    render(
      <>
        <StatusPill domain="order" status="held" />
        <LocaleProvider initialLocale="kk">
          <StatusPill domain="order" status="HELD" />
          <StatusPill domain="order" status="partially_refunded" />
        </LocaleProvider>
      </>,
    )
    expect(screen.getByText("Отложен")).toBeTruthy()
    expect(screen.getByText("Кейінге қалдырылды")).toBeTruthy()
    expect(screen.getByText("Ішінара қайтарылды")).toBeTruthy()
    cleanup()
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Офис</DialogTitle>
        </DialogContent>
      </Dialog>,
    )
    expect(screen.getByRole("button", { name: "Закрыть" })).toBeTruthy()
  })
})

const DINE_IN: OrderTypeOption = { value: "dine-in", label: "Залда", mode: "dine-in" }

function line(overrides: Partial<OrderDraftLine> = {}): OrderDraftLine {
  return { clientLineId: "l1", productId: "p1", name: "Бешбармак", nameKk: "Бешбармақ", unitPrice: 5000, quantity: 2, modifiers: [], modifierLabels: ["без лука"], modifierLabelsKk: ["пиязсыз"], ...overrides }
}

function renderPanel(locale: Locale, props: Partial<Parameters<typeof OrderPanel>[0]> = {}) {
  return render(
    <LocaleProvider initialLocale={locale}>
      <OrderPanel
        tableLabel=""
        lines={[line()]}
        itemCount={2}
        orderTypeOptions={[DINE_IN]}
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
      />
    </LocaleProvider>,
  )
}

describe("order panel in Kazakh", () => {
  it("buttons, totals and the empty state read in Kazakh; the Kazakh dish name leads", () => {
    renderPanel("kk")
    expect(screen.getByRole("button", { name: /^Төлеу 11/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Кейінге қалдыру" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Ас үйге" })).toBeTruthy()
    expect(screen.getByText("Төлеуге")).toBeTruthy()
    expect(screen.getByText("2 позиция")).toBeTruthy()
    expect(screen.getByText("Қызмет ақысы")).toBeTruthy()
    expect(screen.queryByText(/сервисный сбор/)).toBeNull()
    const primary = screen.getByText("Бешбармақ")
    const secondary = screen.getByText("Бешбармак")
    expect(primary.getAttribute("lang")).toBe("kk")
    expect(primary.className).toContain("font-semibold")
    expect(secondary.getAttribute("lang")).toBe("ru")
    expect(primary.compareDocumentPosition(secondary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Modifier details follow: Kazakh first.
    const kkDetails = screen.getByText("пиязсыз")
    expect(kkDetails.compareDocumentPosition(screen.getByText("без лука")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole("button", { name: "Бір порцияны алып тастау: Бешбармақ" })).toBeTruthy()
    cleanup()
    renderPanel("kk", { lines: [], itemCount: 0 })
    expect(screen.getByText("Тапсырыс әзірге бос")).toBeTruthy()
  })

  it("stays Russian by default", () => {
    renderPanel("ru")
    expect(screen.getByRole("button", { name: /^Оплатить 11/ })).toBeTruthy()
    expect(screen.getByText("2 позиции")).toBeTruthy()
    expect(screen.getByText("Бешбармак").getAttribute("lang")).toBe("ru")
    expect(screen.getByText("Бешбармақ").getAttribute("lang")).toBe("kk")
  })
})

describe("payment in Kazakh", () => {
  it("the dialog, the legacy methods and the confirm button switch language", () => {
    render(
      <LocaleProvider initialLocale="kk">
        <PaymentDialog open onOpenChange={() => {}} total={3000} orderNumber={42} itemCount={2} submitting={false} error={null} onSubmit={vi.fn()} />
      </LocaleProvider>,
    )
    expect(screen.getByRole("heading", { name: "Тапсырысты төлеу" })).toBeTruthy()
    expect(screen.getByText("№42 тапсырыс")).toBeTruthy()
    expect(screen.getByText(/2 позиция · чекті жабу үшін/)).toBeTruthy()
    fireEvent.click(screen.getByRole("radio", { name: /Қолма-қол/ }))
    expect(screen.getByRole("button", { name: /^Растау · 3/ })).toBeTruthy()
    expect(screen.getByText("Қайтарымсыз")).toBeTruthy()
    expect(screen.getByRole("radio", { name: /Аралас төлем/ })).toBeTruthy()
  })
})

describe("dish card: the interface language's name first", () => {
  it("ru: Russian first, Kazakh second; kk: the other way round", () => {
    render(
      <LocaleProvider initialLocale="ru">
        <ProductCard name="Бешбармак" nameKk="Бешбармақ" price={5990} onClick={() => {}} onToggleFavorite={() => {}} />
      </LocaleProvider>,
    )
    const [ruFirst, ruSecond] = [screen.getByText("Бешбармак"), screen.getByText("Бешбармақ")]
    expect(ruFirst.getAttribute("lang")).toBe("ru")
    expect(ruFirst.className).toContain("font-semibold")
    expect(ruSecond.getAttribute("lang")).toBe("kk")
    cleanup()
    render(
      <LocaleProvider initialLocale="kk">
        <ProductCard name="Бешбармак" nameKk="Бешбармақ" price={5990} onClick={() => {}} onToggleFavorite={() => {}} available={false} />
      </LocaleProvider>,
    )
    const [kkFirst, kkSecond] = [screen.getByText("Бешбармақ"), screen.getByText("Бешбармак")]
    expect(kkFirst.getAttribute("lang")).toBe("kk")
    expect(kkFirst.className).toContain("font-semibold")
    expect(kkSecond.getAttribute("lang")).toBe("ru")
    expect(kkFirst.compareDocumentPosition(kkSecond) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText("қолда жоқ")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Таңдаулыға қосу: Бешбармақ" })).toBeTruthy()
    expect(screen.getByTestId("dish-placeholder")).toBeTruthy()
  })

  it("a dish without a Kazakh name shows only the Russian one in both languages", () => {
    render(
      <LocaleProvider initialLocale="kk">
        <ProductCard name="Капучино" nameKk="" price={1200} onClick={() => {}} />
      </LocaleProvider>,
    )
    expect(screen.getByText("Капучино").getAttribute("lang")).toBe("ru")
    expect(document.querySelectorAll("p[lang]")).toHaveLength(1)
  })

  it("bilingualName falls back gracefully", () => {
    expect(bilingualName("kk", { name: "Айран", nameKk: "Айран" })).toEqual({ primary: { text: "Айран", lang: "ru" }, secondary: null })
    expect(bilingualName("kk", { name: "Шай", nameKk: null })).toEqual({ primary: { text: "Шай", lang: "ru" }, secondary: null })
    expect(bilingualName("kk", { name: "Чай", nameKk: "Шай" })).toEqual({ primary: { text: "Шай", lang: "kk" }, secondary: { text: "Чай", lang: "ru" } })
    expect(bilingualName("ru", { name: "Чай", nameKk: "Шай" })).toEqual({ primary: { text: "Чай", lang: "ru" }, secondary: { text: "Шай", lang: "kk" } })
  })
})
