// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { canCancelJob, canRetryJob, providerLabel } from "@/office/features/corporation/model/corporation"
import { IntegrationJobsWorkspace } from "@/office/features/corporation/ui/integration-jobs-workspace"
import { ToastProvider } from "@/shared/components/ui"

// W2-ADM-09 «Очередь интеграций». Jobs are synthetic; no provider is called.

const mocks = vi.hoisted(() => ({
  jobs: [] as Record<string, unknown>[],
  details: {} as Record<string, unknown>,
  paginatedArgs: [] as unknown[],
  mutations: {} as Record<string, (...args: unknown[]) => Promise<unknown>>,
}))

const LIST = "domains/integrations/queries:listIntegrationJobs"
const GET = "domains/integrations/queries:getIntegrationJob"
const RETRY = "domains/integrations/mutations:retryIntegrationJob"
const CANCEL = "domains/integrations/mutations:cancelIntegrationJob"

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => {
    if (args === "skip") return undefined
    const name = getFunctionName(reference)
    if (name === LIST) {
      const { status } = args as { status?: string }
      return { page: mocks.jobs.filter((job) => !status || job.status === status), isDone: true, continueCursor: "" }
    }
    if (name === GET) return mocks.details[(args as { externalId: string }).externalId] ?? null
    return undefined
  },
  usePaginatedQuery: (_reference: FunctionReference<"query">, args: unknown) => {
    mocks.paginatedArgs.push(args)
    const { status } = args as { status?: string }
    return { results: mocks.jobs.filter((job) => !status || job.status === status), status: "Exhausted", loadMore: vi.fn(), isLoading: false }
  },
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

function job(overrides: Record<string, unknown> = {}) {
  return {
    _id: "j1",
    _creationTime: 0,
    externalId: "job-1",
    provider: "convex-event-bus",
    direction: "outbound",
    operation: "restaurant.updated",
    idempotencyKey: "outbox:event-064b85",
    status: "completed",
    attempts: 1,
    payload: {},
    nextAttemptAt: 0,
    createdAt: Date.UTC(2026, 8, 4, 10, 18, 56),
    updatedAt: Date.UTC(2026, 8, 4, 10, 18, 56),
    ...overrides,
  }
}

const BANK = job({ _id: "j2", externalId: "job-2", provider: "bank", direction: "inbound", operation: "statement", idempotencyKey: "bank:1", status: "dead-letter", attempts: 5, error: "Адаптер «bank» не настроен" })
const QUEUED = job({ _id: "j3", externalId: "job-3", provider: "fiscal", operation: "historical-sync", idempotencyKey: "history-job-3", status: "queued", attempts: 0 })

beforeEach(() => {
  mocks.jobs = [job(), BANK, QUEUED]
  mocks.details = {
    "job-2": { ...BANK, payload: { account: "KZ00TEST", apiKey: "••••" } },
    "job-3": { ...QUEUED },
    "job-1": { ...job(), result: { delivered: true } },
  }
  mocks.paginatedArgs = []
  mocks.mutations = { [RETRY]: vi.fn(async () => null), [CANCEL]: vi.fn(async () => null) }
})

afterEach(cleanup)

function renderWith(node: ReactNode, capabilities: string[] = ["*"]) {
  return render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={capabilities}>{node}</CapabilitiesProvider>
    </ToastProvider>,
  )
}

describe("«Очередь интеграций» (W2-ADM-09)", () => {
  it("«Повторить» only for failed/dead-letter, «Отменить» only for a job still in the queue", () => {
    for (const status of ["failed", "dead-letter"]) expect(canRetryJob(status)).toBe(true)
    for (const status of ["queued", "processing", "retrying", "completed", "cancelled"]) expect(canRetryJob(status)).toBe(false)
    for (const status of ["queued", "retrying"]) expect(canCancelJob(status)).toBe(true)
    for (const status of ["processing", "completed", "failed", "dead-letter", "cancelled"]) expect(canCancelJob(status)).toBe(false)
    expect(providerLabel("convex-event-bus")).toBe("Шина событий")
    expect(providerLabel("new-provider")).toBe("New provider")
  })

  it("shows the configured columns with readable providers and Russian statuses", () => {
    renderWith(<IntegrationJobsWorkspace />)
    expect(screen.getByText("Adapter runtime")).toBeTruthy()
    const table = screen.getByRole("table")
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent)
    expect(headers.slice(0, 7)).toEqual(["Провайдер", "Направление", "Операция", "Ключ / ошибка", "Попытки", "Статус", "Время"])
    const [, first, second] = within(table).getAllByRole("row")
    expect(within(first).getByText("Шина событий")).toBeTruthy()
    expect(within(first).getByText("Исходящее")).toBeTruthy()
    expect(within(first).getByText("outbox:event-064b85")).toBeTruthy()
    expect(within(first).getByText("Готово")).toBeTruthy()
    expect(within(second).getByText("Банк")).toBeTruthy()
    expect(within(second).getByText("Входящее")).toBeTruthy()
    expect(within(second).getByText("Адаптер «bank» не настроен")).toBeTruthy()
    expect(within(second).getByText("Не доставлено")).toBeTruthy()
  })

  it("status tabs have counters and filter on the server", () => {
    renderWith(<IntegrationJobsWorkspace />)
    expect(screen.getByRole("tab", { name: /Все/ }).textContent).toBe("Все3")
    expect(screen.getByRole("tab", { name: /Не доставлено/ }).textContent).toBe("Не доставлено1")
    expect(screen.getByRole("tab", { name: /Ошибки/ }).textContent).toBe("Ошибки0")
    fireEvent.click(screen.getByRole("tab", { name: /Не доставлено/ }))
    expect(mocks.paginatedArgs.at(-1)).toEqual({ status: "dead-letter", provider: undefined })
  })

  it("search filters by key and error text", () => {
    renderWith(<IntegrationJobsWorkspace />)
    fireEvent.change(screen.getByLabelText("Поиск заданий"), { target: { value: "не настроен" } })
    const rows = within(screen.getByRole("table")).getAllByRole("row")
    expect(rows).toHaveLength(2)
    expect(within(rows[1]).getByText("Банк")).toBeTruthy()
  })

  it("a dead-letter job: masked payload in the card, «Повторить» sends it back", async () => {
    renderWith(<IntegrationJobsWorkspace />)
    fireEvent.click(screen.getByText("Банк"))
    const payload = await screen.findByRole("region", { name: "Данные задания" })
    expect(payload.textContent).toContain("KZ00TEST")
    expect(payload.textContent).toContain("••••")
    expect(screen.queryByRole("button", { name: /Отменить/ })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /Повторить/ }))
    await waitFor(() => expect(mocks.mutations[RETRY]).toHaveBeenCalledWith({ externalId: "job-2" }))
    expect(await screen.findByText("Задание отправлено на повтор")).toBeTruthy()
  })

  it("a completed job has neither «Повторить» nor «Отменить»", async () => {
    renderWith(<IntegrationJobsWorkspace />)
    fireEvent.click(screen.getByText("Шина событий"))
    expect(await screen.findByRole("region", { name: "Результат" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Повторить/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /Отменить/ })).toBeNull()
  })

  it("«Отменить» a queued job asks for confirmation first", async () => {
    renderWith(<IntegrationJobsWorkspace />)
    fireEvent.click(screen.getByText("Фискализация"))
    expect(screen.queryByRole("button", { name: /Повторить/ })).toBeNull()
    fireEvent.click(await screen.findByRole("button", { name: /Отменить/ }))
    const dialog = await screen.findByRole("alertdialog")
    expect(mocks.mutations[CANCEL]).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("button", { name: "Отменить задание" }))
    await waitFor(() => expect(mocks.mutations[CANCEL]).toHaveBeenCalledWith({ externalId: "job-3" }))
  })

  it("without the edit right the card has no actions", async () => {
    renderWith(<IntegrationJobsWorkspace />, ["office.integration-jobs.view"])
    fireEvent.click(screen.getByText("Банк"))
    expect(await screen.findByRole("region", { name: "Данные задания" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Повторить/ })).toBeNull()
  })
})
