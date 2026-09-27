import { Field, Input, Select } from "@/shared/components/ui"

import { DISCOUNT_MODE_LABELS } from "../../data/use-retail-settings"
import type { DiscountDraft } from "../../model/setting-draft"
import { Flag, FlagGrid, SettingBlock, type KindFieldsProps } from "./field-kit"

const MODE_OPTIONS = Object.entries(DISCOUNT_MODE_LABELS).map(([value, label]) => ({ value, label }))

/** «Расчёт скидки / надбавки»: kind, size, thresholds, priority and how it is applied. */
export function DiscountFields({ data, onChange, errors, readOnly }: KindFieldsProps<DiscountDraft>) {
  const fixed = data.mode === "fixed"
  return (
    <SettingBlock title="Расчёт скидки / надбавки">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Вид">
          {(control) => <Select {...control} value={data.mode} onValueChange={(value) => onChange({ mode: value as DiscountDraft["mode"] })} options={MODE_OPTIONS} disabled={readOnly} />}
        </Field>
        <Field label={fixed ? "Размер, ₸" : "Размер, %"} error={errors.value}>
          {(control) => <Input {...control} inputMode="decimal" value={data.value} onChange={(event) => onChange({ value: event.target.value })} disabled={readOnly} autoComplete="off" />}
        </Field>
        <Field label="Минимальная сумма заказа, ₸" error={errors.minimumOrder}>
          {(control) => <Input {...control} inputMode="numeric" value={data.minimumOrder} onChange={(event) => onChange({ minimumOrder: event.target.value })} disabled={readOnly} autoComplete="off" />}
        </Field>
        <Field label="Приоритет" error={errors.priority} hint="Меньше — применяется раньше">
          {(control) => <Input {...control} inputMode="numeric" value={data.priority} onChange={(event) => onChange({ priority: event.target.value })} disabled={readOnly} autoComplete="off" />}
        </Field>
        <Field label="Подтверждение менеджера выше, %" error={errors.managerApprovalAbove} hint="0 — без подтверждения">
          {(control) => (
            <Input {...control} inputMode="decimal" value={data.managerApprovalAbove} onChange={(event) => onChange({ managerApprovalAbove: event.target.value })} disabled={readOnly} autoComplete="off" />
          )}
        </Field>
      </div>
      <FlagGrid error={errors.manual}>
        {/* Manual and automatic exclude each other: turning one on turns the other off. */}
        <Flag label="Ручная" hint="Кассир назначает на заказ" checked={data.manual} onCheckedChange={(manual) => onChange({ manual, ...(manual ? { automatic: false } : {}) })} disabled={readOnly} />
        <Flag label="Автоматическая" hint="Применяется по условиям сама" checked={data.automatic} onCheckedChange={(automatic) => onChange({ automatic, ...(automatic ? { manual: false } : {}) })} disabled={readOnly} />
        <Flag label="Комбинируемая" hint="Совместима с другими скидками" checked={data.combinable} onCheckedChange={(combinable) => onChange({ combinable })} disabled={readOnly} />
      </FlagGrid>
    </SettingBlock>
  )
}
