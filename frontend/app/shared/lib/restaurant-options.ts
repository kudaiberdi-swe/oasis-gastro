// Restaurant pickers: two restaurants may share a name (a seeded «Ресторан Алматы» next to the one imported
// from iiko, or names differing only in spaces). Such options get a caption — the city when it tells them
// apart, otherwise the restaurant code — so the choice is never a guess.

export type RestaurantLike = { externalId: string; name: string; city?: string | null }
export type RestaurantOption = { value: string; label: string; hint?: string }

/** Names compare as people read them: case, spaces and Unicode form do not matter. */
const nameKey = (name: string) => name.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("ru")

/** The code shown for a restaurant: an iiko UUID is shortened to its first block, a readable code stays. */
export function restaurantCode(externalId: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(externalId) ? externalId.slice(0, 8) : externalId
}

/** Select / Combobox options; `hint` only where the name repeats. */
export function restaurantSelectOptions(restaurants: readonly RestaurantLike[] | null | undefined): RestaurantOption[] {
  const groups = new Map<string, RestaurantLike[]>()
  for (const restaurant of restaurants ?? []) {
    const key = nameKey(restaurant.name)
    groups.set(key, [...(groups.get(key) ?? []), restaurant])
  }
  return (restaurants ?? []).map((restaurant) => {
    const label = restaurant.name.replace(/\s+/g, " ").trim() || restaurant.externalId
    const group = groups.get(nameKey(restaurant.name)) ?? []
    if (group.length < 2) return { value: restaurant.externalId, label }
    const cities = group.map((row) => row.city?.trim() ?? "")
    const citiesTell = cities.every(Boolean) && new Set(cities.map(nameKey)).size === group.length
    return { value: restaurant.externalId, label, hint: citiesTell ? restaurant.city!.trim() : `код ${restaurantCode(restaurant.externalId)}` }
  })
}
