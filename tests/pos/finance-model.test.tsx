import { describe, expect, it } from "vitest"

import type { FinanceRecord } from "@/office/features/finance/data/use-finance-records"
import {
  cashflowSaveArgs,
  counterpartyDraftOf,
  counterpartySaveArgs,
  last30Days,
  parseRoles,
  shiftDate,
  sourceHref,
  transactionDraftOf,
  transactionSaveArgs,
  validateAcceptance,
  validateCashflow,
  validateCounterparty,
  validateTransaction,
  variancePosting,
} from "@/office/features/finance/model/modules"

// W1-FIN-03…06: the office checks the same rules as convex/domains/finance/modules.ts before a call.

function record(overrides: Partial<FinanceRecord>): FinanceRecord {
  return {
    _id: "id" as FinanceRecord["_id"],
    _creationTime: 0,
    externalId: "x",
    moduleId: "counterparties",
    number: "КА-1",
    name: "ТОО Мясо",
    status: "active",
    organizationExternalId: "sandyq",
    restaurantExternalId: "r1",
    businessDate: "2026-09-01",
    amount: 0,
    data: {},
    searchText: "",
    version: 3,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

describe("finance model", () => {
  it("period helpers: 30 days including today", () => {
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28")
    expect(last30Days("2026-09-24")).toEqual({ from: "2026-08-26", to: "2026-09-24" })
  })

  it("cashflow categories: required fields, parent direction, no amount", () => {
    const draft = { name: "Мясо", code: "meat", direction: "outgoing" as const, activity: "operating" as const, parentExternalId: "p", restaurantExternalId: "r1" }
    expect(validateCashflow({ ...draft, name: "", code: "" })).toMatchObject({ name: expect.any(String), code: expect.any(String) })
    expect(validateCashflow(draft, "incoming").parentExternalId).toBe("Родительская статья другого направления")
    expect(validateCashflow(draft, "both")).toEqual({})
    const args = cashflowSaveArgs(draft, null)
    expect(args).toMatchObject({ moduleId: "cashflow-categories", amount: 0, data: { code: "meat", direction: "outgoing", activity: "operating", parentExternalId: "p" } })
    expect(args).not.toHaveProperty("externalId")
  })

  it("counterparties: roles as chips ↔ comma string, BIN, IBAN normalised", () => {
    expect(parseRoles("supplier, customer,unknown")).toEqual(["supplier", "customer"])
    const existing = record({ data: { roles: "customer,supplier", bin: "123456789012", bankAccount: "KZ123456789012345678", vatPayer: true, paymentDelayDays: 7 } })
    const draft = counterpartyDraftOf(existing, "r1")
    expect(draft).toMatchObject({ roles: ["customer", "supplier"], paymentDelayDays: "7", vatPayer: true })
    expect(validateCounterparty({ ...draft, bin: "123", bankAccount: "KZ1", roles: [] })).toMatchObject({ bin: "БИН / ИИН — 12 цифр", bankAccount: "IBAN — KZ и 18 символов", roles: expect.any(String) })
    const args = counterpartySaveArgs({ ...draft, bankAccount: "kz12 3456 7890 1234 5678", contact: " +7 701 " }, existing)
    expect(args).toMatchObject({ externalId: "x", expectedVersion: 3, businessDate: "2026-09-01", data: { roles: "supplier,customer", bankAccount: "KZ123456789012345678", contact: "+7 701", paymentDelayDays: 7 } })
  })

  it("transactions: debit ≠ credit, amount > 0, data keeps the primary document", () => {
    const draft = { ...transactionDraftOf(null, "r1"), name: "Инкассация", amount: 1000, debitAccountExternalId: "acc-1030", creditAccountExternalId: "acc-1030" }
    expect(validateTransaction(draft).creditAccountExternalId).toBe("Дебет и кредит должны отличаться")
    expect(validateTransaction({ ...draft, amount: 0 }).amount).toBeTruthy()
    const args = transactionSaveArgs({ ...draft, creditAccountExternalId: "acc-1010", documentReference: "ПКО-5" }, null)
    expect(args).toMatchObject({ moduleId: "transactions", amount: 1000, debitAccountExternalId: "acc-1030", creditAccountExternalId: "acc-1010", data: { comment: "", documentReference: "ПКО-5" } })
    expect(args).not.toHaveProperty("cashflowCategoryExternalId")
  })

  it("journal source leads to its document only where the office has a page", () => {
    expect(sourceHref({ sourceModuleId: "receipts", sourceExternalId: "rc 1" })).toBe("/office/receipts/rc%201")
    expect(sourceHref({ sourceModuleId: "transactions", sourceExternalId: "transactions-1" })).toBe("/office/transactions/transactions-1")
    expect(sourceHref({ sourceModuleId: "orders", sourceExternalId: "o1" })).toBeNull()
  })

  it("shift acceptance: recount required, comment on variance, the posting it will write", () => {
    expect(validateAcceptance(2300, null, "")).toEqual({ recountedCash: "Введите пересчитанную наличность" })
    expect(validateAcceptance(2300, 2000, "")).toEqual({ note: "При расхождении укажите комментарий" })
    expect(validateAcceptance(2300, 2300, "")).toEqual({})
    expect(variancePosting(2300, null)).toBeNull()
    expect(variancePosting(2300, 2300)).toMatchObject({ kind: "none", variance: 0 })
    expect(variancePosting(2300, 2400)).toMatchObject({ kind: "surplus", variance: 100, debit: { code: "1010" }, credit: { code: "6280" } })
    expect(variancePosting(2300, 2000)).toMatchObject({ kind: "shortage", variance: -300, debit: { code: "7480" }, credit: { code: "1010" } })
  })
})
