// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { axe } from "jest-axe"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  Button,
  Checkbox,
  Chip,
  Combobox,
  Field,
  formatMoneyDigits,
  Input,
  MoneyInput,
  NumericCodeInput,
  SegmentedControl,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui"
import { cn } from "@/shared/lib/utils"

afterEach(cleanup)

async function expectNoAxeViolations(container: HTMLElement) {
  // color-contrast needs real layout; scripts/check-contrast.mjs covers the tokens instead.
  const results = await axe(container, { rules: { "color-contrast": { enabled: false } } })
  expect(results.violations.map((violation) => violation.id)).toEqual([])
}

describe("cn keeps the theme type scale next to a text color", () => {
  it("does not drop text-foreground when text-body-sm is present", () => {
    expect(cn("text-body-sm text-foreground")).toBe("text-body-sm text-foreground")
    expect(cn("text-body text-title")).toBe("text-title")
    expect(cn("rounded-control rounded-card")).toBe("rounded-card")
  })
})

describe("Button", () => {
  it("defaults to type=button so it never submits a form by accident", async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Button>Отмена</Button>
        <Button type="submit">Сохранить</Button>
      </form>,
    )
    await userEvent.click(screen.getByRole("button", { name: "Отмена" }))
    expect(onSubmit).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it("is reachable by Tab and activated by Space and Enter", async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Оплатить</Button>)
    await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Оплатить" }))
    await userEvent.keyboard(" ")
    await userEvent.keyboard("{Enter}")
    expect(onClick).toHaveBeenCalledTimes(2)
  })
})

describe("Field", () => {
  it("labels the control and points aria-describedby at the error", async () => {
    const { container } = render(<Field label="Email" error="Введите email">{(control) => <Input {...control} />}</Field>)
    const input = screen.getByLabelText("Email")
    expect(input.getAttribute("aria-invalid")).toBe("true")
    const describedBy = input.getAttribute("aria-describedby")
    expect(describedBy && document.getElementById(describedBy)?.textContent).toBe("Введите email")
    await expectNoAxeViolations(container)
  })

  it("uses the hint when there is no error", () => {
    render(<Field label="Название" hint="Как в меню">{(control) => <Input {...control} />}</Field>)
    const input = screen.getByLabelText("Название")
    expect(input.getAttribute("aria-invalid")).toBeNull()
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toBe("Как в меню")
  })
})

describe("MoneyInput", () => {
  it("formats «12500» as «12 500» with thin-space groups", () => {
    expect(formatMoneyDigits("12500")).toBe("12 500")
    expect(formatMoneyDigits("1250000")).toBe("1 250 000")
    expect(formatMoneyDigits("007")).toBe("7")
  })

  it("reports whole tenge while the cashier types", async () => {
    function Harness() {
      const [value, setValue] = useState<number | null>(null)
      return (
        <>
          <Field label="Получено">{(control) => <MoneyInput {...control} value={value} onValueChange={setValue} />}</Field>
          <output>{value === null ? "пусто" : value}</output>
        </>
      )
    }
    render(<Harness />)
    const input = screen.getByLabelText("Получено") as HTMLInputElement
    expect(input.inputMode).toBe("numeric")
    await userEvent.type(input, "12500")
    expect(input.value).toBe("12 500")
    expect(screen.getByRole("status").textContent).toBe("12500")
    await userEvent.clear(input)
    expect(screen.getByRole("status").textContent).toBe("пусто")
  })
})

describe("NumericCodeInput", () => {
  it("keeps digits only, caps the length and never looks like a password field", async () => {
    function Harness() {
      const [pin, setPin] = useState("")
      return <Field label="PIN">{(control) => <NumericCodeInput {...control} secret value={pin} onValueChange={setPin} maxLength={6} />}</Field>
    }
    render(<Harness />)
    const input = screen.getByLabelText("PIN") as HTMLInputElement
    await userEvent.type(input, "12a34-5678")
    expect(input.value).toBe("123456")
    expect(input.type).toBe("text")
    expect(input.autocomplete).toBe("off")
    expect(input.name).not.toMatch(/pass|email/i)
  })
})

describe("Checkbox and Switch", () => {
  it("toggle with Space", async () => {
    render(
      <>
        <label>
          <Checkbox /> Активен
        </label>
        <label>
          <Switch /> В меню
        </label>
      </>,
    )
    const checkbox = screen.getByRole("checkbox", { name: "Активен" })
    checkbox.focus()
    await userEvent.keyboard(" ")
    expect(checkbox.getAttribute("aria-checked")).toBe("true")

    const toggle = screen.getByRole("switch", { name: "В меню" })
    toggle.focus()
    await userEvent.keyboard(" ")
    expect(toggle.getAttribute("aria-checked")).toBe("true")
  })
})

describe("SegmentedControl", () => {
  it("moves the selection with arrow keys", async () => {
    function Harness() {
      const [value, setValue] = useState<"hall" | "takeaway" | "delivery">("hall")
      return (
        <SegmentedControl
          aria-label="Тип заказа"
          value={value}
          onValueChange={setValue}
          options={[{ value: "hall", label: "В зале" }, { value: "takeaway", label: "Навынос" }, { value: "delivery", label: "Доставка" }]}
        />
      )
    }
    const { container } = render(<Harness />)
    screen.getByRole("radio", { name: "В зале" }).focus()
    await userEvent.keyboard("{ArrowRight}")
    await waitFor(() => expect(screen.getByRole("radio", { name: "Навынос" }).getAttribute("aria-checked")).toBe("true"))
    await expectNoAxeViolations(container)
  })
})

describe("Tabs", () => {
  it("switches panels with arrow keys and shows the count", async () => {
    render(
      <Tabs defaultValue="open">
        <TabsList aria-label="Чеки">
          <TabsTrigger value="open" count={4}>Открытые</TabsTrigger>
          <TabsTrigger value="held">Отложенные</TabsTrigger>
        </TabsList>
        <TabsContent value="open">Стол 4</TabsContent>
        <TabsContent value="held">Стол 2</TabsContent>
      </Tabs>,
    )
    expect(screen.getByRole("tab", { name: /Открытые/ })).toBeTruthy()
    screen.getByRole("tab", { name: /Открытые/ }).focus()
    await userEvent.keyboard("{ArrowRight}")
    expect(screen.getByRole("tabpanel").textContent).toBe("Стол 2")
  })
})

describe("Chip", () => {
  it("exposes its active state as aria-pressed", () => {
    render(
      <>
        <Chip active tone="meat">Ет</Chip>
        <Chip>Шай</Chip>
      </>,
    )
    expect(screen.getByRole("button", { name: "Ет" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: "Шай" }).getAttribute("aria-pressed")).toBe("false")
  })
})

describe("Combobox (multiple)", () => {
  it("shows the selection as chips that can be removed", async () => {
    function Harness() {
      const [value, setValue] = useState(["almaty", "shymkent"])
      return (
        <Combobox
          multiple
          aria-label="Рестораны"
          value={value}
          onValueChange={setValue}
          options={[{ value: "almaty", label: "Алматы" }, { value: "shymkent", label: "Шымкент" }]}
        />
      )
    }
    render(<Harness />)
    expect(screen.getByRole("combobox", { name: "Рестораны" }).textContent).toContain("Выбрано: 2")
    await userEvent.click(screen.getByRole("button", { name: "Убрать Алматы" }))
    expect(screen.queryByRole("button", { name: "Убрать Алматы" })).toBeNull()
    expect(screen.getByRole("combobox", { name: "Рестораны" }).textContent).toContain("Выбрано: 1")
  })
})
