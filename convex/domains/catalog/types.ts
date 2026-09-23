import type { Doc, Id } from "../../_generated/dataModel"

export type PosProduct = Omit<Doc<"products">, "basePrice"> & {
  price: number // resolved for the requesting restaurant: productPrices row, or products.basePrice as fallback
}

export type PosCategory = Doc<"categories">

export type ProductLookup = Map<Id<"products">, PosProduct>
