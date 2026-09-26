// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { cardSaveArgs, cardDraftOf, validateCard } from "@/office/features/integrations/model/cards"
import { EgaisUnavailable } from "@/office/features/integrations/ui/egais-unavailable"
import { IntegrationCardsWorkspace } from "@/office/features/integrations/ui/integration-register"
import { ToastProvider } from "@/shared/components/ui"

// W3-INT-01 integration cards and W3-INT-02 ЕГАИС. Cards are synthetic; no secret value exists anywhere.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  rows: [] as Record<string, unknown>[],
  paginatedArgs: [] as unknown[],
  mutations: {} as Record<string, ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<unknown>>>>,
}))

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => {
    if (args === "skip") return undefined
    const value = mocks.queries[getFunctionName(reference)]
    return typeof value === "function" ? (value as (args: unknown) => unknown)(args) : value
  },
  usePaginatedQuery: (_reference: FunctionReference<"query">, args: unknown) => {
    mocks.paginatedArgs.push(args)
    return { results: mocks.rows, status: "Exhausted", loadMore: vi.fn(), isLoading: false }
  },
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

const fn = (name: string) => `domains/integrations/cards:${name}`

const CARD = {
  _id: "k1",
  _creationTime: 0,
  externalId: "integration-messaging-1",
  moduleId: "integration-messaging",
  number: "SYS-2026-00011",
  name: "Интеграция messaging",
  status: "inactive",
  organizationExternalId: "sandyq",
  provider: "resend-mobizon",
  mode: "production",
  endpoint: "",
  secretRef: "RESEND_API_KEY",
  direction: "outbound",
  schedule: "",
  maxAttempts: 5,
  mapping: "{}",
  settings: { channel: "both" },
  secretConfigured: false,
  version: 2,
  createdBy: "admin@sandyq.test",
  createdAt: 0,
  updatedAt: 0,
  lastSyncAt: null,
  errors: 3,
  errorsCapped: false,
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture ??= () => false
  mocks.rows = [CARD]
  mocks.paginatedArgs = []
  mocks.queries = {
    [fn("getIntegrationCard")]: (args: { externalId: string }) => (args.externalId === CARD.externalId ? CARD : null),
    [fn("integrationReferences")]: { organizations: [{ externalId: "sandyq", name: "Sandyq", jurisdiction: "KZ" }] },
    [fn("providerKeys")]: [
      { name: "RESEND_API_KEY", set: false },
      { name: "MOBIZON_API_KEY", set: false },
    ],
  }
  mocks.mutations = {
    [fn("saveIntegrationCard")]: vi.fn(async () => ({ externalId: "integration-messaging-2", number: "SYS-2026-00012", version: 1 })),
    [fn("transitionIntegrationCard")]: vi.fn(async () => ({ version: 3 })),
  }
})

afterEach(cleanup)

function renderAt(path: string, element = <IntegrationCardsWorkspace moduleId="integration-messaging" />, capabilities = ["*"]) {
  const router = createMemoryRouter([{ path: "/office/:section/:id?", element }], { initialEntries: [path] })
  render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={capabilities}>
        <RouterProvider router={router} />
      </CapabilitiesProvider>
    </ToastProvider>,
  )
}

describe("integration cards (W3-INT-01)", () => {
  it("publish tabs, the §5 columns and «Подключение»", () => {
    renderAt("/office/integration-messaging")
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Все", "Черновики", "Опубликованные", "Неактивные"])
    const table = screen.getByRole("table", { name: "SMS и email" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Название", "Провайдер", "Режим", "Последняя синхронизация", "Ошибок", "Статус"])
    expect(within(table).getByText("Production")).toBeTruthy()
    expect(within(table).getByText("Неактивно")).toBeTruthy()
    expect(within(table).getByText("3")).toBeTruthy()
    expect(screen.getByPlaceholderText("Поиск: SMS и email")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Подключение" })).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: "Опубликованные" }))
    expect(mocks.paginatedArgs.at(-1)).toEqual({ moduleId: "integration-messaging", status: "published" })
  })

  it("the card shows only the secret's name and whether it is set, the provider keys, and publishes", async () => {
    renderAt(`/office/integration-messaging/${CARD.externalId}`)
    const form = await screen.findByRole("form", { name: "Карточка интеграции" })
    expect((within(form).getByLabelText("Ссылка на секрет") as HTMLInputElement).value).toBe("RESEND_API_KEY")
    expect(within(form).getByText("Переменная RESEND_API_KEY не задана — опубликовать можно только в sandbox.")).toBeTruthy()
    expect(within(form).getByText(/Пока ключа нет/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Опубликовать" }))
    await waitFor(() => expect(mocks.mutations[fn("transitionIntegrationCard")]).toHaveBeenCalledWith({ externalId: CARD.externalId, action: "publish", expectedVersion: 2 }))
  })

  it("model: a literal-looking secret reference and bad JSON are caught before the server", () => {
    const draft = { ...cardDraftOf("integration-1c", null, "sandyq"), name: "1С", secretRef: "sk_live_123", mapping: "{ bad" }
    expect(validateCard(draft)).toMatchObject({ secretRef: expect.stringContaining("не сам секрет"), mapping: "Некорректный JSON" })
    const args = cardSaveArgs("integration-1c", { ...draft, secretRef: "ONEC_API_TOKEN", mapping: "{}", settings: { format: "xml", iban: "KZ" } }, null)
    expect(args).toMatchObject({ moduleId: "integration-1c", organizationExternalId: "sandyq", settings: { format: "xml" } })
    expect(args.settings).not.toHaveProperty("iban")
  })
})

describe("ЕГАИС (W3-INT-02)", () => {
  it("«Недоступно для KZ» with the jurisdiction, a link to fiscal services and no «Новая запись»", () => {
    renderAt("/office/integration-egais", <EgaisUnavailable />)
    expect(screen.getByRole("heading", { name: "Недоступно для KZ" })).toBeTruthy()
    expect(screen.getByText("Для алкогольного и фискального учёта Казахстана используйте интеграции ОФД/ККМ.")).toBeTruthy()
    expect(screen.getByText("Текущая юрисдикция: KZ. Конфигурация ЕГАИС не активируется и не отправляет задания обмена.")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Перейти к фискальным сервисам" }).getAttribute("href")).toBe("/office/integration-fiscal")
    expect(screen.queryByRole("button", { name: /Новая запись|Подключение/ })).toBeNull()
  })
})
