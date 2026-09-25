import {
  defaultQuantities,
  defaultSize,
  modifierLabels,
  toModifierSelections,
  unitPrice,
  type ModifierQuantities,
  type ProductConfiguration,
} from "@/pos/features/catalog/model/modifier-selection"

import type { DishChoice } from "./order-draft"

// Size and modifiers of a delivery line (W2-DLV-05) over the server's productConfiguration — the same
// shape and the same rules as the POS dialog (src/pos/features/catalog/model/modifier-selection.ts).
// The price is a preview; saveOrder prices the line (priceDraftLines) and the saved order shows it.

/** Nothing to choose: the dish is added at once, without the dialog. */
export function needsDialog(configuration: Pick<ProductConfiguration, "sizes" | "groups">) {
  return configuration.sizes.length > 0 || configuration.groups.length > 0
}

/** The line's size if it is still offered, else the default one. */
export function initialSize(configuration: ProductConfiguration, sizeExternalId: string | null | undefined) {
  return configuration.sizes.find((size) => size.externalId === sizeExternalId)?.externalId ?? defaultSize(configuration.sizes)?.externalId
}

/**
 * Quantities to start the dialog with. A line's selections list every chosen option (and a removed
 * default with 0), so an option missing there is not chosen; no selections at all means the defaults.
 */
export function initialQuantities(configuration: ProductConfiguration, selections: readonly { modifierExternalId: string; quantity: number }[]): ModifierQuantities {
  const quantities = defaultQuantities(configuration.groups)
  if (!selections.length) return quantities
  const chosen = new Map(selections.map((selection) => [selection.modifierExternalId, selection.quantity]))
  for (const externalId of Object.keys(quantities)) quantities[externalId] = chosen.get(externalId) ?? 0
  return quantities
}

/** The dialog's choice as a line of the order form (saveOrder sends sizeExternalId and modifierSelections). */
export function dishChoice(configuration: ProductConfiguration, sizeExternalId: string | undefined, quantities: ModifierQuantities, quantity: number): DishChoice {
  const size = configuration.sizes.find((candidate) => candidate.externalId === sizeExternalId)
  return {
    productExternalId: configuration.product.externalId,
    name: configuration.product.name,
    price: unitPrice(configuration, size?.externalId, quantities),
    quantity,
    sizeExternalId: size?.externalId ?? null,
    sizeLabel: size?.label ?? null,
    modifierSelections: toModifierSelections(configuration.groups, quantities),
    modifierLabels: modifierLabels(configuration.groups, quantities),
  }
}
