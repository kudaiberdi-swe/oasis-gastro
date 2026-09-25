import { describe, expect, it } from "vitest"

import type { FinanceRecord } from "@/office/features/finance/data/use-finance-records"
import {
  allocationFollowingAmount,
  autoAllocate,
  obligationDraftOf,
  obligationExternalId,
  obligationOf,
  obligationSaveArgs,
  obligationSourceHref,
  OVER_ALLOCATED,
  overAllocation,
  payObligationHref,
  paymentDraftOf,
  serviceDraftOf,
  serviceSaveArgs,
  validatePayment,
  validateService,
  vatOf,
  withAllocation,
} from "@/office/features/finance/model/settlements"

// W2-FIN-08…10 rules the office checks before a call — the same as convex/domains/finance/modules.ts.

function record(overrides: Partial<FinanceRecord>): FinanceRecord {
  return {
    _id: "r" as FinanceRecord["_id"],
    _creationTime: 0,
    externalId: "x",
    moduleId: "services",
    number: "АУ-1",
    name: "Уборка",
    status: "draft",
    organizationExternalId: "sandyq",
    restaurantExternalId: "r1",
    businessDate: "2026-09-20",
    amount: 112_000,
    data: {},
    searchText: "",
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

describe("services (W2-FIN-08)", () => {
  it("VAT is the part of an amount with VAT, rounded to whole tenge", () => {
    expect(vatOf(112_000, 12)).toBe(12_000)
    expect(vatOf(1000, 12)).toBe(107)
    expect(vatOf(1000, 0)).toBe(0)
  })

  it("default accounts are left to the server, so a direction change moves them", () => {
    const saved = record({ debitAccountExternalId: "acc-7210", creditAccountExternalId: "acc-3310", counterpartyExternalId: "cp", data: { serviceDirection: "received", vatRate: 12, vatAmount: 12_000 } })
    const draft = serviceDraftOf(saved, "r1")
    expect(draft).toMatchObject({ debitAccountExternalId: "", creditAccountExternalId: "", vatRate: 12, serviceDirection: "received" })
    const args = serviceSaveArgs({ ...draft, serviceDirection: "provided" }, saved)
    expect(args).not.toHaveProperty("debitAccountExternalId")
    expect(args).toMatchObject({ moduleId: "services", externalId: "x", expectedVersion: 1, counterpartyExternalId: "cp", data: { serviceDirection: "provided", vatRate: 12 } })
    // vatAmount is the server's: never sent.
    expect(args.data).not.toHaveProperty("vatAmount")
  })

  it("an overridden account is kept and sent", () => {
    const draft = serviceDraftOf(record({ debitAccountExternalId: "acc-7400", creditAccountExternalId: "acc-3310", data: { serviceDirection: "received" } }), "r1")
    expect(draft.debitAccountExternalId).toBe("acc-7400")
    expect(serviceSaveArgs(draft, null)).toMatchObject({ debitAccountExternalId: "acc-7400" })
  })

  it("counterparty is required; the due date cannot precede the act", () => {
    const errors = validateService({ ...serviceDraftOf(null, "r1"), name: "Аренда", amount: 1000, businessDate: "2026-09-20", dueDate: "2026-09-01" })
    expect(errors).toEqual({ counterpartyExternalId: "Выберите контрагента", dueDate: "Срок оплаты раньше даты акта" })
  })
})

describe("obligations (W2-FIN-09)", () => {
  it("reads the obligation data and links the source document", () => {
    const row = record({ moduleId: "accounts-payable", amount: 62_000, data: { direction: "payable", originalAmount: 112_000, allocatedAmount: 50_000, dueDate: "2026-09-21", sourceModuleId: "services", sourceExternalId: "act-1", sourceNumber: "АУ-1", obligationKind: "service" } })
    expect(obligationOf(row)).toMatchObject({ original: 112_000, allocated: 50_000, open: 62_000, manual: false, kind: "service" })
    expect(obligationSourceHref("services", "act-1")).toBe("/office/services/act-1")
    expect(obligationSourceHref("receipts", "r 1")).toBe("/office/receipts/r%201")
    expect(obligationSourceHref("payroll", "run-1")).toBe("/office/payroll/run-1")
    expect(obligationSourceHref("accounts-payable", "")).toBeNull()
    expect(obligationExternalId("services", "act-1")).toBe("obligation:services:act-1:main")
  })

  it("a manual obligation starts with its whole amount open", () => {
    const draft = { ...obligationDraftOf(null, "r1"), name: "Штраф", amount: 5000, counterpartyExternalId: "cp", direction: "receivable" as const }
    expect(obligationSaveArgs(draft, null)).toMatchObject({ moduleId: "accounts-payable", amount: 5000, data: { direction: "receivable", originalAmount: 5000, allocatedAmount: 0, dueDate: null, sourceModuleId: "accounts-payable" } })
  })
})

describe("payments (W2-FIN-10)", () => {
  it("allocations stay sorted and drop empty lines", () => {
    let list = withAllocation([], "b", 100)
    list = withAllocation(list, "a", 50)
    expect(list.map((row) => row.obligationExternalId)).toEqual(["a", "b"])
    expect(withAllocation(list, "b", null)).toEqual([{ obligationExternalId: "a", amount: 50 }])
  })

  it("auto-allocation pays the earliest due first, the rest stays an advance", () => {
    const allocations = autoAllocate(100_000, [
      { externalId: "late", open: 80_000, dueDate: "2026-10-10" },
      { externalId: "none", open: 10_000, dueDate: null },
      { externalId: "soon", open: 60_000, dueDate: "2026-09-25" },
    ])
    expect(allocations).toEqual([
      { obligationExternalId: "late", amount: 40_000 },
      { obligationExternalId: "soon", amount: 60_000 },
    ])
  })

  it("rejects an allocation above the open remainder or above the payment", () => {
    const draft = { ...paymentDraftOf(null, "r1"), name: "Оплата", amount: 50_000, counterpartyExternalId: "cp", cashflowCategoryExternalId: "cat" }
    expect(validatePayment({ ...draft, allocations: [{ obligationExternalId: "o1", amount: 60_000 }] }, { o1: 112_000 })).toEqual({ allocations: "Распределено больше суммы платежа" })
    expect(validatePayment({ ...draft, allocations: [{ obligationExternalId: "o1", amount: 40_000 }] }, { o1: 30_000 })).toEqual({ allocations: "Сумма платежа превышает открытый остаток обязательства" })
    expect(validatePayment({ ...draft, cashflowCategoryExternalId: "" })).toEqual({ cashflowCategoryExternalId: "Выберите статью ДДС" })
  })

  it("the prefilled allocation follows «Сумма», never above the open remainder", () => {
    const obligation = { externalId: "o1", open: 112_000, dueDate: null }
    expect(allocationFollowingAmount(50_000, obligation)).toEqual([{ obligationExternalId: "o1", amount: 50_000 }])
    expect(allocationFollowingAmount(150_000, obligation)).toEqual([{ obligationExternalId: "o1", amount: 112_000 }])
    expect(allocationFollowingAmount(null, obligation)).toEqual([])
    expect(allocationFollowingAmount(0, obligation)).toEqual([])
  })

  it("over-allocation is measured against the payment, never a negative advance", () => {
    const lines = [{ obligationExternalId: "o1", amount: 112_000 }]
    expect(overAllocation(50_000, lines)).toBe(62_000)
    expect(overAllocation(112_000, lines)).toBe(0)
    expect(overAllocation(null, lines)).toBe(112_000)
    expect(overAllocation(200_000, [])).toBe(0)
    expect(OVER_ALLOCATED).toBe("Распределено больше суммы платежа")
  })

  it("«Оплатить» carries the obligation, counterparty, restaurant and direction", () => {
    expect(payObligationHref({ externalId: "obligation:services:a:main", counterpartyExternalId: "cp", restaurantExternalId: "r1", direction: "payable" })).toBe(
      "/office/payments/new?obligation=obligation%3Aservices%3Aa%3Amain&counterparty=cp&restaurant=r1&direction=payable",
    )
  })
})
