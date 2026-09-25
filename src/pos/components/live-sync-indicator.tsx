import { useEffect, useState } from "react"
import { useConvexConnectionState } from "convex/react"

import { SyncIndicator, syncStateFrom } from "@/pos/components/app-header"

// A request in flight longer than this shows «Синхронизация…»; quicker ones never flash.
const SLOW_MS = 1500

/**
 * «Синхронизировано» from the live Convex connection. Its own component, so connection changes
 * (every mutation in flight) re-render only the indicator, not the cashier screen.
 */
export function LiveSyncIndicator() {
  const connection = useConvexConnectionState()
  const pending = connection.hasInflightRequests
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!pending) {
      setSlow(false)
      return
    }
    const timer = window.setTimeout(() => setSlow(true), SLOW_MS)
    return () => window.clearTimeout(timer)
  }, [pending])
  return <SyncIndicator state={syncStateFrom(connection, slow)} />
}
