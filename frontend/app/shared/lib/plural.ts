// Russian plural forms for user-visible counts («1 запись», «3 записи», «12 записей»).

export type PluralForms = [one: string, few: string, many: string]

/** Russian plural: 1 запись, 2–4 записи, 5+ записей (11–14 → записей). */
export function plural(count: number, [one, few, many]: PluralForms) {
  const abs = Math.abs(Math.trunc(count))
  const mod10 = abs % 10
  const mod100 = abs % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export const RECORDS: PluralForms = ["запись", "записи", "записей"]

/** «1 запись», «3 записи», «12 записей» — the register counters (never «1 записей»). */
export const recordCount = (count: number) => `${count} ${plural(count, RECORDS)}`
