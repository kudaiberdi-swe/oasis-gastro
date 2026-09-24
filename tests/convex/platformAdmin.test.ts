import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { postJournalEntry } from "../../convex/lib/ledger"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")
const platform = api.domains.platform

async function setup() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    for (const [org, restaurants] of [["sandyq", ["almaty", "shymkent"]], ["tary", ["tary-1"]]] as const) {
      await ctx.db.insert("organizations", { externalId: org, name: org, currency: "KZT", timezone: "Asia/Almaty", active: true })
      for (const externalId of restaurants) {
        const restaurantId = await ctx.db.insert("restaurants", { externalId, organizationExternalId: org, name: externalId, address: "ул. Абылай хана, 1", timezone: "Asia/Almaty", active: true })
        await ctx.db.insert("posTerminals", { externalId: `${externalId}-01`, restaurantId, name: "Касса 1", terminalNumber: 1, nextOrderNumber: 1, active: true })
      }
    }
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeRoles", { externalId: "branch", name: "Управляющий", capabilities: ["office.terminals.view", "office.terminals.edit", "office.document-locks.view", "office.document-locks.post"], system: false })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["sandyq"], active: true })
    await ctx.db.insert("officeUsers", { externalId: "branch", email: "branch@sandyq.test", name: "Алматы", roleExternalId: "branch", restaurantScopes: ["almaty"], active: true })
  })
  await t.mutation(internal.domains.finance.seed.seedChartOfAccounts, {})
  return { t, admin: t.withIdentity({ email: "admin@sandyq.test" }), branch: t.withIdentity({ email: "branch@sandyq.test" }) }
}

const page = { numItems: 50, cursor: null }

describe("terminals (W1-ADM-01)", () => {
  it("creates a terminal, rejects a duplicate number and keeps kitchen screens out of the picker", async () => {
    const { admin } = await setup()
    await expect(admin.mutation(platform.mutations.saveTerminal, { restaurantExternalId: "almaty", name: "Касса 2", terminalNumber: 1, kind: "pos" })).rejects.toThrow(/номером 1 уже есть/)
    const id = await admin.mutation(platform.mutations.saveTerminal, { restaurantExternalId: "almaty", name: "Касса 2", terminalNumber: 2, kind: "pos" })
    await admin.mutation(platform.mutations.saveTerminal, { restaurantExternalId: "almaty", name: "Экран кухни", terminalNumber: 9, kind: "kds" })
    const options = await admin.query(api.domains.auth.queries.posTerminalOptions, {})
    const almaty = options.find((option) => option.restaurantExternalId === "almaty")!
    expect(almaty.terminals.map((terminal) => terminal.externalId)).toEqual(["almaty-01", id])
    expect(almaty.address).toBe("ул. Абылай хана, 1")
    await admin.mutation(platform.mutations.setTerminalActive, { externalId: id, active: false })
    const listed = await admin.query(platform.queries.listTerminals, { restaurantExternalId: "almaty", status: "inactive", paginationOpts: page })
    expect(listed.page.map((row) => row.name)).toEqual(["Касса 2"])
  })

  it("keeps a branch user to their restaurant and checks the version", async () => {
    const { branch } = await setup()
    const all = await branch.query(platform.queries.listTerminals, { paginationOpts: page })
    expect(all.page.map((row) => row.restaurantExternalId)).toEqual(["almaty"])
    await expect(branch.mutation(platform.mutations.saveTerminal, { restaurantExternalId: "shymkent", name: "X", terminalNumber: 5, kind: "pos" })).rejects.toThrow(/Нет доступа/)
    await branch.mutation(platform.mutations.saveTerminal, { externalId: "almaty-01", restaurantExternalId: "almaty", name: "Главная касса", terminalNumber: 1, kind: "pos", expectedVersion: 1 })
    await expect(branch.mutation(platform.mutations.saveTerminal, { externalId: "almaty-01", restaurantExternalId: "almaty", name: "Главная", terminalNumber: 1, kind: "pos", expectedVersion: 1 })).rejects.toThrow(/изменён другим/)
  })

  it("records the last sign-in on the terminal", async () => {
    const { t } = await setup()
    await t.run(async (ctx) => {
      const terminal = (await ctx.db.query("posTerminals").withIndex("by_external_id", (q) => q.eq("externalId", "almaty-01")).unique())!
      const employeeId = await ctx.db.insert("employees", { code: "1", displayName: "К", role: "cashier", restaurantIds: [terminal.restaurantId], pinSalt: "s", pinHash: "h", active: true, failedAttempts: 0 })
      return { terminalId: terminal._id, employeeId }
    }).then(({ terminalId, employeeId }) => t.mutation(internal.domains.auth.internal.createSession, { employeeId, terminalId, tokenHash: "x", purpose: "operator", now: 12345, expiresAt: 99999 }))
    const listed = await t.withIdentity({ email: "admin@sandyq.test" }).query(platform.queries.listTerminals, { restaurantExternalId: "almaty", paginationOpts: page })
    expect(listed.page[0].lastLoginAt).toBe(12345)
  })
})

describe("period locks (W1-ADM-03)", () => {
  const sale = { externalId: "s-1", restaurantExternalId: "almaty", sourceModuleId: "orders", sourceExternalId: "o", sourceNumber: "1", occurredAt: Date.parse("2026-08-15T12:00:00+05:00"), debitAccount: "cash", creditAccount: "revenue", amount: 1000, description: "Продажа" }

  it("a lock blocks postings on its dates until it is reopened; the other organization is untouched", async () => {
    const { t, admin } = await setup()
    const lock = await admin.mutation(platform.mutations.createPeriodLock, { kind: "final", lockedThrough: "2026-08-31", reason: "Закрытие августа" })
    await t.run(async (ctx) => {
      await expect(postJournalEntry(ctx, sale)).rejects.toThrow(/окончательно закрыт по 31\.08\.2026/)
      await expect(postJournalEntry(ctx, { ...sale, externalId: "t-1", restaurantExternalId: "tary-1" })).resolves.toBeDefined()
    })
    await expect(admin.mutation(platform.mutations.reopenPeriodLock, { externalId: lock, reopenReason: "" })).rejects.toThrow(/причину/)
    await admin.mutation(platform.mutations.reopenPeriodLock, { externalId: lock, reopenReason: "Исправление накладной" })
    await t.run(async (ctx) => {
      await expect(postJournalEntry(ctx, sale)).resolves.toBeDefined()
    })
    const listed = await admin.query(platform.queries.listPeriodLocks, { status: "reopened", paginationOpts: page })
    expect(listed.page[0]).toMatchObject({ lockedThroughDate: "2026-08-31", reopenReason: "Исправление накладной" })
  })

  it("refuses a future date, an unknown module, and reopening without the reverse right", async () => {
    const { admin, branch } = await setup()
    await expect(admin.mutation(platform.mutations.createPeriodLock, { kind: "final", lockedThrough: "2999-01-01", reason: "Будущее" })).rejects.toThrow(/будущий/)
    await expect(admin.mutation(platform.mutations.createPeriodLock, { kind: "final", lockedThrough: "2026-08-31", moduleId: "nowhere", reason: "Модуль" })).rejects.toThrow(/Неизвестный раздел/)
    await expect(branch.mutation(platform.mutations.createPeriodLock, { kind: "preliminary", lockedThrough: "2026-08-31", reason: "Вся сеть" })).rejects.toThrow(/всех ресторанам|всем ресторанам/)
    const own = await branch.mutation(platform.mutations.createPeriodLock, { kind: "preliminary", lockedThrough: "2026-08-31", restaurantExternalId: "almaty", reason: "Алматы август" })
    await expect(branch.mutation(platform.mutations.reopenPeriodLock, { externalId: own, reopenReason: "Ошибка" })).rejects.toThrow(/Недостаточно прав/)
  })
})
