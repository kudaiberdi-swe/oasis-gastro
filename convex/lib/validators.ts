import { v } from "convex/values"

export const employeeRole = v.union(v.literal("cashier"), v.literal("manager"), v.literal("administrator"), v.literal("kitchen"))

export const unit = v.union(v.literal("кг"), v.literal("л"), v.literal("шт"), v.literal("порц."))

export const orderStatus = v.union(
  v.literal("draft"),
  v.literal("held"),
  v.literal("paid"),
  v.literal("cancelled"),
  v.literal("partially_refunded"),
  v.literal("refunded"),
)

/**
 * A menu group's color on the POS (POS-DESIGN §2.3): one of the cat-* design tokens, never a hex.
 * cat-turkistan is left out on purpose — it marks dishes of the Turkistan menu, not a group.
 */
export const categoryColorToken = v.union(v.literal("cat-meat"), v.literal("cat-dairy"), v.literal("cat-bread"), v.literal("cat-green"), v.literal("cat-tea"))

export const orderType = v.union(v.literal("dine-in"), v.literal("takeaway"), v.literal("delivery"))

export const paymentMethod = v.union(v.literal("card"), v.literal("cash"), v.literal("qr"))

export const kitchenStatus = v.union(
  v.literal("queued"),
  v.literal("preparing"),
  v.literal("ready"),
  v.literal("completed"),
  v.literal("cancelled"),
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
  modifiers: v.optional(v.array(v.string())), // free-text kitchen notes
  sizeExternalId: v.optional(v.string()),
  modifierSelections: v.optional(v.array(v.object({ modifierExternalId: v.string(), quantity: v.number() }))),
})

/** Status of an office domain record (OFFICE-DESIGN §3.5 lifecycles). */
export const officeDomainStatus = v.union(
  v.literal("draft"),
  v.literal("pending-approval"),
  v.literal("approved"),
  v.literal("posted"),
  v.literal("reversed"),
  v.literal("cancelled"),
  v.literal("active"),
  v.literal("inactive"),
  v.literal("published"),
  v.literal("expired"),
)
