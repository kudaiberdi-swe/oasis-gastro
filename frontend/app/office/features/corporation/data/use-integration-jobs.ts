import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"

import { api } from "@convex/_generated/api"
import type { JobStatus } from "../model/corporation"

// «Очередь интеграций» (W2-ADM-09) over convex/domains/integrations. The list is paginated on the server;
// the card reads getIntegrationJob, whose payload and result come with secrets masked.

export const JOB_PAGE_SIZE = 50
/** Tab counters read one page per status; above it the tab shows «50+». */
export const JOB_COUNT_LIMIT = 50

const queries = api.domains.integrations.queries
const mutations = api.domains.integrations.mutations

export type IntegrationJobRow = FunctionReturnType<typeof queries.listIntegrationJobs>["page"][number]
export type IntegrationJobDetails = NonNullable<FunctionReturnType<typeof queries.getIntegrationJob>>

export function useIntegrationJobs(args: { status?: JobStatus; provider?: string }) {
  return usePaginatedQuery(queries.listIntegrationJobs, args, { initialNumItems: JOB_PAGE_SIZE })
}

/** One status: the count on its tab, «N+» when there are more than one page. */
export function useJobStatusCount(status: JobStatus, provider: string | undefined): { count: number; more: boolean } | undefined {
  const page = useQuery(queries.listIntegrationJobs, { status, provider, paginationOpts: { numItems: JOB_COUNT_LIMIT, cursor: null } })
  return page ? { count: page.page.length, more: !page.isDone } : undefined
}

export function useIntegrationJob(externalId: string | null) {
  return useQuery(queries.getIntegrationJob, externalId ? { externalId } : "skip")
}

export function useIntegrationJobMutations() {
  return { retryIntegrationJob: useMutation(mutations.retryIntegrationJob), cancelIntegrationJob: useMutation(mutations.cancelIntegrationJob) }
}

/** Counters for the status tabs (fixed order of hooks). */
export function useJobTabCounts(provider: string | undefined): Partial<Record<JobStatus, { count: number; more: boolean }>> {
  const queued = useJobStatusCount("queued", provider)
  const processing = useJobStatusCount("processing", provider)
  const retrying = useJobStatusCount("retrying", provider)
  const failed = useJobStatusCount("failed", provider)
  const deadLetter = useJobStatusCount("dead-letter", provider)
  const completed = useJobStatusCount("completed", provider)
  return { queued, processing, retrying, failed, "dead-letter": deadLetter, completed }
}
