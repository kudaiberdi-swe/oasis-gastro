import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"

import { api } from "@convex/_generated/api"
import { applyOrder } from "../model/favorites"

// «Избранное» (W3-ADM-13) over domains/office/favorites: one live list shared by the star in the page
// header, /office/favorites and «Быстрый доступ» of the start page (the same subscription).

const favorites = api.domains.office.favorites

export type OfficeFavorite = FunctionReturnType<typeof favorites.listFavorites>[number]

/** undefined while loading. */
export function useOfficeFavorites(): OfficeFavorite[] | undefined {
  return useQuery(favorites.listFavorites, {})
}

export function useFavoriteActions() {
  // The star and «Убрать» answer at once; the server list replaces the guess a moment later.
  const toggle = useMutation(favorites.toggleFavorite).withOptimisticUpdate((store, args) => {
    const list = store.getQuery(favorites.listFavorites, {})
    if (!list) return
    const id = `${args.kind}:${args.targetId}`
    if (list.some((item) => item.id === id)) store.setQuery(favorites.listFavorites, {}, list.filter((item) => item.id !== id))
    else if (args.kind !== "report")
      store.setQuery(favorites.listFavorites, {}, [...list, { id, kind: args.kind, targetId: args.targetId, label: args.label, sortOrder: (list.at(-1)?.sortOrder ?? -1) + 1 }])
  })
  const reorder = useMutation(favorites.reorderFavorites).withOptimisticUpdate((store, args) => {
    const list = store.getQuery(favorites.listFavorites, {})
    if (list) store.setQuery(favorites.listFavorites, {}, applyOrder(list, args.ids))
  })
  return { toggle, reorder }
}
