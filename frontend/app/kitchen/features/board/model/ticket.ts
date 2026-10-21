import type { KitchenStatus } from "@/shared/types/pos"

export type BoardStatus = Extract<KitchenStatus, "queued" | "preparing" | "ready">

// The board's three columns are the three active statuses (validators.ts kitchenStatus): queued → «Новые»,
// preparing → «Готовятся», ready → «Готово». completed lives in the journal «Выданные», cancelled fades out.
export const BOARD_COLUMNS: Array<{ status: BoardStatus; title: string }> = [
  { status: "queued", title: "Новые" },
  { status: "preparing", title: "Готовятся" },
  { status: "ready", title: "Готово" },
]

/** The one step forward from each column. «Готово» is the ticket's only primary button. */
export const NEXT_STEP: Record<BoardStatus, { status: KitchenStatus; label: string; primary: boolean }> = {
  queued: { status: "preparing", label: "Начать готовить", primary: false },
  preparing: { status: "ready", label: "Готово", primary: true },
  ready: { status: "completed", label: "Выдать", primary: false },
}

/** Bump-back: one step back, for a tap made too early. */
export const PREVIOUS_STEP: Partial<Record<KitchenStatus, { status: KitchenStatus; label: string }>> = {
  preparing: { status: "queued", label: "Новые" },
  ready: { status: "preparing", label: "Готовятся" },
  completed: { status: "ready", label: "Готово" },
}

export const STATIONS: Array<{ value: string | undefined; label: string }> = [
  { value: undefined, label: "Все" },
  { value: "hot", label: "Горячий цех" },
  { value: "cold", label: "Холодный" },
  { value: "bar", label: "Бар" },
  { value: "bakery", label: "Выпечка" },
]

const FULFILLMENT_LABEL: Record<string, string> = { "dine-in": "В зале", takeaway: "С собой", delivery: "Доставка" }
const SOURCE_LABEL: Record<string, string> = { pos: "Касса", delivery: "Доставка", kiosk: "Киоск" }

/** «Стол 5 · Касса», «С собой · Киоск», «Доставка» — table or order type, then the source. */
export function ticketOrigin(ticket: { tableLabel?: string; fulfillment: string; source: string }) {
  const table = ticket.tableLabel?.trim()
  const place = table ? (/^\d+$/.test(table) ? `Стол ${table}` : table) : (FULFILLMENT_LABEL[ticket.fulfillment] ?? ticket.fulfillment)
  const source = SOURCE_LABEL[ticket.source] ?? ticket.source
  return place === source ? place : `${place} · ${source}`
}

/** The badge of a ticket that did not come from the till (W2-KDS-01): «Доставка» / «Киоск». */
export function channelBadge(source: string): string | null {
  if (source === "delivery") return "Доставка"
  if (source === "kiosk") return "Киоск"
  return null
}

export type InstructionKind = "remove" | "add" | "note"

/** Kitchen modifiers arrive as «БЕЗ ЛУКА», «+СЫР ×2»; anything else is a free note. */
export function instructionKind(text: string): InstructionKind {
  const value = text.trim()
  if (/^без\s/i.test(value) || /^[-−]\s*\S/.test(value)) return "remove"
  if (value.startsWith("+")) return "add"
  return "note"
}

/** 1 → «1 активный», 2 → «2 активных», 21 → «21 активный». */
export function activeCountLabel(count: number) {
  const one = count % 10 === 1 && count % 100 !== 11
  return `${count} ${one ? "активный" : "активных"}`
}
