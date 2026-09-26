import { useCallback, useSyncExternalStore } from "react"
import { useConvex } from "convex/react"

import { syncStateFrom } from "@/pos/components/app-header"
import { ruT } from "@/pos/i18n"

/** Shown under the header and next to the blocked buttons while the Convex link is down (`t("error.offline")` in the POS). */
export const OFFLINE_MESSAGE = ruT("error.offline")

/**
 * True while the terminal has lost its link to the server (the header's «Нет связи»). Subscribes to the
 * Convex connection but re-renders only when the answer flips — requests in flight do not re-render the
 * cashier screen (LiveSyncIndicator follows those).
 */
export function useServerOffline() {
  const convex = useConvex()
  const subscribe = useCallback((onChange: () => void) => convex.subscribeToConnectionState(() => onChange()), [convex])
  const offline = useCallback(() => syncStateFrom(convex.connectionState()) === "offline", [convex])
  return useSyncExternalStore(subscribe, offline, () => false)
}
