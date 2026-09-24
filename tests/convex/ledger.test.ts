import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { internal } from "../../convex/_generated/api"
import { SYSTEM_ACCOUNTS } from "../../convex/lib/accounts"
import { postJournalEntry, reverseJournalEntries } from "../../convex/lib/ledger"
import { almatyDayStart } from "../../convex/lib/time"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")

async function setup() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("restaurants", { externalId: "almaty", organizationExternalId: "sandyq", name: "Sandyq Алматы", address: "—", timezone: "Asia/Almaty", active: true })
  })
  await t.mutation(internal.domains.finance.seed.seedChartOfAccounts, {})
  return t
}

const sale = (externalId: string, amount = 10_000) => ({
  externalId,
  restaurantExternalId: "almaty",
  sourceModuleId: "orders",
  sourceExternalId: "order-1",
  sourceNumber: "1",
  occurredAt: Date.parse("2026-09-24T12:00:00+05:00"),
  debitAccount: "cash",
  creditAccount: "revenue",
  amount,
  description: "Заказ №1",
})

describe("chart of accounts seed (W1-FIN-02)", () => {
  it("is idempotent and creates every system account", async () => {
    const t = await setup()
    const again = await t.mutation(internal.domains.finance.seed.seedChartOfAccounts, {})
    expect(again).toMatchObject({ created: 0, updated: 0 })
    const accounts = await t.run((ctx) => ctx.db.query("accounts").collect())
    expect(accounts).toHaveLength(Object.keys(SYSTEM_ACCOUNTS).length)
    for (const account of Object.values(SYSTEM_ACCOUNTS)) expect(accounts.some((row) => row.externalId === account.externalId && row.system && row.active)).toBe(true)
  })

  it("dry run reports without writing", async () => {
    const t = convexTest(schema, modules)
    const result = await t.mutation(internal.domains.finance.seed.seedChartOfAccounts, { dryRun: true })
    expect(result.created).toBe(Object.keys(SYSTEM_ACCOUNTS).length)
    expect(await t.run((ctx) => ctx.db.query("accounts").collect())).toHaveLength(0)
  })
})

describe("journal (W1-PLT-03)", () => {
  it("rejects an unknown account, a zero amount and identical debit and credit", async () => {
    const t = await setup()
    await t.run(async (ctx) => {
      await expect(postJournalEntry(ctx, { ...sale("a"), debitAccount: "acc-9999" })).rejects.toThrow(/не найден/)
      await expect(postJournalEntry(ctx, sale("b", 0))).rejects.toThrow(/положительным/)
      await expect(postJournalEntry(ctx, { ...sale("c"), creditAccount: "cash" })).rejects.toThrow(/совпадают/)
    })
  })

  it("posts once per externalId", async () => {
    const t = await setup()
    await t.run(async (ctx) => {
      const first = await postJournalEntry(ctx, sale("orders:1"))
      const second = await postJournalEntry(ctx, sale("orders:1"))
      expect(second._id).toBe(first._id)
      expect(first).toMatchObject({ debitAccountExternalId: SYSTEM_ACCOUNTS.cash.externalId, creditAccountExternalId: SYSTEM_ACCOUNTS.revenue.externalId, businessDate: "2026-09-24" })
      expect(await ctx.db.query("journalEntries").collect()).toHaveLength(1)
    })
  })

  it("reverses a share of a document once, swapping debit and credit", async () => {
    const t = await setup()
    await t.run(async (ctx) => {
      await postJournalEntry(ctx, sale("orders:1"))
      const [reversal] = await reverseJournalEntries(ctx, { sourceExternalId: "order-1", occurredAt: Date.now(), reversalKey: "refund-1", share: 0.5 })
      expect(reversal).toMatchObject({ amount: 5000, debitAccountExternalId: SYSTEM_ACCOUNTS.revenue.externalId, creditAccountExternalId: SYSTEM_ACCOUNTS.cash.externalId })
      expect(reversal.reversalOf).toBeDefined()
      await reverseJournalEntries(ctx, { sourceExternalId: "order-1", occurredAt: Date.now(), reversalKey: "refund-1", share: 0.5 })
      expect(await ctx.db.query("journalEntries").collect()).toHaveLength(2)
    })
  })

  it("does not post into a closed period", async () => {
    const t = await setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("periodLocks", { externalId: "l", organizationExternalId: "sandyq", kind: "final", lockedThrough: almatyDayStart("2026-09-30"), active: true, reason: "Сентябрь", createdBy: "a", createdAt: 1 })
      await expect(postJournalEntry(ctx, sale("orders:1"))).rejects.toThrow(/закрыт по 30\.09\.2026/)
    })
  })

  it("keeps a manual entry off accounts that forbid manual postings", async () => {
    const t = await setup()
    await t.run(async (ctx) => {
      const cogs = await ctx.db.query("accounts").withIndex("by_external_id", (q) => q.eq("externalId", SYSTEM_ACCOUNTS.cogs.externalId)).unique()
      await ctx.db.patch(cogs!._id, { allowManualEntries: false })
      await expect(postJournalEntry(ctx, { ...sale("m-1"), debitAccount: "cogs", creditAccount: "goods", manual: true })).rejects.toThrow(/нельзя делать ручные/)
    })
  })

  it("debit and credit turnovers balance over random postings", async () => {
    const t = await setup()
    const keys = Object.keys(SYSTEM_ACCOUNTS) as (keyof typeof SYSTEM_ACCOUNTS)[]
    await t.run(async (ctx) => {
      for (let index = 0; index < 10; index += 1) {
        const debit = keys[(index * 7) % keys.length]
        const credit = keys[(index * 7 + 3) % keys.length]
        await postJournalEntry(ctx, { ...sale(`r-${index}`, 1000 + index * 137), sourceExternalId: `doc-${index}`, debitAccount: debit, creditAccount: credit })
      }
      let debits = 0
      let credits = 0
      for (const account of Object.values(SYSTEM_ACCOUNTS)) {
        for (const row of await ctx.db.query("journalEntries").withIndex("by_debit_date", (q) => q.eq("debitAccountExternalId", account.externalId)).collect()) debits += row.amount
        for (const row of await ctx.db.query("journalEntries").withIndex("by_credit_date", (q) => q.eq("creditAccountExternalId", account.externalId)).collect()) credits += row.amount
      }
      expect(debits).toBe(credits)
      expect(debits).toBeGreaterThan(0)
    })
  })
})

describe("postings name accounts by key", () => {
  it("no convex file passes a literal account name to postJournalEntry", () => {
    const root = path.resolve("convex")
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name)
        if (name === "_generated") continue
        if (statSync(full).isDirectory()) walk(full)
        else if (full.endsWith(".ts")) files.push(full)
      }
    }
    walk(root)
    for (const file of files) {
      const code = readFileSync(file, "utf8")
      for (const match of code.matchAll(/(?:debit|credit)Account:\s*"([^"]+)"/g)) {
        expect(Object.keys(SYSTEM_ACCOUNTS), `${path.relative(root, file)}: ${match[1]}`).toContain(match[1])
      }
    }
  })
})
