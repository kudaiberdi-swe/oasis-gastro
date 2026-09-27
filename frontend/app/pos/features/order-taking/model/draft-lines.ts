import type { Id } from "@convex/_generated/dataModel"
import { modifierLabel, modifierLabelsKk, type ModifierSelectionInput } from "@/pos/features/catalog/model/modifier-selection"

// Lines of a POS draft (W1-POS-12/13/15). Local-first: the cashier sees the line at once, the server
// prices it on the next saveDraft and its answer is merged back by clientLineId. A line the kitchen
// already has (sentToKitchenAt) or a removed one (voidedAt) is fixed on the server: saveDraft must
// repeat a sent line unchanged and never resend a voided one.

export type OrderDraftLine = {
  /** Stable for the life of the line: the server recognises lines already sent to the kitchen by it. */
  clientLineId: string
  productId: string
  name: string
  nameKk: string
  /** One portion with its modifiers; the server's number after each save. */
  unitPrice: number
  quantity: number
  /** Legacy free-text kitchen notes. */
  modifiers: string[]
  sizeExternalId?: string
  sizeLabel?: string
  /** Only lines made in the modifier dialog carry this; plain dishes leave it out. */
  modifierSelections?: ModifierSelectionInput[]
  /** «без лука», «+сыр ×2» — what differs from the dish's defaults. */
  modifierLabels: string[]
  /** «пиязсыз», «+ірімшік ×2» — only when every changed modifier has a Kazakh name. */
  modifierLabelsKk?: string[]
  /** orderLines _id from the last server answer (needed for voidLine). */
  serverLineId?: string
  sentToKitchenAt?: number
  voidedAt?: number
}

/** What the catalog hands to the draft: a plain dish, or one configured in the modifier dialog. */
export type CatalogItem = {
  productId: string
  name: string
  nameKk: string
  /** Preview price of one portion (with modifiers); the server sets the real one. */
  price: number
  quantity?: number
  sizeExternalId?: string
  sizeLabel?: string
  modifierSelections?: ModifierSelectionInput[]
  modifierLabels?: string[]
  modifierLabelsKk?: string[]
}

/** A line as getCheck / saveDraft / sendToKitchen / voidLine return it (hydrateOrder). */
export type ServerOrderLine = {
  _id?: string
  clientLineId?: string
  productId: string
  productName: string
  unitPrice: number
  quantity: number
  modifiers: string[]
  sizeExternalId?: string
  sizeLabel?: string
  modifierSelections?: Array<{ externalId: string; name: string; quantity: number; unitPrice: number }>
  kitchenModifiers?: Array<{ externalId: string; label: string; quantity: number; defaultQuantity: number }>
  /** Kazakh names of the line's changed modifiers (hydrateOrder resolves them; the line stores none). */
  modifierNamesKk?: Array<{ externalId: string; nameKk: string }>
  lineTotal?: number
  sentToKitchenAt?: number
  voidedAt?: number
  product: { nameKk: string } | null
}

export const lineTotal = (line: Pick<OrderDraftLine, "unitPrice" | "quantity">) => Math.round(line.unitPrice * line.quantity)

/** On the kitchen ticket or removed: the cashier can no longer change it directly. */
export const isLocked = (line: Pick<OrderDraftLine, "sentToKitchenAt" | "voidedAt">) => Boolean(line.sentToKitchenAt || line.voidedAt)

export const isActive = (line: Pick<OrderDraftLine, "voidedAt">) => !line.voidedAt

export const hasUnsentLines = (lines: OrderDraftLine[]) => lines.some((line) => !isLocked(line))

export const itemCount = (lines: OrderDraftLine[]) => lines.filter(isActive).reduce((sum, line) => sum + line.quantity, 0)

export const activeSubtotal = (lines: OrderDraftLine[]) => lines.filter(isActive).reduce((sum, line) => sum + lineTotal(line), 0)

function sameSelections(a: ModifierSelectionInput[] | undefined, b: ModifierSelectionInput[] | undefined) {
  const key = (rows: ModifierSelectionInput[] | undefined) =>
    rows
      ? rows
          .map((row) => `${row.modifierExternalId}:${row.quantity}`)
          .sort()
          .join("|")
      : null
  return key(a) === key(b)
}

/** Adds a dish: the same configuration on an editable line adds to its quantity, else a new line. */
export function addCatalogItem(lines: OrderDraftLine[], item: CatalogItem, newId: () => string = () => crypto.randomUUID()): OrderDraftLine[] {
  const quantity = item.quantity ?? 1
  const existing = lines.find(
    (line) => !isLocked(line) && line.productId === item.productId && line.sizeExternalId === item.sizeExternalId && sameSelections(line.modifierSelections, item.modifierSelections),
  )
  if (existing) return lines.map((line) => (line === existing ? { ...line, quantity: line.quantity + quantity } : line))
  return [
    ...lines,
    {
      clientLineId: newId(),
      productId: item.productId,
      name: item.name,
      nameKk: item.nameKk,
      unitPrice: item.price,
      quantity,
      modifiers: [],
      sizeExternalId: item.sizeExternalId,
      sizeLabel: item.sizeLabel,
      modifierSelections: item.modifierSelections,
      modifierLabels: item.modifierLabels ?? [],
      modifierLabelsKk: item.modifierLabelsKk,
    },
  ]
}

/** Changes an editable line's quantity (0 removes it). Sent and voided lines are left untouched. */
export function setLineQuantity(lines: OrderDraftLine[], clientLineId: string, quantity: number): OrderDraftLine[] {
  const target = lines.find((line) => line.clientLineId === clientLineId)
  if (!target || isLocked(target)) return lines
  return quantity <= 0 ? lines.filter((line) => line !== target) : lines.map((line) => (line === target ? { ...line, quantity } : line))
}

/** The saveDraft `lines` argument: sent lines repeated as they are, voided ones never resent. */
export function toDraftLineInputs(lines: OrderDraftLine[]) {
  return lines.filter(isActive).map((line) => ({
    clientLineId: line.clientLineId,
    productId: line.productId as Id<"products">,
    quantity: line.quantity,
    modifiers: line.modifiers,
    ...(line.sizeExternalId ? { sizeExternalId: line.sizeExternalId } : {}),
    ...(line.modifierSelections ? { modifierSelections: line.modifierSelections } : {}),
  }))
}

/** One portion as the server priced it: size or base price plus the paid part of the modifiers. */
function serverUnitPrice(line: ServerOrderLine) {
  if (line.lineTotal !== undefined && line.quantity > 0 && !line.modifierSelections?.length) return line.lineTotal / line.quantity
  return line.unitPrice + (line.modifierSelections ?? []).reduce((sum, modifier) => sum + modifier.unitPrice * modifier.quantity, 0)
}

function serverModifierLabels(line: ServerOrderLine) {
  return (line.kitchenModifiers ?? []).map((change) => {
    const name = line.modifierSelections?.find((selection) => selection.externalId === change.externalId)?.name ?? change.label.replace(/^(БЕЗ |\+)/, "").replace(/ ×\d+$/, "")
    return modifierLabel(name, change.quantity, change.defaultQuantity)
  })
}

function serverModifierLabelsKk(line: ServerOrderLine) {
  const names = new Map((line.modifierNamesKk ?? []).map((row) => [row.externalId, row.nameKk]))
  return modifierLabelsKk((line.kitchenModifiers ?? []).map((change) => ({ nameKk: names.get(change.externalId), quantity: change.quantity, defaultQuantity: change.defaultQuantity })))
}

export function fromServerLine(line: ServerOrderLine, newId: () => string = () => crypto.randomUUID()): OrderDraftLine {
  const selections = line.modifierSelections?.map((selection) => ({ modifierExternalId: selection.externalId, quantity: selection.quantity }))
  // A removed default («без лука») is kept by the server only in kitchenModifiers; resend it as quantity 0.
  const removed = (line.kitchenModifiers ?? []).filter((change) => change.quantity === 0).map((change) => ({ modifierExternalId: change.externalId, quantity: 0 }))
  return {
    clientLineId: line.clientLineId ?? (line._id ? String(line._id) : newId()),
    productId: line.productId,
    name: line.productName,
    nameKk: line.product?.nameKk ?? line.productName,
    unitPrice: serverUnitPrice(line),
    quantity: line.quantity,
    modifiers: line.modifiers,
    sizeExternalId: line.sizeExternalId,
    sizeLabel: line.sizeLabel,
    modifierSelections: selections ? [...selections, ...removed] : undefined,
    modifierLabels: serverModifierLabels(line),
    modifierLabelsKk: serverModifierLabelsKk(line),
    serverLineId: line._id,
    sentToKitchenAt: line.sentToKitchenAt,
    voidedAt: line.voidedAt,
  }
}

/**
 * Folds a server answer into the local lines. Local lines keep their order and quantity (a newer
 * edit may still be on its way); the server's price, ids and kitchen/void marks win. Sent or voided
 * lines the cashier does not have locally (another device, a void) are appended.
 */
export function mergeServerLines(local: OrderDraftLine[], server: ServerOrderLine[]): OrderDraftLine[] {
  const byClientId = new Map(server.filter((line) => line.clientLineId).map((line) => [line.clientLineId!, line]))
  const merged = local.map((line) => {
    const match = byClientId.get(line.clientLineId)
    if (!match) return line
    const fresh = fromServerLine(match)
    // A locked line is exactly what the server has; an editable one keeps the local quantity.
    return isLocked(fresh) ? { ...fresh, clientLineId: line.clientLineId } : { ...line, unitPrice: fresh.unitPrice, serverLineId: fresh.serverLineId, sizeLabel: fresh.sizeLabel ?? line.sizeLabel }
  })
  const known = new Set(local.map((line) => line.clientLineId))
  for (const line of server) {
    if (!(line.sentToKitchenAt || line.voidedAt)) continue
    const id = line.clientLineId ?? (line._id ? String(line._id) : undefined)
    if (id && !known.has(id)) merged.push(fromServerLine(line))
  }
  return merged
}

/** «Большой · +сыр · без лука» under the dish name. */
export function lineDetails(line: Pick<OrderDraftLine, "sizeLabel" | "modifierLabels" | "modifiers">) {
  return [line.sizeLabel, ...line.modifierLabels, ...line.modifiers].filter(Boolean).join(" · ")
}

/** «пиязсыз · +ірімшік» under the Russian details, when the line's modifiers have Kazakh names. */
export function lineDetailsKk(line: Pick<OrderDraftLine, "modifierLabels" | "modifierLabelsKk">) {
  const labels = line.modifierLabelsKk
  if (!labels?.length || labels.join("|") === line.modifierLabels.join("|")) return null
  return labels.join(" · ")
}
