import type { DeletionDraft } from "../../model/setting-draft"
import { AccountField, Flag, FlagGrid, SettingBlock, type KindFieldsProps } from "./field-kit"

/** «Удаление и склад»: expense account, stock write-off and what the cashier must provide. */
export function DeletionFields({ data, onChange, errors, readOnly, accounts }: KindFieldsProps<DeletionDraft>) {
  return (
    <SettingBlock title="Удаление и склад">
      <AccountField
        label="Счёт расходов"
        value={data.expenseAccount}
        onChange={(expenseAccount) => onChange({ expenseAccount })}
        accounts={accounts}
        error={errors.expenseAccount}
        hint={data.writeOff ? "Обязателен при списании со склада" : undefined}
        optional
        disabled={readOnly}
      />
      <FlagGrid>
        <Flag label="Списывать со склада" hint="Удалённая позиция списывается по техкарте" checked={data.writeOff} onCheckedChange={(writeOff) => onChange({ writeOff })} disabled={readOnly} />
        <Flag label="Требовать комментарий" checked={data.requireComment} onCheckedChange={(requireComment) => onChange({ requireComment })} disabled={readOnly} />
        <Flag label="Требовать PIN менеджера" checked={data.requireManager} onCheckedChange={(requireManager) => onChange({ requireManager })} disabled={readOnly} />
      </FlagGrid>
    </SettingBlock>
  )
}
