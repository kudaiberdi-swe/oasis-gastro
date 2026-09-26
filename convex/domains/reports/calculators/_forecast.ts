import type { Calculator } from "../registry"

// Kitchen demand forecast for the production reports (W3-RPT-02: production-11, 12, 13 — one source,
// L-14). TEMPORARY: to be replaced by `kitchenForecast` of convex/lib/forecast.ts (W3-PRD-07) after
// merge — keep the inputs and the output shape minimal so the swap is a one-line change. Rule of the
// plan: the average demand of the same weekday over the six weeks before the target date, from the
// daily product sales facts (business dates are Almaty dates already); a weekday without sales counts
// as zero demand.

type QueryCtx = Parameters<Calculator>[0]

export const FORECAST_WEEKS = 6

export type ForecastLine = { productExternalId: string; name: string; recommended: number }

const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

/** Recommended portions per dish for one restaurant and business date, largest first; zero demand is left out. */
export async function forecastFromFacts(ctx: QueryCtx, args: { restaurantExternalId: string; targetDate: string }): Promise<ForecastLine[]> {
  const sums = new Map<string, { name: string; quantity: number }>()
  for (let week = 1; week <= FORECAST_WEEKS; week += 1) {
    const date = shiftDate(args.targetDate, -7 * week)
    // One day's product facts of one restaurant: a row per dish sold that day.
    for await (const fact of ctx.db.query("dailySalesFacts").withIndex("by_restaurant_type_date", (q) => q.eq("restaurantExternalId", args.restaurantExternalId).eq("factType", "product").eq("businessDate", date))) {
      const sum = sums.get(fact.dimensionKey) ?? { name: fact.dimensionLabel, quantity: 0 }
      sum.quantity += fact.quantity
      sums.set(fact.dimensionKey, sum)
    }
  }
  return [...sums.entries()]
    .map(([productExternalId, sum]) => ({ productExternalId, name: sum.name, recommended: Math.round(sum.quantity / FORECAST_WEEKS) }))
    .filter((line) => line.recommended > 0)
    .sort((a, b) => b.recommended - a.recommended || a.name.localeCompare(b.name, "ru"))
}
