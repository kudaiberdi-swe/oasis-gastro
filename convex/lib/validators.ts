import { v } from "convex/values"

export const employeeRole = v.union(v.literal("cashier"), v.literal("manager"), v.literal("administrator"))

export const orderStatus = v.union(
  v.literal("draft"),
  v.literal("held"),
  v.literal("paid"),
  v.literal("cancelled"),
  v.literal("partially_refunded"),
  v.literal("refunded"),
)

export const orderType = v.union(v.literal("dine-in"), v.literal("takeaway"))

export const paymentMethod = v.union(v.literal("card"), v.literal("cash"), v.literal("qr"))

export const kitchenStatus = v.union(
  v.literal("queued"),
  v.literal("preparing"),
  v.literal("ready"),
  v.literal("completed"),
)

export const sessionPurpose = v.union(v.literal("operator"), v.literal("manager-approval"))

/** One payment leg of a checkout — cash tender includes `tendered` for change calculation. */
export const paymentPart = v.object({
  method: paymentMethod,
  amount: v.number(),
  tendered: v.optional(v.number()),
})

/** A line being added/updated on a draft order. Server re-prices from `productId` — never trusts `unitPrice`. */
export const draftLineInput = v.object({
  clientLineId: v.optional(v.string()),
  productId: v.id("products"),
  quantity: v.number(),
  modifiers: v.optional(v.array(v.string())),
})
