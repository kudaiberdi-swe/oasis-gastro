import { allowsCapability } from "./capabilities"
import type { OfficeNavigationGroup } from "./navigation"

/** Items the user has no right to are hidden, and so are groups left empty. */
export function filterNavigationByCapabilities(groups: OfficeNavigationGroup[], capabilities: readonly string[]): OfficeNavigationGroup[] {
  return groups.map((group) => ({ ...group, items: group.items.filter((item) => allowsCapability(capabilities, item.capability)) })).filter((group) => group.items.length > 0)
}

function normalize(text: string) {
  return text.toLocaleLowerCase("ru").replace(/ё/g, "е").trim()
}

/** Matches the label and the description; every word of the query must match somewhere. */
export function searchNavigation(groups: OfficeNavigationGroup[], query: string): OfficeNavigationGroup[] {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return groups
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const haystack = normalize(`${item.label} ${item.description} ${group.label}`)
        return words.every((word) => haystack.includes(word))
      }),
    }))
    .filter((group) => group.items.length > 0)
}
