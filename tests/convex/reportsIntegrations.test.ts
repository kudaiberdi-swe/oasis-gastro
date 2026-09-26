import type { TestConvex } from "convex-test"
import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import type { Doc } from "../../convex/_generated/dataModel"
import schema from "../../convex/schema"
import { cashier, draft, setup } from "./fixtures/pos"

// W3-RPT-06: the 15 integration and control reports — the queue, errors and retries, 1C / EDI while not
// connected, bank reconciliation, non-fiscal receipts (D6), the EGAIS family as a status (D4), Cloud API
// and webhooks, external menu, terminals, the audit journal and the X/Z register.

type T = TestConvex<typeof schema>
const AUGUST = { dateFrom: "2026-08-01", dateTo: "2026-08-31", restaurantExternalIds: [] as string[] }
const at = (date: string, hour = 6) => Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`)

async function office(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["*"], active: true })
    await ctx.db.insert("restaurants", { externalId: "astana", organizationExternalId: "sandyq", name: "Астана", address: "—", timezone: "Asia/Almaty", active: true })
  })
  const admin = t.withIdentity({ email: "admin@sandyq.test" })
  return (reportId: string, config: Partial<typeof AUGUST> & { extra?: Record<string, string | number | boolean>; search?: string } = {}) => admin.query(api.domains.reports.queries.execute, { reportId, config: { ...AUGUST, ...config } })
}

type JobSpec = Partial<Doc<"integrationJobs">> & Pick<Doc<"integrationJobs">, "provider" | "operation" | "status">
async function jobs(t: T, specs: JobSpec[]) {
  await t.run(async (ctx) => {
    let n = 0
    for (const spec of specs) {
      n += 1
      await ctx.db.insert("integrationJobs", { externalId: `job-${n}`, direction: "outbound", idempotencyKey: `k-${n}`, attempts: 1, payload: { to: "guest@example.test" }, nextAttemptAt: at("2026-08-20"), createdAt: at("2026-08-10"), updatedAt: at("2026-08-10", 7), ...spec })
    }
  })
}

describe("integration queue reports (W3-RPT-06: integrations-01…04, 06, 11, 12)", () => {
  it("queue by provider, errors, retries, not-connected providers, webhooks and API calls, external menu", async () => {
    const { t } = await setup()
    const run = await office(t)
    await jobs(t, [
      { provider: "convex-event-bus", operation: "order.paid", status: "completed", attempts: 2 },
      { provider: "convex-event-bus", operation: "order.paid", status: "completed" },
      { provider: "1c", operation: "export-sales", status: "dead-letter", attempts: 5, error: "Провайдер не подключён" },
      { provider: "email", operation: "office-user.password-reset", status: "retrying", attempts: 3, error: "Провайдер e-mail не настроен (Б-B6)" },
      { provider: "wolt", operation: "webhook", direction: "inbound", status: "completed" },
      { provider: "wolt", operation: "webhook", direction: "inbound", status: "failed", error: "Подпись неверна" },
      { provider: "messaging", operation: "send-campaign", status: "completed", payload: { restaurantExternalId: "astana", channel: "sms" } },
      { provider: "1c", operation: "export-sales", status: "completed", createdAt: at("2026-07-10") }, // outside the period
    ])
    await t.run((ctx) => ctx.db.insert("auditEvents", { actorKey: "api:site", action: "order.create", summary: "Заказ с сайта", resourceType: "order", resourceExternalId: "o1", organizationExternalId: "sandyq", restaurantExternalId: "almaty", occurredAt: at("2026-08-15") }))

    const queue = await run("integrations-01")
    const cells = Object.fromEntries(queue.rows.map((row) => [row.key, row.cells]))
    expect(cells["convex-event-bus:order.paid"]).toMatchObject({ total: 2, completed: 2, successRate: 100 })
    expect(cells["1c:export-sales"]).toMatchObject({ total: 1, failed: 1, completed: 0 })
    expect(queue.totals).toMatchObject({ total: 7, failed: 2, retrying: 1 })
    expect(queue.kpis.find((kpi) => kpi.key === "backlog")?.value).toBe(1)
    expect(JSON.stringify(queue)).not.toContain("guest@example.test") // payloads are never shown
    // A restaurant report sees only the jobs of its restaurant.
    expect((await run("integrations-01", { restaurantExternalIds: ["astana"] })).totals).toMatchObject({ total: 1 })

    const errors = await run("integrations-02")
    expect(errors.rows.map((row) => [row.cells.provider, row.cells.status, row.cells.error])).toEqual([["1c", "Не доставлено", "Провайдер не подключён"], ["wolt", "Ошибка", "Подпись неверна"]])
    expect(errors.kpis[0].value).toBe(2)

    const retries = await run("integrations-03")
    expect(retries.rows.map((row) => [row.cells.provider, row.cells.attempts, row.cells.status])).toEqual([["1c", 5, "Не доставлено"], ["email", 3, "Повтор"], ["convex-event-bus", 2, "Выполнено"]])
    expect(retries.kpis.find((kpi) => kpi.key === "recovered")?.value).toBe(1)

    const oneC = await run("integrations-04")
    expect(oneC.sourceLabel).toMatch(/^Не подключено: провайдер «1С» не выбран/)
    expect(oneC.totals).toMatchObject({ total: 1, failed: 1 })
    const edi = await run("integrations-06")
    expect(edi.rows).toEqual([])
    expect(edi.sourceLabel).toMatch(/^Не подключено: провайдер «EDI»/)

    const api11 = await run("integrations-11")
    expect(api11.rows.map((row) => [row.key, row.cells.kind, row.cells.total, row.cells.completed, row.cells.failed])).toEqual([["webhook:wolt", "Входящий вебхук", 2, 1, 1], ["api:site", "Cloud API · order.create", 1, 1, 0]])

    const menu = await run("integrations-12")
    expect(menu.rows).toEqual([])
    expect(menu.sourceLabel).toMatch(/^Не подключено/)
    await jobs(t, [{ externalId: "job-menu", idempotencyKey: "menu-1", provider: "website", operation: "external-menu.publish", status: "completed" }])
    expect((await run("integrations-12")).rows.map((row) => [row.cells.provider, row.cells.status])).toEqual([["website", "Выполнено"]])
  })
})

describe("control reports (W3-RPT-06: integrations-05, 07…10, 13…15)", () => {
  it("bank reconciliation, non-fiscal receipts, EGAIS as a status, terminals, audit journal, X/Z register", async () => {
    const { t, productId } = await setup()
    const run = await office(t)

    // Bank: s1 matched to the bank payment p1, s2 unmatched; p2 (bank) has no statement line, p3 is cash.
    await t.run(async (ctx) => {
      const record = (moduleId: "bank-statements" | "payments", externalId: string, amount: number, status: Doc<"financeRecords">["status"], data: Doc<"financeRecords">["data"]) =>
        ctx.db.insert("financeRecords", { externalId, moduleId, number: externalId.toUpperCase(), name: `Запись ${externalId}`, status, organizationExternalId: "sandyq", restaurantExternalId: "almaty", businessDate: "2026-08-12", amount, data, searchText: "", version: 1, createdAt: 0, updatedAt: 0 })
      await record("payments", "p1", 50_000, "posted", { method: "bank", direction: "outgoing" })
      await record("payments", "p2", 20_000, "posted", { method: "bank", direction: "incoming" })
      await record("payments", "p3", 7_000, "posted", { method: "cash", direction: "outgoing" })
      await record("bank-statements", "s1", 50_000, "posted", { direction: "outgoing", counterparty: "ТОО Клининг", matchStatus: "matched", matchedPaymentExternalId: "p1" })
      await record("bank-statements", "s2", 12_000, "draft", { direction: "incoming", counterparty: "ТОО Банкет", matchStatus: "unmatched" })
    })
    const bank = await run("integrations-05")
    expect(bank.rows.map((row) => [row.cells.number, row.cells.match, row.cells.payment])).toEqual([["S1", "Сопоставлено", "P1 · Алматы"], ["S2", "Не сопоставлено", "—"], ["—", "Нет в выписке", "P2"]])
    expect(Object.fromEntries(bank.kpis.map((kpi) => [kpi.key, kpi.value]))).toMatchObject({ matched: 1, unmatched: 1, unmatchedAmount: 12_000, unconfirmed: 1, unconfirmedAmount: 20_000 })

    // A sale, an X-report and the Z-report of the shift today.
    const check = await draft(t, productId)
    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: check._id, idempotencyKey: "pay", payments: [{ method: "cash", amount: 2300 }] })
    await t.mutation(api.domains.shifts.mutations.createXReport, { sessionToken: cashier, idempotencyKey: "x-1", managerApprovalToken: "m1" })
    await t.mutation(api.domains.shifts.mutations.close, { sessionToken: cashier, countedCash: 2300, note: "" })
    const today = (await t.run((ctx) => ctx.db.get(check._id)))!.businessDate!
    const period = { dateFrom: today, dateTo: today }

    const fiscal = await run("integrations-07", period)
    expect(fiscal.sourceLabel).toMatch(/^Фискализация не подключена/)
    expect(fiscal.rows.map((row) => [row.key, row.cells.receipts, row.cells.fiscal, row.cells.nonFiscal, row.cells.zReports])).toEqual([["almaty", 1, 0, 1, 1]])

    for (const reportId of ["integrations-08", "integrations-09", "integrations-10"]) {
      const status = await run(reportId)
      expect(status.sourceLabel).toMatch(/^Не применяется в РК/)
      expect(status.rows).toEqual([])
    }

    const cash = await run("integrations-15", period)
    expect(cash.rows.map((row) => [row.cells.kind, row.cells.netSales])).toEqual([["X-отчёт", 2300], ["Z-отчёт", 2300]])
    expect(cash.kpis.map((kpi) => kpi.value)).toEqual([1, 1])

    await t.run(async (ctx) => {
      const restaurant = (await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", "almaty")).unique())!
      await ctx.db.insert("posTerminals", { externalId: "t2", restaurantId: restaurant._id, name: "Касса 2", terminalNumber: 2, nextOrderNumber: 1, active: false })
      await ctx.db.insert("posTerminals", { externalId: "t3", restaurantId: restaurant._id, name: "Экран кухни", terminalNumber: 3, nextOrderNumber: 1, active: true, kind: "kds" })
    })
    const devices = await run("integrations-13", { ...period, restaurantExternalIds: ["almaty"] })
    expect(devices.rows.map((row) => [row.key, row.cells.kind, row.cells.state])).toEqual([["t1", "Касса", "На связи"], ["t2", "Касса", "Отключено"], ["t3", "Экран кухни", "Нет отклика больше суток"]])
    expect(devices.sourceLabel).toMatch(/реестр принтеров, весов и ККМ ещё не ведётся/)

    const events = await run("integrations-14", period)
    expect(events.rows.length).toBeGreaterThan(2)
    expect(events.rows.map((row) => row.cells.action)).toEqual(expect.arrayContaining(["order.checkout", "shift.x-report", "shift.close"]))
    const found = await run("integrations-14", { ...period, search: "x-report" })
    expect(found.rows.map((row) => row.cells.action)).toEqual(["shift.x-report"])
  })
})
