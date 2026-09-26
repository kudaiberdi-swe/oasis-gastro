// Cashier hotkeys (W3-POS-01, PLAN §4.1): F2 search, F4 payment, F8 hold, Esc close. A key never acts
// while the cashier types in a field or while a dialog is open — the dialog owns the keyboard (Radix
// closes itself on Esc). The same list is shown in «Профиль сотрудника».

export type PosHotkeyAction = "search" | "pay" | "hold" | "close"

export const POS_HOTKEYS: { key: string; keyLabel: string; action: PosHotkeyAction; label: string }[] = [
  { key: "F2", keyLabel: "F2", action: "search", label: "Поиск по меню" },
  { key: "F4", keyLabel: "F4", action: "pay", label: "Оплата заказа" },
  { key: "F8", keyLabel: "F8", action: "hold", label: "Отложить заказ" },
  { key: "Escape", keyLabel: "Esc", action: "close", label: "Закрыть окно или экран кухни" },
]

const ACTION_BY_KEY = new Map(POS_HOTKEYS.map((hotkey) => [hotkey.key, hotkey.action]))

export const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]'

const TEXT_ROLES = new Set(["textbox", "combobox", "searchbox", "spinbutton"])

/** Inputs, text areas, selects, contenteditable and ARIA text widgets: typing there is not a hotkey. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  if (target.isContentEditable || target.getAttribute("contenteditable") === "true") return true
  return TEXT_ROLES.has(target.getAttribute("role") ?? "")
}

/** A modal dialog is open (Radix renders its content only while open) or the key comes from inside one. */
export function isInDialog(target: EventTarget | null, doc: Document = document): boolean {
  if (target instanceof Element && target.closest(DIALOG_SELECTOR)) return true
  return doc.querySelector(DIALOG_SELECTOR) !== null
}

type KeyInput = Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey" | "repeat" | "defaultPrevented" | "target">

/** The action of a keydown, or null: not in the map, with a modifier, held down, typed in a field or under a dialog. */
export function hotkeyAction(event: KeyInput, doc: Document = document): PosHotkeyAction | null {
  if (event.defaultPrevented || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return null
  const action = ACTION_BY_KEY.get(event.key)
  if (!action) return null
  if (isEditableTarget(event.target) || isInDialog(event.target, doc)) return null
  return action
}
