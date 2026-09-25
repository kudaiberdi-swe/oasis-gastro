import type { Doc, Id } from "../../_generated/dataModel"

export type PosProduct = Omit<Doc<"products">, "basePrice"> & {
  price: number // resolved for the requesting restaurant: productPrices row, or products.basePrice as fallback
  available: boolean // false — on the restaurant's stop list right now
  imageUrl?: string // uploaded photo (storage) or the static imagePath
}

export type PosCategory = Doc<"categories">

export type ProductLookup = Map<Id<"products">, PosProduct>
