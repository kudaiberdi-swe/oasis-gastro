import { useMemo, useState } from "react"

import type { SaveSizeScaleArgs, SizeScale } from "../data/use-size-scales"

// Editor draft of a size scale (W1-CAT-09): rows are edited as text, validated before the server call.

export interface SizeOptionDraft {
  /** Stable React key; the server externalId when the size already exists. */
  key: string
  externalId?: string
  label: string
  labelKk: string
  kitchenLabel: string
  coefficient: string
  writeOffCoefficient: string
  isDefault: boolean
  available: boolean
}

export interface SizeScaleDraft {
  name: string
  options: SizeOptionDraft[]
  productExternalIds: string[]
}

export type SizeOptionErrors = Partial<Record<"label" | "kitchenLabel" | "coefficient" | "writeOffCoefficient", string>>

export interface SizeScaleErrors {
  name?: string
  options?: string
  rows: Record<string, SizeOptionErrors>
}

let keySeed = 0
function newKey() {
  keySeed += 1
  return `size-draft-${keySeed}`
}

export function emptyOption(isDefault = false): SizeOptionDraft {
  return { key: newKey(), label: "", labelKk: "", kitchenLabel: "", coefficient: "1", writeOffCoefficient: "", isDefault, available: true }
}

function coefficientText(value: number) {
  return String(value).replace(".", ",")
}

export function draftFromScale(scale: SizeScale | null): SizeScaleDraft {
  if (!scale) return { name: "", options: [emptyOption(true)], productExternalIds: [] }
  return {
    name: scale.name,
    options: [...scale.options]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((option) => ({
        key: option.externalId,
        externalId: option.externalId,
        label: option.label,
        labelKk: option.labelKk ?? "",
        kitchenLabel: option.kitchenLabel,
        coefficient: coefficientText(option.coefficient),
        // The server returns the price coefficient when no separate write-off one is set.
        writeOffCoefficient: option.writeOffCoefficient === option.coefficient ? "" : coefficientText(option.writeOffCoefficient),
        isDefault: option.isDefault,
        available: option.available,
      })),
    productExternalIds: scale.products.map((product) => product.externalId),
  }
}

/** "1,5" or "1.5" → 1.5; empty or junk → null. */
export function parseDecimal(text: string): number | null {
  const clean = text.trim().replace(",", ".")
  if (!clean || !/^\d*\.?\d+$/.test(clean)) return null
  return Number(clean)
}

export function validateScaleDraft(draft: SizeScaleDraft): SizeScaleErrors {
  const errors: SizeScaleErrors = { rows: {} }
  if (!draft.name.trim()) errors.name = "Укажите название шкалы"
  if (draft.options.length === 0) errors.options = "Добавьте хотя бы один размер"
  else if (draft.options.filter((option) => option.isDefault).length !== 1) errors.options = "Отметьте ровно один размер по умолчанию"
  for (const option of draft.options) {
    const row: SizeOptionErrors = {}
    if (!option.label.trim()) row.label = "Название для кассира"
    if (!option.kitchenLabel.trim()) row.kitchenLabel = "Название для кухни"
    const coefficient = parseDecimal(option.coefficient)
    if (coefficient === null || !(coefficient > 0)) row.coefficient = "Больше нуля"
    if (option.writeOffCoefficient.trim()) {
      const writeOff = parseDecimal(option.writeOffCoefficient)
      if (writeOff === null || !(writeOff > 0)) row.writeOffCoefficient = "Больше нуля"
    }
    if (Object.keys(row).length > 0) errors.rows[option.key] = row
  }
  return errors
}

export function hasScaleErrors(errors: SizeScaleErrors) {
  return Boolean(errors.name || errors.options || Object.keys(errors.rows).length > 0)
}

export function saveScaleArgs(externalId: string | undefined, draft: SizeScaleDraft): SaveSizeScaleArgs {
  return {
    ...(externalId ? { externalId } : {}),
    name: draft.name.trim(),
    options: draft.options.map((option, index) => {
      const writeOff = option.writeOffCoefficient.trim() ? parseDecimal(option.writeOffCoefficient) : null
      return {
        ...(option.externalId ? { externalId: option.externalId } : {}),
        label: option.label.trim(),
        ...(option.labelKk.trim() ? { labelKk: option.labelKk.trim() } : {}),
        kitchenLabel: option.kitchenLabel.trim(),
        coefficient: parseDecimal(option.coefficient) ?? 0,
        ...(writeOff !== null ? { writeOffCoefficient: writeOff } : {}),
        sortOrder: (index + 1) * 10,
        isDefault: option.isDefault,
        available: option.available,
      }
    }),
    productExternalIds: draft.productExternalIds,
  }
}

export function useSizeScaleDraft(scale: SizeScale | null) {
  const [baseline, setBaseline] = useState(() => draftFromScale(scale))
  const [draft, setDraft] = useState(baseline)
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline])

  const updateOption = (key: string, patch: Partial<SizeOptionDraft>) =>
    setDraft((current) => ({ ...current, options: current.options.map((option) => (option.key === key ? { ...option, ...patch } : option)) }))

  return {
    draft,
    dirty,
    setName: (name: string) => setDraft((current) => ({ ...current, name })),
    setProducts: (productExternalIds: string[]) => setDraft((current) => ({ ...current, productExternalIds })),
    updateOption,
    setDefault: (key: string) => setDraft((current) => ({ ...current, options: current.options.map((option) => ({ ...option, isDefault: option.key === key })) })),
    addOption: () => setDraft((current) => ({ ...current, options: [...current.options, emptyOption(current.options.length === 0)] })),
    removeOption: (key: string) => setDraft((current) => ({ ...current, options: current.options.filter((option) => option.key !== key) })),
    moveOption: (key: string, direction: -1 | 1) =>
      setDraft((current) => {
        const index = current.options.findIndex((option) => option.key === key)
        const target = index + direction
        if (index < 0 || target < 0 || target >= current.options.length) return current
        const options = [...current.options]
        ;[options[index], options[target]] = [options[target], options[index]]
        return { ...current, options }
      }),
    markSaved: () => setBaseline(draft),
  }
}
