import { useEffect } from "react"
import { useBlocker } from "react-router"

export type SaveState = "clean" | "dirty" | "saving" | "saved"

/**
 * Warns before leaving a page with unsaved edits: the browser prompt on reload/close, and a blocked
 * router navigation the page confirms with `<UnsavedChangesDialog blocker={…} />`.
 */
export function useUnsavedChanges(dirty: boolean) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname)

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [dirty])

  return blocker
}
