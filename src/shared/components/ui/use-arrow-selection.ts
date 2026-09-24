import { useRef, type FocusEvent, type KeyboardEvent } from "react"

const ARROW_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"])

/**
 * Radix radio groups move focus with the arrows but, in our composition, do not check the newly focused
 * item. Selection follows focus only when an arrow key moved it (a mouse or Tab focus never selects).
 */
export function useArrowSelection(onSelect: ((value: string) => void) | undefined) {
  const arrowPressed = useRef(false)
  return {
    onKeyDownCapture: (event: KeyboardEvent) => {
      arrowPressed.current = ARROW_KEYS.has(event.key)
    },
    itemFocus: (value: string) => (_event: FocusEvent) => {
      if (!arrowPressed.current) return
      arrowPressed.current = false
      onSelect?.(value)
    },
  }
}
