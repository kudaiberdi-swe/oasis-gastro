import { Field, Input, Select } from "@/shared/components/ui"

import { PROMPT_STAGE_LABELS, SERVICE_MODE_LABELS } from "../../data/use-retail-settings"
import type { OrderDraft } from "../../model/setting-draft"
import { Flag, FlagGrid, SettingBlock, type KindFieldsProps } from "./field-kit"

const MODE_OPTIONS = Object.entries(SERVICE_MODE_LABELS).map(([value, label]) => ({ value, label }))
const STAGE_OPTIONS = Object.entries(PROMPT_STAGE_LABELS).map(([value, label]) => ({ value, label }))

/** «Режим обслуживания»: mode, when the cashier is asked, default flag and the service charge (D5). */
export function OrderFields({ data, onChange, errors, readOnly }: KindFieldsProps<OrderDraft>) {
  return (
    <SettingBlock title="Режим обслуживания">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Режим">
          {(control) => <Select {...control} value={data.serviceMode} onValueChange={(value) => onChange({ serviceMode: value as OrderDraft["serviceMode"] })} options={MODE_OPTIONS} disabled={readOnly} />}
        </Field>
        <Field label="Этап запроса" hint="Когда касса спрашивает тип заказа">
          {(control) => <Select {...control} value={data.promptStage} onValueChange={(value) => onChange({ promptStage: value as OrderDraft["promptStage"] })} options={STAGE_OPTIONS} disabled={readOnly} />}
        </Field>
        <Field label="Сервисный сбор, %" error={errors.serviceChargePercent} hint="От 0 до 30 %">
          {(control) => <Input {...control} inputMode="decimal" value={data.serviceChargePercent} onChange={(event) => onChange({ serviceChargePercent: event.target.value })} disabled={readOnly} autoComplete="off" />}
        </Field>
      </div>
      <FlagGrid>
        <Flag label="По умолчанию" hint="Касса выбирает этот тип сама" checked={data.isDefault} onCheckedChange={(isDefault) => onChange({ isDefault })} disabled={readOnly} />
      </FlagGrid>
    </SettingBlock>
  )
}
