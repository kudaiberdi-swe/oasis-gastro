import { Combobox, Field, Input, MoneyInput, Select, type ComboboxOption } from "@/shared/components/ui"

import { DIRECTION_LABELS } from "../../data/use-retail-settings"
import type { CashOperationDraft } from "../../model/setting-draft"
import { AccountField, Flag, FlagGrid, SettingBlock, type KindFieldsProps } from "./field-kit"

const DIRECTION_OPTIONS = Object.entries(DIRECTION_LABELS).map(([value, label]) => ({ value, label }))
const NONE = "__none__"

/** «Кассовая операция»: direction, the two accounts, cashflow category, limit and manager PIN. */
export function CashOperationFields({ data, onChange, errors, readOnly, accounts, cashflowCategories }: KindFieldsProps<CashOperationDraft> & { cashflowCategories: ComboboxOption[] | null }) {
  const categoryOptions = cashflowCategories ? [{ value: NONE, label: "Не указана" }, ...cashflowCategories] : []
  if (cashflowCategories && data.cashflowCategory && !categoryOptions.some((option) => option.value === data.cashflowCategory)) categoryOptions.push({ value: data.cashflowCategory, label: data.cashflowCategory })
  return (
    <SettingBlock title="Кассовая операция">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Направление">
          {(control) => <Select {...control} value={data.direction} onValueChange={(value) => onChange({ direction: value as CashOperationDraft["direction"] })} options={DIRECTION_OPTIONS} disabled={readOnly} />}
        </Field>
        <Field label="Максимальная сумма" error={errors.maximumAmount}>
          {(control) => <MoneyInput {...control} value={data.maximumAmount} onValueChange={(maximumAmount) => onChange({ maximumAmount })} disabled={readOnly} />}
        </Field>
        <AccountField label="Денежный счёт" value={data.cashAccount} onChange={(cashAccount) => onChange({ cashAccount })} accounts={accounts} error={errors.cashAccount} disabled={readOnly} />
        <AccountField
          label="Корреспондирующий счёт"
          value={data.correspondingAccount}
          onChange={(correspondingAccount) => onChange({ correspondingAccount })}
          accounts={accounts}
          error={errors.correspondingAccount}
          disabled={readOnly}
        />
        <Field label="Статья ДДС" className="sm:col-span-2">
          {(control) =>
            cashflowCategories ? (
              <Combobox
                {...control}
                value={data.cashflowCategory || NONE}
                onValueChange={(value) => onChange({ cashflowCategory: value === NONE ? "" : value })}
                options={categoryOptions}
                placeholder="Выберите статью"
                searchPlaceholder="Название статьи"
                disabled={readOnly}
              />
            ) : (
              <Input {...control} value={data.cashflowCategory} onChange={(event) => onChange({ cashflowCategory: event.target.value })} disabled={readOnly} autoComplete="off" />
            )
          }
        </Field>
      </div>
      <FlagGrid>
        <Flag label="Требовать PIN менеджера" checked={data.requireManager} onCheckedChange={(requireManager) => onChange({ requireManager })} disabled={readOnly} />
      </FlagGrid>
    </SettingBlock>
  )
}
