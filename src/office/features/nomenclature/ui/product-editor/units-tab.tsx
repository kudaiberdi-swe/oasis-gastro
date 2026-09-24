import { Field, Input, Select } from "@/shared/components/ui"

import { UNITS, type ProductCard, type ProductUnit } from "../../data/use-nomenclature"
import type { DraftErrors, ProductDraft } from "../../model/use-product-draft"
import { Block } from "./main-tab"

const UNIT_OPTIONS = UNITS.map((value) => ({ value, label: value }))

/** «Единицы измерения»: the base unit and the one unit-weight field the recipe card also uses (L-20). */
export function UnitsTab({ card, draft, errors, set, readOnly }: { card: ProductCard; draft: ProductDraft; errors: DraftErrors; set: (patch: Partial<ProductDraft>) => void; readOnly: boolean }) {
  const iiko = card.source === "iiko-server"
  return (
    <Block title="Единицы измерения">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Основная единица измерения" hint={iiko ? "Меняется в iiko" : undefined}>
          {(control) => <Select {...control} value={draft.baseUnit} onValueChange={(value) => set({ baseUnit: value as ProductUnit })} options={UNIT_OPTIONS} disabled={readOnly || iiko} />}
        </Field>
        <Field label="Вес одной единицы, кг" error={errors.unitWeightKg} hint="Нужен для штучных и жидких позиций: по нему техкарта пересчитывает единицы в килограммы">
          {(control) => (
            <Input {...control} inputMode="decimal" placeholder="0,25" value={draft.unitWeightKg} onChange={(event) => set({ unitWeightKg: event.target.value })} disabled={readOnly} autoComplete="off" />
          )}
        </Field>
      </div>
    </Block>
  )
}
