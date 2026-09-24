import type { Doc } from "../_generated/dataModel"

type AccountType = Doc<"accounts">["type"]

// System accounts of the Kazakhstan standard chart that postings of other domains refer to (W1-FIN-02).
// Domain code uses only these keys, never names or codes (B-18); codes are the standard chart draft
// until the accountant confirms them (blocker Б-1), and change here without touching domain code.
const DEFINITIONS = {
  cash: { code: "1010", name: "Денежные средства в кассе", type: "asset" },
  bank: { code: "1030", name: "Денежные средства на текущих банковских счетах", type: "asset" },
  inTransit: { code: "1060", name: "Прочие денежные средства (эквайринг, Kaspi QR в пути)", type: "asset" },
  receivables: { code: "1210", name: "Дебиторская задолженность покупателей", type: "asset" },
  rawMaterials: { code: "1310", name: "Сырьё и материалы", type: "asset" },
  finishedGoods: { code: "1320", name: "Готовая продукция (заготовки)", type: "asset" },
  goods: { code: "1330", name: "Товары", type: "asset" },
  vatRecoverable: { code: "1420", name: "НДС к возмещению", type: "asset" },
  ipn: { code: "3120", name: "Индивидуальный подоходный налог", type: "liability" },
  vatPayable: { code: "3130", name: "НДС к уплате", type: "liability" },
  socialTax: { code: "3150", name: "Социальный налог", type: "liability" },
  socialContrib: { code: "3210", name: "Обязательства по социальному страхованию (СО)", type: "liability" },
  pensionContrib: { code: "3220", name: "Обязательства по пенсионным отчислениям (ОПВ, ОПВР)", type: "liability" },
  medicalContrib: { code: "3230", name: "Обязательства по ОСМС (ВОСМС, ООСМС)", type: "liability" },
  payables: { code: "3310", name: "Кредиторская задолженность поставщикам и подрядчикам", type: "liability" },
  payroll: { code: "3350", name: "Задолженность по оплате труда", type: "liability" },
  loyaltyLiability: { code: "3510", name: "Обязательства по программе лояльности (оценочные)", type: "liability" },
  revenue: { code: "6010", name: "Доход от реализации продукции и услуг", type: "income" },
  salesReturns: { code: "6020", name: "Возврат проданной продукции", type: "contra-income" },
  serviceRevenue: { code: "6030", name: "Доход от оказания услуг", type: "income" },
  otherIncome: { code: "6280", name: "Прочие доходы", type: "income" },
  cogs: { code: "7010", name: "Себестоимость реализованной продукции", type: "expense" },
  aggregatorCommission: { code: "7110", name: "Расходы по реализации (комиссии)", type: "expense" },
  serviceExpense: { code: "7210", name: "Расходы на услуги", type: "expense" },
  staffExpense: { code: "7211", name: "Расходы на персонал", type: "expense" },
  employerTaxExpense: { code: "7212", name: "Налоги и отчисления работодателя", type: "expense" },
  cashShortage: { code: "7480", name: "Недостачи и прочие расходы", type: "expense" },
  inventoryVariance: { code: "7481", name: "Инвентаризационные расхождения", type: "expense" },
} as const satisfies Record<string, { code: string; name: string; type: AccountType }>

export type SystemAccountKey = keyof typeof DEFINITIONS

export type SystemAccount = { key: SystemAccountKey; externalId: string; code: string; name: string; type: AccountType }

export const accountExternalId = (code: string) => `acc-${code}`

/** key → account; `SYSTEM_ACCOUNTS.cash.externalId` is what a posting stores. */
export const SYSTEM_ACCOUNTS = Object.fromEntries(
  Object.entries(DEFINITIONS).map(([key, value]) => [key, { key, externalId: accountExternalId(value.code), ...value }]),
) as { [K in SystemAccountKey]: SystemAccount & { key: K } }

export function isSystemAccountKey(value: string): value is SystemAccountKey {
  return Object.prototype.hasOwnProperty.call(DEFINITIONS, value)
}
