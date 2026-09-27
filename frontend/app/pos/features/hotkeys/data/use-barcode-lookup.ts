import { useConvex } from "convex/react"
import { useCallback } from "react"

import { api } from "@convex/_generated/api"

/** One read per scan (catalog.findByBarcode): the product priced for the session's branch, or null. */
export function useBarcodeLookup(sessionToken: string) {
  const convex = useConvex()
  return useCallback((barcode: string) => convex.query(api.domains.catalog.queries.findByBarcode, { sessionToken, barcode }), [convex, sessionToken])
}
