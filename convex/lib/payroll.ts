import { ConvexError } from "convex/values"

// Kazakhstan payroll (W2-HR-06), ported from bahandi's calculateKzPayroll with whole-tenge rounding
// (payroll in KZ accounting is kept in tenge — see the plan's blockers).

export type PayrollRules = {
  mzp: number
  mrp: number
  opvRate: number
  opvMaxMzp: number
  vosmsRate: number
  vosmsMaxMzp: number
  oosmsRate: number
  oosmsMaxMzp: number
  opvrRate: number
  socialContributionRate: number
  socialTaxRate: number
  basicDeductionMrp: number
  ipnRate: number
  ipnHighRate: number
  ipnAnnualThresholdMrp: number
}

export const RULE_KEYS: (keyof PayrollRules)[] = ["mzp", "mrp", "opvRate", "opvMaxMzp", "vosmsRate", "vosmsMaxMzp", "oosmsRate", "oosmsMaxMzp", "opvrRate", "socialContributionRate", "socialTaxRate", "basicDeductionMrp", "ipnRate", "ipnHighRate", "ipnAnnualThresholdMrp"]

/** 2026 values from the bahandi fixture — seeded as a draft; the accountant checks and activates them. */
export const RULES_2026: PayrollRules = { mzp: 85_000, mrp: 4_325, opvRate: 0.1, opvMaxMzp: 50, vosmsRate: 0.02, vosmsMaxMzp: 20, oosmsRate: 0.03, oosmsMaxMzp: 40, opvrRate: 0.035, socialContributionRate: 0.05, socialTaxRate: 0.06, basicDeductionMrp: 30, ipnRate: 0.1, ipnHighRate: 0.15, ipnAnnualThresholdMrp: 8_500 }

export function normalizeRules(value: Partial<Record<keyof PayrollRules, unknown>>): PayrollRules {
  const rules = {} as PayrollRules
  for (const key of RULE_KEYS) {
    const number = Number(value[key])
    if (!Number.isFinite(number) || number < 0) throw new ConvexError(`Правило «${key}» должно быть неотрицательным числом`)
    if (key.endsWith("Rate") && number > 1) throw new ConvexError(`Ставка «${key}» — доля от 0 до 1`)
    rules[key] = number
  }
  return rules
}

const round = (value: number) => Math.round(value)

/** Employee withholdings, employer taxes and net pay for one month's gross; taxableYtdBefore drives the IPN band. */
export function calculateKzPayroll(gross: number, applyBasicDeduction: boolean, rules: PayrollRules, taxableYtdBefore = 0) {
  const opv = round(Math.min(gross, rules.opvMaxMzp * rules.mzp) * rules.opvRate)
  const vosms = round(Math.min(gross, rules.vosmsMaxMzp * rules.mzp) * rules.vosmsRate)
  const deduction = applyBasicDeduction ? rules.basicDeductionMrp * rules.mrp : 0
  const taxable = Math.max(0, gross - opv - vosms - deduction)
  const annualHighThreshold = rules.ipnAnnualThresholdMrp * rules.mrp
  const lowerBandRemaining = Math.max(0, annualHighThreshold - taxableYtdBefore)
  const ipn = round(Math.min(taxable, lowerBandRemaining) * rules.ipnRate + Math.max(0, taxable - lowerBandRemaining) * rules.ipnHighRate)
  const oosms = round(Math.min(gross, rules.oosmsMaxMzp * rules.mzp) * rules.oosmsRate)
  const opvr = round(Math.min(gross, rules.opvMaxMzp * rules.mzp) * rules.opvrRate)
  const socialContribution = round(Math.max(0, gross - opv) * rules.socialContributionRate)
  const socialTax = round(Math.max(0, gross - opv - vosms) * rules.socialTaxRate)
  const employeeTaxes = opv + vosms + ipn
  const employerTaxes = oosms + opvr + socialContribution + socialTax
  return { opv, vosms, ipn, oosms, opvr, socialContribution, socialTax, taxable: round(taxable), employeeTaxes, employerTaxes, net: gross - employeeTaxes }
}
