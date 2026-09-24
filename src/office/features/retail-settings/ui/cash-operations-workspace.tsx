import { RetailSettingsWorkspace } from "./retail-settings-workspace"

/**
 * «Внесения и изъятия» (/office/cash-operations, W1-RTL-04): for now only the «Типы операций»
 * reference on the same versioned engine; the operations journal comes with its backend query.
 */
export function CashOperationsWorkspace() {
  return <RetailSettingsWorkspace kind="cash-operation-type" />
}
