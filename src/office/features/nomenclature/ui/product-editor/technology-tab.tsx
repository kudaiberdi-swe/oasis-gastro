import { Field, Textarea } from "@/shared/components/ui"

import type { ProductCard } from "../../data/use-nomenclature"
import type { ProductDraft } from "../../model/use-product-draft"
import { Block } from "./main-tab"

/** «Технология приготовления»: free-text instruction for the kitchen. */
export function TechnologyTab({ card, draft, set, readOnly }: { card: ProductCard; draft: ProductDraft; set: (patch: Partial<ProductDraft>) => void; readOnly: boolean }) {
  const iiko = card.source === "iiko-server"
  return (
    <Block title="Технология приготовления">
      <Field label="Инструкция" hint={iiko ? "Для товара из iiko технология ведётся в iiko" : "Инструкция отображается в технологической карте и доступна сотрудникам кухни"}>
        {(control) => <Textarea {...control} rows={12} className="resize-y" value={draft.technology} onChange={(event) => set({ technology: event.target.value })} disabled={readOnly || iiko} />}
      </Field>
    </Block>
  )
}
