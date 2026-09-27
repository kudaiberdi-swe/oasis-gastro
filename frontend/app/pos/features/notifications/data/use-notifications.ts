import { useMutation, usePaginatedQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"

import { api } from "@convex/_generated/api"

export type PosNotification = FunctionReturnType<typeof api.domains.pos.queries.notifications>["page"][number]

export const NOTIFICATIONS_PAGE_SIZE = 20

/** The terminal's notifications with this employee's read flag; the badge counts the loaded unread ones. */
export function useNotifications(sessionToken: string | null) {
  const result = usePaginatedQuery(api.domains.pos.queries.notifications, sessionToken ? { sessionToken } : "skip", { initialNumItems: NOTIFICATIONS_PAGE_SIZE })
  const items = result.results as PosNotification[]
  return {
    items,
    status: result.status,
    unread: items.filter((item) => !item.read).length,
    loadMore: () => result.loadMore(NOTIFICATIONS_PAGE_SIZE),
    markRead: useMutation(api.domains.pos.mutations.markNotificationRead),
  }
}
