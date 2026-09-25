import { useEffect, useRef } from "react"

/**
 * An error banner at the top of a scrolled panel or dialog is out of sight when the buttons below raised it:
 * whenever `trigger` becomes truthy (a new message) the element scrolls into view (the nearest edge, no jump
 * when it is already visible) and takes focus, so the user sees and hears it. Give the element tabIndex={-1}.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(trigger: unknown) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!trigger) return
    const element = ref.current
    if (!element) return
    element.scrollIntoView?.({ block: "nearest" })
    element.focus?.({ preventScroll: true })
  }, [trigger])
  return ref
}
