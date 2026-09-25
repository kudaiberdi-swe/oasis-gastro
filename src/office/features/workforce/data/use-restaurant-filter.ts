import { useState } from "react"

import { usePlatformScope } from "@/office/features/platform/data/use-platform"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

const ALL_RESTAURANTS = "__all__"

/**
 * Restaurant filter of the staff registers. Both queries already limit rows to the user's restaurants,
 * so «Все рестораны» is offered to everyone who has more than one.
 */
export function useRestaurantFilter() {
  const scope = usePlatformScope()
  const [value, setValue] = useState(ALL_RESTAURANTS)
  const options = [{ value: ALL_RESTAURANTS, label: "Все рестораны" }, ...restaurantSelectOptions(scope.restaurants)]
  return {
    loading: scope.loading,
    value,
    setValue,
    options,
    visible: scope.restaurants.length > 1,
    restaurantExternalId: value === ALL_RESTAURANTS ? undefined : value,
    restaurants: scope.restaurants,
    restaurantName: scope.restaurantName,
  }
}
