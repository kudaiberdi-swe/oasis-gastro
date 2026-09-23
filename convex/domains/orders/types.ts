import type { Doc, Id } from "../../_generated/dataModel"

export type PricedLine = {
  clientLineId?: string
  productId: Id<"products">
  product: Doc<"products">
  quantity: number
  unitPrice: number
  modifiers: string[]
}

export type CheckoutResult = {
  orderId: Id<"orders">
  number: number
  total: number
  duplicate: boolean
  receipt: HydratedOrder
}

export type HydratedOrder = Doc<"orders"> & {
  lines: Array<
    Doc<"orderLines"> & {
      product: {
        externalId: string
        name: string
        nameKk: string
        description: string
        category: string
      } | null
    }
  >
  payments: Doc<"payments">[]
  createdByName: string
  createdByRole?: string
}
