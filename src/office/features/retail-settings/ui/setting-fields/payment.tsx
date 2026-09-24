import { Field, Select } from "@/shared/components/ui"

import { PROCESSOR_LABELS } from "../../data/use-retail-settings"
import type { PaymentDraft } from "../../model/setting-draft"
import { AccountField, Flag, FlagGrid, SettingBlock, type KindFieldsProps } from "./field-kit"

const PROCESSOR_OPTIONS = Object.entries(PROCESSOR_LABELS).map(([value, label]) => ({ value, label }))

/** «Поведение оплаты»: processing, the money account and seven flags. */
export function PaymentFields({ data, onChange, errors, readOnly, accounts }: KindFieldsProps<PaymentDraft>) {
  const cash = data.processorKind === "cash"
  return (
    <SettingBlock title="Поведение оплаты">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Процессинг">
          {(control) => (
            <Select
              {...control}
              value={data.processorKind}
              // Change is a cash-only feature: switching away from cash drops it.
              onValueChange={(value) => onChange({ processorKind: value as PaymentDraft["processorKind"], ...(value === "cash" ? {} : { allowsChange: false }) })}
              options={PROCESSOR_OPTIONS}
              disabled={readOnly}
            />
          )}
        </Field>
        <AccountField label="Денежный счёт" value={data.account} onChange={(account) => onChange({ account })} accounts={accounts} error={errors.account} disabled={readOnly} />
      </div>
      <FlagGrid error={errors.allowsChange}>
        <Flag label="Фискальная оплата" hint="Пробивается через фискальный регистратор" checked={data.fiscal} onCheckedChange={(fiscal) => onChange({ fiscal })} disabled={readOnly} />
        <Flag label="Учитывать как выручку" checked={data.revenue} onCheckedChange={(revenue) => onChange({ revenue })} disabled={readOnly} />
        <Flag label="Ручной ввод на кассе" hint="Кассир вводит сумму вручную" checked={data.manualEntry} onCheckedChange={(manualEntry) => onChange({ manualEntry })} disabled={readOnly} />
        <Flag label="Внешнее подтверждение" hint="Оплату подтверждает терминал или API" checked={data.externalAcceptance} onCheckedChange={(externalAcceptance) => onChange({ externalAcceptance })} disabled={readOnly} />
        <Flag label="Комбинируется с другими" checked={data.combinable} onCheckedChange={(combinable) => onChange({ combinable })} disabled={readOnly} />
        <Flag label="Со сдачей" hint={cash ? undefined : "Только у наличных"} checked={data.allowsChange} onCheckedChange={(allowsChange) => onChange({ allowsChange })} disabled={readOnly || (!cash && !data.allowsChange)} />
        <Flag label="Открывает денежный ящик" checked={data.opensCashDrawer} onCheckedChange={(opensCashDrawer) => onChange({ opensCashDrawer })} disabled={readOnly} />
      </FlagGrid>
    </SettingBlock>
  )
}
