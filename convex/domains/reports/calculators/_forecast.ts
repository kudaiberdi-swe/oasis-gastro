import { kitchenForecast } from "../../../lib/forecast"
import type { Calculator } from "../registry"

// Kitchen demand forecast for the production reports (W3-RPT-02: production-11, 12, 13) — the one forecast
// of «План на кухню» and «Ведомость полуфабрикатов» (convex/lib/forecast.ts, W3-PRD-07, L-14), so the
// reports and the kitchen screens never disagree.

type QueryCtx = Parameters<Calculator>[0]

export { FORECAST_WEEKS } from "../../../lib/forecast"

export type ForecastLine = { productExternalId: string; name: string; recommended: number }

/** Recommended portions per dish for one restaurant and business date, largest first; zero demand is left out. */
export async function forecastFromFacts(ctx: QueryCtx, args: { restaurantExternalId: string; targetDate: string }): Promise<ForecastLine[]> {
  const forecast = await kitchenForecast(ctx, args)
  return forecast.products
    .map((product) => ({ productExternalId: product.productExternalId, name: product.name, recommended: product.recommendedQuantity }))
    .filter((line) => line.recommended > 0)
    .sort((a, b) => b.recommended - a.recommended || a.name.localeCompare(b.name, "ru"))
}
