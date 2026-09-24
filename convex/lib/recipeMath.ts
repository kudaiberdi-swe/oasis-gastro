// Recipe card math (W1-RCP-01), shared by the office card and sale write-off so both compute the same
// numbers: gross = quantity × weight of one unit; net = gross after cold losses; output = net after
// hot losses. Money in tenge, weights in kg.

export type RecipeMathLine = {
  unit: "кг" | "л" | "шт"
  quantity: number
  /** kg per unit; 1 for кг. */
  unitWeightKg: number
  coldLossPercent: number
  hotLossPercent: number
  /** Cost of one unit of the line (₸ per кг / л / шт). */
  unitCost: number
}

export type CalculatedLine = RecipeMathLine & { grossKg: number; netKg: number; outputKg: number; cost: number }

export type RecipeSummary = {
  lines: CalculatedLine[]
  grossKg: number
  netKg: number
  outputKg: number
  costPerBatch: number
  costPerPortion: number
  portionOutputG: number
}

export type RecipeCheck = { code: "units" | "yield" | "batch" | "costs" | "date"; ok: boolean; message: string }

const clampPercent = (value: number) => Math.min(99, Math.max(0, value))

export function weightKg(line: Pick<RecipeMathLine, "unit" | "quantity" | "unitWeightKg">) {
  return line.quantity * (line.unit === "кг" ? 1 : line.unitWeightKg)
}

export function calculateLine(line: RecipeMathLine): CalculatedLine {
  const grossKg = weightKg(line)
  const netKg = grossKg * (1 - clampPercent(line.coldLossPercent) / 100)
  const outputKg = netKg * (1 - clampPercent(line.hotLossPercent) / 100)
  return { ...line, grossKg, netKg, outputKg, cost: line.quantity * line.unitCost }
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits

export function calculateRecipe(lines: RecipeMathLine[], batchYield: number): RecipeSummary {
  const calculated = lines.map(calculateLine)
  const portions = batchYield > 0 ? batchYield : 1
  const total = (key: "grossKg" | "netKg" | "outputKg" | "cost") => calculated.reduce((sum, line) => sum + line[key], 0)
  const outputKg = total("outputKg")
  const costPerBatch = total("cost")
  return {
    lines: calculated,
    grossKg: round(total("grossKg"), 4),
    netKg: round(total("netKg"), 4),
    outputKg: round(outputKg, 4),
    costPerBatch: Math.round(costPerBatch),
    costPerPortion: Math.round(costPerBatch / portions),
    portionOutputG: Math.round((outputKg / portions) * 1000),
  }
}

/** Food cost % of the selling price (one decimal); null without a price. */
export function foodCostPercent(costPerPortion: number, price: number) {
  return price > 0 ? Math.round((costPerPortion / price) * 1000) / 10 : null
}

export function recipeChecks(args: { lines: RecipeMathLine[]; summary: RecipeSummary; batchYield: number; effectiveFrom: number; firstSaleAt?: number }): RecipeCheck[] {
  const unitsOk = args.lines.every((line) => line.unit === "кг" || line.unitWeightKg > 0)
  const costsOk = args.lines.length > 0 && args.lines.every((line) => line.unitCost > 0)
  const dateOk = args.firstSaleAt === undefined || args.effectiveFrom <= args.firstSaleAt
  return [
    { code: "units", ok: unitsOk, message: unitsOk ? "Единицы приведены к килограммам" : "Укажите вес единицы для строк в л и шт" },
    { code: "yield", ok: args.summary.outputKg > 0, message: args.summary.outputKg > 0 ? "Выход готового продукта рассчитан" : "Выход должен быть больше нуля" },
    { code: "batch", ok: args.batchYield > 0, message: args.batchYield > 0 ? "Норма закладки указана" : "Количество порций должно быть больше нуля" },
    { code: "costs", ok: costsOk, message: costsOk ? "Себестоимость без нулевых ингредиентов" : "У части ингредиентов нет складской цены" },
    { code: "date", ok: dateOk, message: dateOk ? "Начало действия не позже первой продажи" : "Первая продажа была раньше начала действия техкарты" },
  ]
}
