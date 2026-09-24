import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionReference, PaginationOptions, PaginationResult } from "convex/server"

/** List arguments every register query takes (W0-UI-03 backend contract). */
export type ListArgs = { status?: string; search?: string; restaurantExternalId?: string }

export type PaginatedList<Row> = {
  results: Row[]
  status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted"
  loadMore: (count: number) => void
}

/** What the engine pages need from a module — a Convex adapter or a mock. */
export type ModuleApi<Row, Id extends string = string> = {
  useList: (args: ListArgs) => PaginatedList<Row>
  useGet: (id: Id | null) => Row | null | undefined
  useSave: () => (values: Record<string, unknown> & { id?: Id; publish?: boolean }) => Promise<Id>
  useTransition?: () => (args: { id: Id; to: string; reason?: string }) => Promise<void>
}

type ListRef<Row> = FunctionReference<"query", "public", ListArgs & { paginationOpts: PaginationOptions }, PaginationResult<Row>>
type GetRef<Row, Id> = FunctionReference<"query", "public", { id: Id }, Row | null>
type SaveRef<Id> = FunctionReference<"mutation", "public", Record<string, unknown>, Id>
type TransitionRef<Id> = FunctionReference<"mutation", "public", { id: Id; to: string; reason?: string }, unknown>

export const PAGE_SIZE = 50

/**
 * Typed adapter over a module's Convex functions — `defineModuleApi({ list: api.domains.x.queries.list, … })`.
 * Replaces bahandi's `(api as any)[name]` lookups: a wrong function or argument shape fails typecheck.
 */
export function defineModuleApi<Row, Id extends string>(refs: {
  list: ListRef<Row>
  get: GetRef<Row, Id>
  save: SaveRef<Id>
  transition?: TransitionRef<Id>
}): ModuleApi<Row, Id> {
  return {
    useList: (args) => usePaginatedQuery(refs.list, args, { initialNumItems: PAGE_SIZE }) as PaginatedList<Row>,
    // A generic Id defeats Convex's overload resolution for "skip"; the ref type still pins { id }.
    useGet: (id) => useQuery(refs.get as FunctionReference<"query">, id ? { id } : "skip") as Row | null | undefined,
    useSave: () => {
      const save = useMutation(refs.save)
      return (values) => save(values)
    },
    useTransition: refs.transition
      ? () => {
          const transition = useMutation(refs.transition!)
          return async (args) => {
            await transition(args)
          }
        }
      : undefined,
  }
}
