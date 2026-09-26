// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { audienceLine, campaignSaveArgs, smsInfo, validateCampaign, type CampaignDraft } from "@/office/features/loyalty/model/campaigns"
import { almatyMoment } from "@/office/features/loyalty/model/reservations"
import { CampaignsWorkspace } from "@/office/features/loyalty/ui/campaigns-register"
import { ToastProvider } from "@/shared/components/ui"

// W3-LOY-08 «Рассылки и акции». Campaigns and guests are synthetic; nothing is sent.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  paginatedArgs: [] as unknown[],
  rows: [] as Record<string, unknown>[],
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

const fn = (name: string) => `domains/loyalty/campaigns:${name}`

const CAMPAIGN = {
  _id: "c1",
  _creationTime: 0,
  externalId: "campaign-1",
  number: "CMP-2026-00001",
  name: "Комбо выходного дня",
  organizationExternalId: "sandyq",
  status: "approved",
  channel: "sms",
  categoryExternalId: "vip",
  restaurantExternalIds: ["*"],
  scheduledAt: Date.parse("2026-08-04T12:00:00+05:00"),
  quietHoursStart: 9,
  quietHoursEnd: 20,
  audienceCount: 120,
  sentCount: 0,
  failedCount: 120,
  enqueueState: "done",
  version: 3,
  createdBy: "admin@sandyq.test",
  createdAt: 0,
  updatedAt: 0,
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture ??= () => false
  mocks.paginatedArgs = []
  mocks.rows = [CAMPAIGN]
  mocks.queries = {
    "domains/office/queries:context": { adminRestaurants: [{ externalId: "r1", name: "Sandyq Абая" }], user: { restaurantScopes: ["*"] } },
    [fn("campaignReferences")]: { categories: [{ externalId: "vip", name: "VIP" }] },
    [fn("campaignAudience")]: { count: 42, capped: false },
    [fn("getCampaign")]: (args: { externalId: string }) => (args.externalId === "campaign-1" ? { ...CAMPAIGN, template: "Скидка 20 %", jobsPending: false } : null),
  }
  mocks.mutations = {
    [fn("saveCampaign")]: vi.fn(async () => ({ externalId: "campaign-new", number: "CMP-2026-00002", version: 1 })),
    [fn("transitionCampaign")]: vi.fn(async () => ({ status: "completed", version: 4 })),
  }
})

afterEach(cleanup)

function renderAt(path: string, capabilities: string[] = ["*"]) {
  const router = createMemoryRouter([{ path: "/office/:section/:id?", element: <CampaignsWorkspace /> }], { initialEntries: [path] })
  render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={capabilities}>
        <RouterProvider router={router} />
      </CapabilitiesProvider>
    </ToastProvider>,
  )
  return router
}

describe("«Рассылки и акции» (W3-LOY-08)", () => {
  it("approval tabs and the §5 columns: name, channel, audience, sent with errors, period, status", () => {
    renderAt("/office/campaigns")
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Все", "Черновики", "На согласовании", "Согласованные", "Проведённые"])
    const table = screen.getByRole("table", { name: "Рассылки и акции" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Название", "Канал", "Аудитория", "Отправлено", "Период", "Статус"])
    expect(within(table).getByText("Комбо выходного дня")).toBeTruthy()
    expect(within(table).getByText("VIP")).toBeTruthy()
    expect(within(table).getByText("Вся сеть")).toBeTruthy()
    expect(within(table).getByText("0 из 120")).toBeTruthy()
    expect(within(table).getByText("ошибок: 120")).toBeTruthy()
    expect(within(table).getByText("окно 09:00–20:00")).toBeTruthy()
    expect(screen.getByPlaceholderText("Поиск: рассылки и акции")).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: "Проведённые" }))
    expect(mocks.paginatedArgs.at(-1)).toEqual({ status: "completed" })
  })

  it("a new campaign: the SMS counter, the recipients preview and the save arguments", async () => {
    renderAt("/office/campaigns/new")
    const form = await screen.findByRole("form", { name: "Кампания" })
    fireEvent.change(within(form).getByLabelText("Название"), { target: { value: "Осенний сет" } })
    fireEvent.change(within(form).getByLabelText("Сообщение"), { target: { value: "Осенний сет в Sandyq −15 %" } })
    expect(within(form).getByText("26 символов · 1 SMS")).toBeTruthy()
    expect(await within(form).findByText("Будет отправлено 42 гостям с согласием")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }))
    await waitFor(() => expect(mocks.mutations[fn("saveCampaign")]).toHaveBeenCalled())
    expect(mocks.mutations[fn("saveCampaign")].mock.calls[0][0]).toMatchObject({ name: "Осенний сет", channel: "sms", restaurantExternalIds: ["r1"], quietHoursStart: 10, quietHoursEnd: 20, template: "Осенний сет в Sandyq −15 %" })
  })

  it("an approved campaign whose queue is empty is read-only with counters and «Провести»", async () => {
    renderAt("/office/campaigns/campaign-1")
    const form = await screen.findByRole("form", { name: "Кампания" })
    expect(within(form).queryByLabelText("Название")).toBeNull()
    expect(within(form).getByText("Все сообщения обработаны — кампанию можно провести.")).toBeTruthy()
    expect(within(form).getByRole("region", { name: "Отправка" }).textContent).toContain("120")
    fireEvent.click(screen.getByRole("button", { name: "Провести" }))
    await waitFor(() => expect(mocks.mutations[fn("transitionCampaign")]).toHaveBeenCalledWith({ externalId: "campaign-1", action: "complete", expectedVersion: 3 }))
  })

  it("model: SMS parts, quiet-hours checks, Almaty launch time", () => {
    expect(smsInfo("a".repeat(160)).parts).toBe(1)
    expect(smsInfo("я".repeat(71)).parts).toBe(2)
    const draft: CampaignDraft = { name: "Тест", channel: "email", categoryExternalId: "", restaurantExternalIds: ["r1"], date: "2026-12-20", time: "22:00", quietHoursStart: "20", quietHoursEnd: "9", subject: "", template: "Привет" }
    expect(validateCampaign(draft)).toMatchObject({ quietHoursEnd: expect.any(String), subject: "Укажите тему письма" })
    expect(campaignSaveArgs({ ...draft, subject: "Тема" }, null)).toMatchObject({ scheduledAt: almatyMoment("2026-12-20", "22:00"), subject: "Тема" })
    expect(audienceLine({ count: 21, capped: true })).toBe("Будет отправлено не меньше чем 21 гостю с согласием")
  })
})
