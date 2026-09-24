import { useState } from "react"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { OfficeStatePage } from "@/office/components/state-page"
import { PlatformErrorBoundary, usePlatformScope } from "@/office/features/platform/data/use-platform"
import { useMasterSelection } from "@/office/features/stock/ui/master-panel"
import { EmptyState } from "@/shared/components/ui"

import { KIND_META, useAccountOptions, useCashflowCategories, useRetailRights, useRetailSetting, type RetailSettingKind } from "../data/use-retail-settings"
import { SettingForm } from "./setting-form"
import { SettingsRegister } from "./settings-register"

/**
 * One engine for the versioned retail references (W1-RTL-03/04): /office/<section> is the register,
 * /office/<section>/:externalId opens a version in the right panel, /office/<section>/new a new one.
 */
export function RetailSettingsWorkspace({ kind }: { kind: RetailSettingKind }) {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={`${kind}-${attempt}`} onRetry={() => setAttempt((value) => value + 1)}>
      <RetailSettingsMaster kind={kind} />
    </PlatformErrorBoundary>
  )
}

function RetailSettingsMaster({ kind }: { kind: RetailSettingKind }) {
  const { section } = KIND_META[kind]
  const { canEdit, canApprove } = useRetailRights(kind)
  const scope = usePlatformScope()
  const accounts = useAccountOptions(kind)
  const canReadCategories = useCan("office.cashflow-categories.view")
  const categories = useCashflowCategories(kind === "cash-operation-type" && canReadCategories)
  const selection = useMasterSelection(section)
  const setting = useRetailSetting(kind, selection.selectedId)
  const restaurantName = (externalId: string) => scope.restaurantName(externalId) ?? externalId
  const restaurants = scope.restaurants.map((restaurant) => ({ value: restaurant.externalId, label: restaurant.name }))
  const formOpen = (selection.isNew && canEdit) || selection.selectedId !== null

  return (
    <div className="flex min-h-0 flex-1">
      <SettingsRegister
        kind={kind}
        selectedId={selection.selectedId}
        onSelect={selection.select}
        onCreate={canEdit ? selection.openNew : undefined}
        formOpen={formOpen}
        accountLabel={accounts.labelOf}
        restaurantName={restaurantName}
      />
      {selection.isNew && canEdit ? (
        <SettingForm
          key="new"
          kind={kind}
          setting={null}
          canEdit={canEdit}
          canApprove={canApprove}
          network={scope.network}
          restaurants={restaurants}
          accounts={accounts}
          cashflowCategories={canReadCategories ? categories : null}
          onClose={selection.close}
          onOpen={selection.select}
        />
      ) : null}
      {selection.selectedId !== null && setting ? (
        // A status change (publish, the expiry cron) re-reads the version into a fresh draft.
        <SettingForm
          key={`${setting.externalId}:${setting.status}`}
          kind={kind}
          setting={setting}
          canEdit={canEdit}
          canApprove={canApprove}
          network={scope.network}
          restaurants={restaurants}
          accounts={accounts}
          cashflowCategories={canReadCategories ? categories : null}
          onClose={selection.close}
          onOpen={selection.select}
        />
      ) : null}
      {selection.selectedId !== null && !setting ? (
        <RightPanel
          open
          onOpenChange={(next) => {
            if (!next) selection.close()
          }}
          title={KIND_META[kind].title}
        >
          {setting === undefined ? (
            <OfficeStatePage state={{ kind: "loading" }} />
          ) : (
            <EmptyState title="Настройка не найдена" description="Возможно, она относится к ресторану вне вашего доступа или ссылка устарела." />
          )}
        </RightPanel>
      ) : null}
    </div>
  )
}

export const PaymentTypesWorkspace = () => <RetailSettingsWorkspace kind="payment-type" />
export const OrderTypesWorkspace = () => <RetailSettingsWorkspace kind="order-type" />
export const DiscountTypesWorkspace = () => <RetailSettingsWorkspace kind="discount-type" />
export const DeletionReasonsWorkspace = () => <RetailSettingsWorkspace kind="deletion-reason" />
