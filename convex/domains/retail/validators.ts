import { v } from "convex/values"

// Typed data of each retail setting kind (W1-RTL-01) — never v.any(). `kind` inside `data` matches the
// row's kind so a payment type can never carry order-type fields.

export const paymentTypeData = v.object({
  kind: v.literal("payment-type"),
  processorKind: v.union(v.literal("cash"), v.literal("card"), v.literal("qr")),
  account: v.string(), // SYSTEM_ACCOUNTS key or account externalId the money lands on
  fiscal: v.boolean(),
  revenue: v.boolean(),
  manualEntry: v.boolean(),
  externalAcceptance: v.boolean(),
  combinable: v.boolean(),
  allowsChange: v.boolean(),
  opensCashDrawer: v.boolean(),
})

export const orderTypeData = v.object({
  kind: v.literal("order-type"),
  serviceMode: v.union(v.literal("dine-in"), v.literal("takeaway"), v.literal("delivery")),
  promptStage: v.union(v.literal("start"), v.literal("payment"), v.literal("never")),
  isDefault: v.boolean(),
  serviceChargePercent: v.number(), // 0–30 (D5: service charge by order type)
})

export const discountTypeData = v.object({
  kind: v.literal("discount-type"),
  mode: v.union(v.literal("percent"), v.literal("fixed"), v.literal("markup"), v.literal("service")),
  value: v.number(),
  minimumOrder: v.number(),
  priority: v.number(),
  managerApprovalAbove: v.number(),
  manual: v.boolean(),
  automatic: v.boolean(),
  combinable: v.boolean(),
})

export const deletionReasonData = v.object({
  kind: v.literal("deletion-reason"),
  expenseAccount: v.optional(v.string()),
  writeOff: v.boolean(),
  requireComment: v.boolean(),
  requireManager: v.boolean(),
})

export const cashOperationTypeData = v.object({
  kind: v.literal("cash-operation-type"),
  direction: v.union(v.literal("cash-in"), v.literal("cash-out")),
  cashAccount: v.string(),
  correspondingAccount: v.string(),
  cashflowCategory: v.optional(v.string()),
  maximumAmount: v.number(),
  requireManager: v.boolean(),
})

export const retailSettingData = v.union(paymentTypeData, orderTypeData, discountTypeData, deletionReasonData, cashOperationTypeData)

export const retailKind = v.union(v.literal("payment-type"), v.literal("order-type"), v.literal("discount-type"), v.literal("deletion-reason"), v.literal("cash-operation-type"))

export const RETAIL_MODULES = {
  "payment-type": "payment-types",
  "order-type": "order-types",
  "discount-type": "discount-types",
  "deletion-reason": "deletion-reasons",
  "cash-operation-type": "cash-operations",
} as const

export type RetailKind = keyof typeof RETAIL_MODULES
