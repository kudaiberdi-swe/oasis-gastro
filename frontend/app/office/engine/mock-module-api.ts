import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"

import type { ListArgs, ModuleApi, PaginatedList } from "./define-module-api"

/**
 * In-memory ModuleApi for reference configs, the dev showcase and tests — same contract as a Convex
 * module: paginated list with status/search, get, save (server assigns the number), transition.
 */
export function createMockModuleApi<Row extends { id: string; status?: string }>(options: {
  initial: Row[]
  pageSize?: number
  search?: (row: Row) => string
  create: (values: Record<string, unknown>, index: number) => Row
  update: (row: Row, values: Record<string, unknown>) => Row
}): ModuleApi<Row> & { snapshot: () => Row[] } {
  let rows = [...options.initial]
  let version = 0
  const listeners = new Set<() => void>()
  const emit = () => {
    version += 1
    listeners.forEach((listener) => listener())
  }
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  }
  const useVersion = () => useSyncExternalStore(subscribe, () => version)
  const pageSize = options.pageSize ?? 50

  return {
    snapshot: () => rows,
    useList: (args: ListArgs): PaginatedList<Row> => {
      const current = useVersion()
      const [limit, setLimit] = useLimit(pageSize, `${args.status}|${args.search}`)
      const filtered = useMemo(() => {
        void current
        const query = args.search?.toLocaleLowerCase("ru")
        return rows.filter((row) => (!args.status || row.status === args.status) && (!query || (options.search?.(row) ?? JSON.stringify(row)).toLocaleLowerCase("ru").includes(query)))
      }, [current, args.status, args.search])
      return {
        results: filtered.slice(0, limit),
        status: filtered.length > limit ? "CanLoadMore" : "Exhausted",
        loadMore: (count) => setLimit(limit + count),
      }
    },
    useGet: (id) => {
      const current = useVersion()
      return useMemo(() => {
        void current
        return id ? (rows.find((row) => row.id === id) ?? null) : null
      }, [current, id])
    },
    useSave: () =>
      useCallback(async (values) => {
        const { id, publish, ...rest } = values
        if (id) {
          rows = rows.map((row) => (row.id === id ? options.update(row, { ...rest, ...(publish ? { status: "published" } : {}) }) : row))
          emit()
          return id
        }
        const created = options.create({ ...rest, ...(publish ? { status: "published" } : {}) }, rows.length + 1)
        rows = [created, ...rows]
        emit()
        return created.id
      }, []),
    useTransition: () =>
      useCallback(async ({ id, to }) => {
        rows = rows.map((row) => (row.id === id ? { ...row, status: to } : row))
        emit()
      }, []),
  }
}

function useLimit(pageSize: number, resetKey: string) {
  const [limit, setLimit] = useState(pageSize)
  useEffect(() => setLimit(pageSize), [pageSize, resetKey])
  return [limit, setLimit] as const
}
