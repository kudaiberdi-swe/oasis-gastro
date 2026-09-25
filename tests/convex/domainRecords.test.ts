import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { LIFECYCLES } from "../../convex/lib/lifecycles"
import { almatyDayStart } from "../../convex/lib/time"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")
const records = api.domains.finance.records

async function setup() {
  const t = convexTest(schema, modules)
  await t.mutation(internal.domains.finance.seed.seedChartOfAccounts, {}) // manual operations post to the journal (W1-FIN-05)
  await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
    for (const externalId of ["almaty", "shymkent"]) {
      await ctx.db.insert("restaurants", { externalId, organizationExternalId: "sandyq", name: externalId, address: "—", timezone: "Asia/Almaty", active: true })
    }
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeRoles", { externalId: "accountant", name: "Бухгалтер филиала", capabilities: ["office.transactions.view", "office.transactions.edit", "office.payments.view", "office.payments.edit"], system: false })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], active: true })
    await ctx.db.insert("officeUsers", { externalId: "acc", email: "acc@sandyq.test", name: "Бухгалтер", roleExternalId: "accountant", restaurantScopes: ["almaty"], active: true })
  })
  return { t, admin: t.withIdentity({ email: "admin@sandyq.test" }), accountant: t.withIdentity({ email: "acc@sandyq.test" }) }
}

const draft = (overrides: Record<string, unknown> = {}) => ({
  moduleId: "transactions" as const,
  name: "Оплата аренды",
  restaurantExternalId: "almaty",
  businessDate: "2026-09-24",
  amount: 850_000,
  debitAccountExternalId: "acc-7210",
  creditAccountExternalId: "acc-1030",
  data: { memo: "сентябрь" },
  ...overrides,
})

describe("domain record lifecycle (W1-PLT-05)", () => {
  it("numbers on the server and walks draft → posted → reversed", async () => {
    const { admin } = await setup()
    const saved = await admin.mutation(records.save, draft())
    expect(saved).toMatchObject({ number: "ПР-2026-00001", version: 1 })
    const posted = await admin.mutation(records.transition, { moduleId: "transactions", externalId: saved.externalId, action: "post", expectedVersion: 1 })
    expect(posted).toEqual({ status: "posted", version: 2 })
    await expect(admin.mutation(records.save, draft({ externalId: saved.externalId, expectedVersion: 2 }))).rejects.toThrow(/нельзя изменить/)
    await expect(admin.mutation(records.transition, { moduleId: "transactions", externalId: saved.externalId, action: "reverse", expectedVersion: 2 })).rejects.toThrow(/причину/)
    const reversed = await admin.mutation(records.transition, { moduleId: "transactions", externalId: saved.externalId, action: "reverse", expectedVersion: 2, reason: "Ошибка суммы" })
    expect(reversed.status).toBe("reversed")
  })

  it("runs every transition of every lifecycle and rejects the rest", async () => {
    const { admin } = await setup()
    const walk = async (moduleId: "cashflow-categories" | "budgets", steps: [string, string][]) => {
      const data = moduleId === "cashflow-categories" ? { code: "rent", direction: "outgoing", activity: "operating" } : { memo: "сентябрь" }
      const saved = await admin.mutation(records.save, draft({ moduleId, debitAccountExternalId: undefined, creditAccountExternalId: undefined, data }))
      let version = saved.version
      for (const [action, status] of steps) {
        const result = await admin.mutation(records.transition, { moduleId, externalId: saved.externalId, action: action as "post", expectedVersion: version, reason: "причина" })
        expect(result.status, `${moduleId} ${action}`).toBe(status)
        version = result.version
      }
      return { ...saved, version }
    }
    await walk("cashflow-categories", [["deactivate", "inactive"], ["activate", "active"]])
    const payment = await walk("budgets", [["submit", "pending-approval"], ["approve", "approved"], ["post", "posted"], ["reverse", "reversed"]])
    await expect(admin.mutation(records.transition, { moduleId: "budgets", externalId: payment.externalId, action: "approve", expectedVersion: payment.version })).rejects.toThrow(/Нельзя согласовать: запись в статусе «Сторнирован»/)
    await expect(admin.mutation(records.transition, { moduleId: "transactions", externalId: payment.externalId, action: "submit", expectedVersion: 1 })).rejects.toThrow(/недоступно/)
    expect(Object.keys(LIFECYCLES)).toEqual(["master", "publish", "approval", "document"])
  })

  it("needs the transition's own right", async () => {
    const { accountant } = await setup()
    const saved = await accountant.mutation(records.save, draft())
    await expect(accountant.mutation(records.transition, { moduleId: "transactions", externalId: saved.externalId, action: "post", expectedVersion: 1 })).rejects.toThrow(/Недостаточно прав/)
    await expect(accountant.query(records.list, { moduleId: "budgets", paginationOpts: { numItems: 5, cursor: null } })).rejects.toThrow(/Недостаточно прав/)
  })

  it("gives 20 saves 20 distinct numbers and checks the version", async () => {
    const { admin } = await setup()
    const numbers = await Promise.all(Array.from({ length: 20 }, () => admin.mutation(records.save, draft())))
    expect(new Set(numbers.map((row) => row.number)).size).toBe(20)
    const first = numbers[0]
    await admin.mutation(records.save, draft({ externalId: first.externalId, expectedVersion: 1, name: "Аренда (исправлено)" }))
    await expect(admin.mutation(records.save, draft({ externalId: first.externalId, expectedVersion: 1 }))).rejects.toThrow(/изменена другим пользователем/)
  })

  it("rejects equal debit and credit and a closed period", async () => {
    const { t, admin } = await setup()
    await expect(admin.mutation(records.save, draft({ creditAccountExternalId: "acc-7210" }))).rejects.toThrow(/Дебет и кредит должны отличаться/)
    await t.run((ctx) => ctx.db.insert("periodLocks", { externalId: "l", organizationExternalId: "sandyq", kind: "final", lockedThrough: almatyDayStart("2026-09-30"), active: true, reason: "Сентябрь", createdBy: "a", createdAt: 1 }))
    await expect(admin.mutation(records.save, draft())).rejects.toThrow(/закрыт по 30\.09\.2026/)
  })

  it("pages 3×25, searches, and hides other restaurants", async () => {
    const { admin, accountant } = await setup()
    for (let index = 0; index < 60; index += 1) {
      await admin.mutation(records.save, draft({ name: index === 7 ? "Кофемашина сервис" : `Проводка ${index}`, restaurantExternalId: index % 4 === 0 ? "shymkent" : "almaty" }))
    }
    let cursor: string | null = null
    const seen: string[] = []
    for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
      const page: { page: { number: string }[]; continueCursor: string; isDone: boolean } = await admin.query(records.list, {
        moduleId: "transactions",
        paginationOpts: { numItems: 25, cursor },
      })
      seen.push(...page.page.map((row) => row.number))
      cursor = page.continueCursor
      if (pageIndex === 2) expect(page.isDone).toBe(true)
    }
    expect(new Set(seen).size).toBe(60)

    const found = await admin.query(records.list, { moduleId: "transactions", search: "кофемашина", paginationOpts: { numItems: 10, cursor: null } })
    expect(found.page.map((row) => row.name)).toEqual(["Кофемашина сервис"])

    const own = await accountant.query(records.list, { moduleId: "transactions", paginationOpts: { numItems: 100, cursor: null } })
    expect(own.page).toHaveLength(45)
    expect(own.page.every((row) => row.restaurantExternalId === "almaty")).toBe(true)
    await expect(accountant.query(records.list, { moduleId: "transactions", restaurantExternalId: "shymkent", paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow(/Нет доступа/)
    const shymkentRecord = (await admin.query(records.list, { moduleId: "transactions", restaurantExternalId: "shymkent", paginationOpts: { numItems: 1, cursor: null } })).page[0]
    expect(await accountant.query(records.get, { moduleId: "transactions", externalId: shymkentRecord.externalId })).toBeNull()
    await expect(accountant.mutation(records.save, draft({ restaurantExternalId: "shymkent" }))).rejects.toThrow(/Нет доступа/)
  })

  it("audits and announces every change", async () => {
    const { t, admin } = await setup()
    const saved = await admin.mutation(records.save, draft())
    await admin.mutation(records.transition, { moduleId: "transactions", externalId: saved.externalId, action: "post", expectedVersion: 1 })
    const [audit, outbox] = await t.run(async (ctx) => [await ctx.db.query("auditEvents").collect(), await ctx.db.query("outboxEvents").collect()])
    expect(audit.map((event) => event.action)).toEqual(["transactions.create", "transactions.post"])
    expect(audit[1].details).toMatchObject({ from: "draft", to: "posted" })
    expect(outbox.map((event) => event.eventType)).toEqual(["domain-record.created", "domain-record.post"])
  })
})
