import { useMutation, useQuery } from "convex/react"

import { api } from "@convex/_generated/api"

export function useOfficeContext() {
  const context = useQuery(api.domains.office.queries.context)
  const bootstrap = useMutation(api.domains.office.mutations.bootstrap)
  return { context, bootstrap: () => bootstrap({}) }
}
