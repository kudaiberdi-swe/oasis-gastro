import { useMutation, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"

import { api } from "../../../../../convex/_generated/api"

// «Группы товаров» (W1-CAT-03): the category hierarchy over convex/domains/catalog/office.

const office = api.domains.catalog.office

export type ProductGroup = FunctionReturnType<typeof office.listProductGroups>[number]
export type SaveProductGroupArgs = FunctionArgs<typeof office.saveProductGroup>
export type ProductGroupNode = ProductGroup & { depth: number }

/** All groups, inactive included (the office edits them); undefined while loading. */
export function useProductGroups() {
  return useQuery(office.listProductGroups, { includeInactive: true })
}

export function useSaveProductGroup() {
  return useMutation(office.saveProductGroup)
}

const byOrder = (a: ProductGroup, b: ProductGroup) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "ru")

/**
 * Depth-first order of the tree by parentExternalId: a group follows its parent, siblings by
 * «Порядок». A group whose parent is missing is shown as a root; a cycle never loops.
 */
export function flattenGroupTree(groups: readonly ProductGroup[]): ProductGroupNode[] {
  const known = new Set(groups.map((group) => group.externalId))
  const children = new Map<string | null, ProductGroup[]>()
  for (const group of groups) {
    const parent = group.parentExternalId && known.has(group.parentExternalId) && group.parentExternalId !== group.externalId ? group.parentExternalId : null
    const list = children.get(parent) ?? []
    list.push(group)
    children.set(parent, list)
  }
  const result: ProductGroupNode[] = []
  const visited = new Set<string>()
  const visit = (parent: string | null, depth: number) => {
    for (const group of (children.get(parent) ?? []).sort(byOrder)) {
      if (visited.has(group.externalId)) continue
      visited.add(group.externalId)
      result.push({ ...group, depth })
      visit(group.externalId, depth + 1)
    }
  }
  visit(null, 0)
  // Groups caught in a cycle have no root above them: list them flat so they stay editable.
  for (const group of [...groups].sort(byOrder)) if (!visited.has(group.externalId)) result.push({ ...group, depth: 0 })
  return result
}

/** The group and everything under it — none of them can become its parent. */
export function descendantsOf(groups: readonly ProductGroup[], externalId: string) {
  const result = new Set([externalId])
  let grew = true
  while (grew) {
    grew = false
    for (const group of groups) {
      if (group.parentExternalId && result.has(group.parentExternalId) && !result.has(group.externalId)) {
        result.add(group.externalId)
        grew = true
      }
    }
  }
  return result
}

/** Select options with the tree shown by a dash per level. */
export function groupOptions(nodes: readonly ProductGroupNode[]) {
  return nodes.map((node) => ({ value: node.externalId, label: `${"— ".repeat(node.depth)}${node.label}` }))
}
