import { useQueries } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"
import { useEffect, useMemo, useState } from "react"

import { api } from "../../../../../convex/_generated/api"

// «Стартовая страница» over domains/platform/queries.dashboard (W1-ADM-05): the server checks
// `office.dashboard.view` and the restaurant scope and reads only aggregates (dailySalesFacts, document
// counts, integrationJobs). The subscription is live — a sale at the POS moves the numbers without F5.

const dashboardQuery = api.domains.platform.queries.dashboard

export type DashboardArgs = FunctionArgs<typeof dashboardQuery>
export type DashboardData = FunctionReturnType<typeof dashboardQuery>
export type DashboardRestaurant = DashboardData["restaurants"][number]

/** The error comes back as a value (useQueries), so the page shows a banner with «Повторить» instead of crashing. */
export function useDashboard(args: DashboardArgs) {
  const [retrying, setRetrying] = useState(false)
  useEffect(() => {
    if (retrying) setRetrying(false)
  }, [retrying])
  const key = retrying ? null : JSON.stringify(args)
  const queries = useMemo(() => {
    const request: Parameters<typeof useQueries>[0] = {}
    if (key !== null) request.dashboard = { query: dashboardQuery, args: JSON.parse(key) as DashboardArgs }
    return request
  }, [key])
  const value = useQueries(queries).dashboard as DashboardData | Error | undefined
  return {
    data: value instanceof Error ? undefined : value,
    error: value instanceof Error ? value : undefined,
    loading: key === null || value === undefined,
    retry: () => setRetrying(true),
  }
}
