import { useEffect, useRef } from "react"

import { createScanDetector } from "../model/barcode-scanner"
import { hotkeyAction, isEditableTarget, isInDialog, type PosHotkeyAction } from "../model/hotkeys"

/** Handlers of the cashier screen; one returning false did nothing (Esc with nothing to close keeps its default). */
export type PosHotkeyHandlers = Partial<Record<PosHotkeyAction, () => boolean | void>>

/** F2 / F4 / F8 / Esc on the cashier screen (W3-POS-01). The latest handlers are used without re-subscribing. */
export function usePosHotkeys(handlers: PosHotkeyHandlers, enabled = true) {
  const latest = useRef(handlers)
  latest.current = handlers
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      const action = hotkeyAction(event)
      if (!action) return
      const handled = latest.current[action]?.()
      // F-keys are ours on this screen (no browser F2/F4/F8 behaviour); Esc only when it closed something.
      if (action !== "close" || handled !== false) event.preventDefault()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled])
}

/** Marks a field the scanner may type into (the catalog search): a scan there still counts. */
export const BARCODE_FIELD_ATTRIBUTE = { "data-barcode-scan": "allow" } as const

export type ScanSource = { fromField: boolean }

/**
 * The barcode scanner as fast keyboard input (W3-POS-01). Listens in the capture phase so the closing
 * Enter of a scan is taken before it presses a focused button. Ignored inside dialogs and in any field
 * other than the one marked with BARCODE_FIELD_ATTRIBUTE.
 */
export function useBarcodeScanner(onScan: (code: string, source: ScanSource) => void, enabled = true) {
  const latest = useRef(onScan)
  latest.current = onScan
  useEffect(() => {
    if (!enabled) return
    const detector = createScanDetector()
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      const editable = isEditableTarget(target)
      const scanField = editable && target instanceof HTMLElement && target.dataset.barcodeScan === "allow"
      if (event.ctrlKey || event.altKey || event.metaKey || isInDialog(target) || (editable && !scanField)) {
        detector.reset()
        return
      }
      const code = detector.key(event.key, event.timeStamp)
      if (!code) return
      event.preventDefault()
      event.stopPropagation()
      latest.current(code, { fromField: scanField })
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [enabled])
}
