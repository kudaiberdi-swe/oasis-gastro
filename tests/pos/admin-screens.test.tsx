// @vitest-environment jsdom

import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { AuditLogWorkspace, maskSecrets } from "@/office/features/platform/ui/audit-log-workspace"
import { PeriodLocksWorkspace } from "@/office/features/platform/ui/period-locks-workspace"
import { TerminalsWorkspace } from "@/office/features/platform/ui/terminals-workspace"
import { ToastProvider } from "@/shared/components/ui"
import { almatyBusinessDate } from "@/shared/lib/almaty-time"
import { AUDIT_ACTION_LABELS, AUDIT_ACTION_SUFFIX_LABELS } from "@/shared/lib/audit-actions"

const mocks = vi.hoisted(() => ({
  context: undefined as unknown,
  pages: {} as Record<string, unknown[]>,
  paginatedArgs: {} as Record<string, unknown[]>,
  mutations: {} as Record<string, (...args: unknown[]) => Promise<unknown>>,
}))

const shortName = (reference: FunctionReference<"query" | "mutation">) => getFunctionName(reference).split(":").pop()!

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">) => (shortName(reference) === "context" ? mocks.context : undefined),
  usePaginatedQuery: (reference: FunctionReference<"query">, args: unknown) => {
    const name = shortName(reference)
    ;(mocks.paginatedArgs[name] ??= []).push(args)
    return { results: mocks.pages[name] ?? [], status: "Exhausted", isLoading: false, loadMore: vi.fn() }
  },
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = shortName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

const restaurants = [
  { externalId: "r1", name: "Sandyq Абая" },
  { externalId: "r2", name: "Sandyq Достык" },
]

function terminal(overrides: Record<string, unknown> = {}) {
  return {
    externalId: "r1-01",
    name: "Касса 1",
    terminalNumber: 1,
    kind: "pos",
    active: true,
    lastLoginAt: null,
    appVersion: null,
    heartbeatUrl: null,
    sourceReadOnly: false,
    version: 3,
    restaurantExternalId: "r1",
    restaurantName: "Sandyq Абая",
    ...overrides,
  }
}

beforeEach(() => {
  mocks.context = { ready: true, user: { restaurantScopes: ["*"] }, restaurants, adminRestaurants: restaurants, capabilities: ["*"] }
  mocks.pages = {}
  mocks.paginatedArgs = {}
  mocks.mutations = {
    saveTerminal: vi.fn(async () => "r1-02"),
    setTerminalActive: vi.fn(async () => null),
    createPeriodLock: vi.fn(async () => "lock-1"),
    reopenPeriodLock: vi.fn(async () => null),
  }
})

afterEach(cleanup)

function renderWith(node: ReactNode, capabilities: string[] = ["*"]) {
  return render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={capabilities}>{node}</CapabilitiesProvider>
    </ToastProvider>,
  )
}

describe("«Терминалы» (W1-ADM-02)", () => {
  it("renders the configured columns from the data", () => {
    mocks.pages.listTerminals = [
      terminal({ lastLoginAt: Date.UTC(2026, 8, 20, 4, 30) }),
      terminal({ externalId: "r2-05", name: "Кухня", terminalNumber: 5, kind: "kds", active: false, restaurantExternalId: "r2", restaurantName: "Sandyq Достык" }),
    ]
    renderWith(<TerminalsWorkspace />)
    const table = screen.getByRole("table")
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent)
    expect(headers.slice(0, 6)).toEqual(["Название", "Ресторан", "Номер", "Назначение", "Последний вход", "Статус"])
    const [, first, second] = within(table).getAllByRole("row")
    expect(within(first).getByText("Касса 1")).toBeTruthy()
    expect(within(first).getByText("Касса")).toBeTruthy()
    expect(within(first).getByText("20.09, 09:30")).toBeTruthy()
    expect(within(first).getByText("Активно")).toBeTruthy()
    expect(within(second).getByText("Экран кухни")).toBeTruthy()
    expect(within(second).getByText("—")).toBeTruthy()
    expect(within(second).getByText("Неактивно")).toBeTruthy()
    expect(within(second).getByText("Sandyq Достык")).toBeTruthy()
  })

  it("passes the status tab and restaurant filter to listTerminals", () => {
    renderWith(<TerminalsWorkspace />)
    fireEvent.click(screen.getByRole("tab", { name: "Неактивные" }))
    expect(mocks.paginatedArgs.listTerminals.at(-1)).toEqual({ restaurantExternalId: undefined, status: "inactive" })
  })

  it("«Новый терминал» saves with the right args", async () => {
    renderWith(<TerminalsWorkspace />)
    fireEvent.click(screen.getAllByRole("button", { name: /Новый терминал/ })[0])
    const form = screen.getByRole("form", { name: "Терминал" })
    fireEvent.change(within(form).getByLabelText("Название"), { target: { value: "  Касса 2 " } })
    fireEvent.change(within(form).getByLabelText("Номер"), { target: { value: "2" } })
    fireEvent.click(within(form).getByRole("radio", { name: "Экран кухни" }))
    fireEvent.change(within(form).getByLabelText("Версия приложения"), { target: { value: "1.4.0" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))

    await waitFor(() => expect(mocks.mutations.saveTerminal).toHaveBeenCalledTimes(1))
    expect(mocks.mutations.saveTerminal).toHaveBeenCalledWith({ restaurantExternalId: "r1", name: "Касса 2", terminalNumber: 2, kind: "kds", appVersion: "1.4.0", heartbeatUrl: undefined })
    expect(await screen.findByText("Терминал сохранён")).toBeTruthy()
  })

  it("validates the number before calling the server", () => {
    renderWith(<TerminalsWorkspace />)
    fireEvent.click(screen.getAllByRole("button", { name: /Новый терминал/ })[0])
    const form = screen.getByRole("form", { name: "Терминал" })
    fireEvent.change(within(form).getByLabelText("Название"), { target: { value: "Касса 2" } })
    fireEvent.change(within(form).getByLabelText("Номер"), { target: { value: "1000" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    expect(within(form).getByText("Номер терминала — целое число от 1 до 999")).toBeTruthy()
    expect(mocks.mutations.saveTerminal).not.toHaveBeenCalled()
  })

  it("an iiko terminal keeps name and number read-only; the Switch calls setTerminalActive", async () => {
    mocks.pages.listTerminals = [terminal({ sourceReadOnly: true })]
    renderWith(<TerminalsWorkspace />)
    fireEvent.click(within(screen.getByRole("table")).getByText("Касса 1"))
    const form = screen.getByRole("form", { name: "Терминал" })
    expect(within(form).getByText("Терминал из iiko")).toBeTruthy()
    expect((within(form).getByLabelText("Название") as HTMLInputElement).disabled).toBe(true)
    expect((within(form).getByLabelText("Номер") as HTMLInputElement).disabled).toBe(true)

    fireEvent.click(within(form).getByRole("switch", { name: "Активен" }))
    await waitFor(() => expect(mocks.mutations.setTerminalActive).toHaveBeenCalledWith({ externalId: "r1-01", active: false }))

    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations.saveTerminal).toHaveBeenCalledTimes(1))
    expect(mocks.mutations.saveTerminal).toHaveBeenCalledWith(expect.objectContaining({ externalId: "r1-01", expectedVersion: 3, restaurantExternalId: "r1", kind: "pos" }))
  })

  it("hides «Новый терминал» and «Сохранить» without the edit right", () => {
    mocks.pages.listTerminals = [terminal()]
    renderWith(<TerminalsWorkspace />, ["office.terminals.view"])
    expect(screen.queryByRole("button", { name: /Новый терминал/ })).toBeNull()
    fireEvent.click(within(screen.getByRole("table")).getByText("Касса 1"))
    expect(screen.queryByRole("button", { name: "Сохранить" })).toBeNull()
  })
})

describe("«Закрытие периода» (W1-ADM-03)", () => {
  const lock = {
    _id: "l1",
    _creationTime: 0,
    externalId: "lock-1",
    organizationExternalId: "org",
    restaurantExternalId: "r2",
    moduleId: "receipts",
    kind: "final",
    lockedThrough: 0,
    lockedThroughDate: "2026-08-31",
    active: true,
    reason: "Закрыт август",
    createdBy: "owner@sandyq.test",
    createdAt: 0,
  }

  it("renders the lock columns", () => {
    mocks.pages.listPeriodLocks = [lock, { ...lock, _id: "l2", externalId: "lock-2", restaurantExternalId: undefined, moduleId: undefined, kind: "preliminary", active: false }]
    renderWith(<PeriodLocksWorkspace />)
    const [, first, second] = within(screen.getByRole("table")).getAllByRole("row")
    expect(within(first).getByText("31.08.2026")).toBeTruthy()
    expect(within(first).getByText("Sandyq Достык")).toBeTruthy()
    expect(within(first).getByText("Окончательная")).toBeTruthy()
    expect(within(first).getByText("Приходные накладные")).toBeTruthy()
    expect(within(first).getByText("Действует")).toBeTruthy()
    expect(within(second).getByText("Вся организация")).toBeTruthy()
    expect(within(second).getByText("Предварительная")).toBeTruthy()
    expect(within(second).getByText("Все разделы")).toBeTruthy()
    expect(within(second).getByText("Снят")).toBeTruthy()
  })

  it("the dialog validates the reason and calls createPeriodLock", async () => {
    renderWith(<PeriodLocksWorkspace />)
    fireEvent.click(screen.getByRole("button", { name: "Закрыть период" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Закрыть период" }))
    expect(within(dialog).getByText("Укажите причину закрытия — не короче 3 символов")).toBeTruthy()
    expect(mocks.mutations.createPeriodLock).not.toHaveBeenCalled()

    const input = within(dialog).getByLabelText("Закрыть по дату") as HTMLInputElement
    expect(input.max).toBe(almatyBusinessDate(Date.now()))
    fireEvent.change(input, { target: { value: "2026-08-31" } })
    fireEvent.click(within(dialog).getByRole("radio", { name: "Окончательная" }))
    fireEvent.change(within(dialog).getByLabelText("Причина"), { target: { value: " Сверка августа " } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Закрыть период" }))

    await waitFor(() => expect(mocks.mutations.createPeriodLock).toHaveBeenCalledTimes(1))
    expect(mocks.mutations.createPeriodLock).toHaveBeenCalledWith({ kind: "final", lockedThrough: "2026-08-31", reason: "Сверка августа" })
  })

  it("a restaurant lock sends the restaurant; a future date is refused", async () => {
    renderWith(<PeriodLocksWorkspace />)
    fireEvent.click(screen.getByRole("button", { name: "Закрыть период" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.click(within(dialog).getByRole("switch", { name: "Вся организация" }))
    fireEvent.change(within(dialog).getByLabelText("Закрыть по дату"), { target: { value: "2999-01-01" } })
    fireEvent.change(within(dialog).getByLabelText("Причина"), { target: { value: "Инвентаризация" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Закрыть период" }))
    expect(within(dialog).getByText("Нельзя закрыть будущий период")).toBeTruthy()

    fireEvent.change(within(dialog).getByLabelText("Закрыть по дату"), { target: { value: "2026-09-01" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Закрыть период" }))
    await waitFor(() => expect(mocks.mutations.createPeriodLock).toHaveBeenCalledTimes(1))
    expect(mocks.mutations.createPeriodLock).toHaveBeenCalledWith({ kind: "preliminary", lockedThrough: "2026-09-01", restaurantExternalId: "r1", reason: "Инвентаризация" })
  })

  it("reopening asks for a reason in a danger confirmation", async () => {
    mocks.pages.listPeriodLocks = [lock]
    renderWith(<PeriodLocksWorkspace />)
    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "Открыть период" }))
    const dialog = screen.getByRole("alertdialog")
    const confirm = within(dialog).getByRole("button", { name: "Открыть период" }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText("Причина повторного открытия"), { target: { value: "Исправление прихода" } })
    fireEvent.click(confirm)
    await waitFor(() => expect(mocks.mutations.reopenPeriodLock).toHaveBeenCalledWith({ externalId: "lock-1", reopenReason: "Исправление прихода" }))
  })
})

describe("«Журнал событий» (W1-ADM-04)", () => {
  function event(overrides: Record<string, unknown> = {}) {
    return {
      _id: "a1",
      _creationTime: 0,
      actorKey: "1001",
      action: "session.lock",
      summary: "Касса заблокирована",
      resourceType: "pos-session",
      resourceExternalId: "s-1",
      organizationExternalId: "org",
      restaurantExternalId: "r1",
      occurredAt: Date.UTC(2026, 8, 20, 4, 30),
      ...overrides,
    }
  }

  it("shows Russian action labels with the code in title, resource and area", () => {
    mocks.pages.auditLog = [event(), event({ _id: "a2", actorKey: "owner@sandyq.test", action: "period-lock.create", resourceType: "period-lock", resourceExternalId: "lock-1", restaurantExternalId: undefined })]
    renderWith(<AuditLogWorkspace />)
    const table = screen.getByRole("table")
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent)
    expect(headers.slice(0, 5)).toEqual(["Время", "Актор", "Действие", "Ресурс", "Область"])
    const label = within(table).getByText("Блокировка кассы")
    expect(label.closest("[title]")?.getAttribute("title")).toBe("session.lock")
    expect(within(table).getByText("pos-session · s-1")).toBeTruthy()
    expect(within(table).getByText("Sandyq Абая")).toBeTruthy()
    expect(within(table).getByText("Вся организация")).toBeTruthy()
    expect(within(table).queryByText("session.lock")).toBeNull()
  })

  it("«Касса» filters the loaded page; «Система» asks the server for system-cli", () => {
    mocks.pages.auditLog = [event(), event({ _id: "a2", actorKey: "owner@sandyq.test", action: "terminal.update", resourceType: "terminal" })]
    renderWith(<AuditLogWorkspace />)
    fireEvent.click(screen.getByRole("tab", { name: "Касса" }))
    expect(screen.getByText("Блокировка кассы")).toBeTruthy()
    expect(screen.queryByText("Изменение терминала")).toBeNull()
    fireEvent.click(screen.getByRole("tab", { name: "Офис" }))
    expect(screen.queryByText("Блокировка кассы")).toBeNull()
    expect(screen.getByText("Изменение терминала")).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: "Система" }))
    expect(mocks.paginatedArgs.auditLog.at(-1)).toMatchObject({ actorKey: "system-cli" })
  })

  it("the period filter sends Almaty day bounds", () => {
    renderWith(<AuditLogWorkspace />)
    fireEvent.change(screen.getByLabelText("Период с"), { target: { value: "2026-09-01" } })
    fireEvent.change(screen.getByLabelText("Период по"), { target: { value: "2026-09-01" } })
    expect(mocks.paginatedArgs.auditLog.at(-1)).toMatchObject({ from: Date.UTC(2026, 7, 31, 19, 0), to: Date.UTC(2026, 8, 1, 19, 0) - 1 })
  })

  it("the details panel masks secrets", () => {
    mocks.pages.auditLog = [event({ details: { pin: "1234", nested: { accessToken: "tok-9", clientSecret: "s3", amount: 500 }, list: [{ newPassword: "pw" }] }, correlationId: "corr-7" })]
    renderWith(<AuditLogWorkspace />)
    fireEvent.click(within(screen.getByRole("table")).getByText("1001"))
    const details = screen.getByRole("region", { name: "Подробности" })
    const text = details.textContent ?? ""
    expect(text).toContain('"pin": "•••"')
    expect(text).toContain('"accessToken": "•••"')
    expect(text).toContain('"amount": 500')
    for (const secret of ["1234", "tok-9", "s3", "pw"]) expect(text).not.toContain(`"${secret}"`)
    expect(screen.getByText("corr-7")).toBeTruthy()
    expect(maskSecrets({ Password: "x", PIN_hash: "y", name: "z" })).toEqual({ Password: "•••", PIN_hash: "•••", name: "z" })
  })
})

describe("audit action dictionary", () => {
  const convexRoot = path.resolve(__dirname, "../../convex")

  function sources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) {
        if (name !== "_generated" && name !== "node_modules") sources(full, out)
      } else if (full.endsWith(".ts")) out.push(full)
    }
    return out
  }

  // `action: "x"`, `action: \`x\``, and both branches of `action: cond ? "a" : "b"`.
  const ACTION_EXPRESSION = /\baction:\s*((?:[\w.!]+\s*\?\s*)?(?:"[^"\n]*"|`[^`\n]*`)(?:\s*:\s*(?:"[^"\n]*"|`[^`\n]*`))?)/g
  const LITERAL = /"([^"\n]*)"|`([^`\n]*)`/g

  function collect() {
    const exact = new Set<string>()
    const suffixes = new Set<string>()
    for (const file of sources(convexRoot)) {
      for (const match of readFileSync(file, "utf8").matchAll(ACTION_EXPRESSION)) {
        for (const literal of match[1].matchAll(LITERAL)) {
          const value = literal[1] ?? literal[2]
          if (!value.includes("${")) {
            exact.add(value)
            continue
          }
          // `${module.moduleId}.<suffix>` and `${module.moduleId}.${cond ? "update" : "create"}`: the suffix is labelled.
          const tail = /^\$\{[^}]+\}\.(.+)$/.exec(value)?.[1]
          if (!tail) continue
          if (!tail.includes("${")) suffixes.add(tail)
          for (const inner of tail.matchAll(/"([^"]+)"/g)) suffixes.add(inner[1])
        }
      }
    }
    return { exact, suffixes }
  }

  it("labels every action string written by convex/**", () => {
    const { exact, suffixes } = collect()
    expect(exact.size).toBeGreaterThan(20)
    expect([...exact].filter((action) => !AUDIT_ACTION_LABELS[action])).toEqual([])
    expect([...suffixes].filter((suffix) => !AUDIT_ACTION_SUFFIX_LABELS[suffix])).toEqual([])
  })

  it("labels the dynamic suffixes of the domain-record engine and the cash operations", () => {
    for (const suffix of ["create", "update", "post", "reverse", "cancel", "submit", "approve", "publish", "activate", "deactivate", "expire"]) {
      expect(AUDIT_ACTION_SUFFIX_LABELS[suffix], suffix).toBeTruthy()
    }
    // `shift.${args.direction}` (domains/shifts/mutations.ts): cash-in / cash-out.
    expect(AUDIT_ACTION_LABELS["shift.cash-in"]).toBeTruthy()
    expect(AUDIT_ACTION_LABELS["shift.cash-out"]).toBeTruthy()
  })
})
