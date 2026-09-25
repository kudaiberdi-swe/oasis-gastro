import { useAuthActions } from "@convex-dev/auth/react"
import { useConvexAuth } from "convex/react"
import { useMemo, type ComponentType } from "react"
import { Navigate, useParams } from "react-router"

import { CapabilitiesProvider } from "@/office/components/can"
import { AccessControlWorkspace } from "@/office/features/access-control/ui/access-control-workspace"
import { OfficePage, OfficeShell } from "@/office/components/office-shell"
import { OfficeStatePage } from "@/office/components/state-page"
import { CashflowCategoriesWorkspace } from "@/office/features/finance/ui/cashflow-categories-workspace"
import { CounterpartiesWorkspace } from "@/office/features/finance/ui/counterparties-workspace"
import { DepartmentsWorkspace } from "@/office/features/corporation/ui/departments-workspace"
import { IntegrationJobsWorkspace } from "@/office/features/corporation/ui/integration-jobs-workspace"
import { OrganizationsWorkspace } from "@/office/features/corporation/ui/organizations-workspace"
import { RestaurantsWorkspace } from "@/office/features/corporation/ui/restaurants-workspace"
import { DashboardWorkspace } from "@/office/features/dashboard/ui/office-dashboard"
import { DataExchangeWorkspace } from "@/office/features/data-exchange/ui/data-exchange-workspace"
import { TransactionsWorkspace } from "@/office/features/finance/ui/journal-workspace"
import { ShiftAcceptanceWorkspace } from "@/office/features/finance/ui/shift-acceptance-workspace"
import { AccountsPayableWorkspace } from "@/office/features/finance/ui/accounts-payable-workspace"
import { PaymentsWorkspace } from "@/office/features/finance/ui/payments-workspace"
import { ServicesWorkspace } from "@/office/features/finance/ui/services-workspace"
import { GuestCategoriesWorkspace } from "@/office/features/loyalty/ui/categories-workspace"
import { LoyaltyWorkspace } from "@/office/features/loyalty/ui/loyalty-workspace"
import { LoyaltyProgramsWorkspace } from "@/office/features/loyalty/ui/programs-workspace"
import { ModifiersWorkspace } from "@/office/features/modifiers/ui/modifiers-workspace"
import { NomenclatureWorkspace } from "@/office/features/nomenclature/ui/nomenclature-workspace"
import { AuditLogWorkspace } from "@/office/features/platform/ui/audit-log-workspace"
import { PeriodLocksWorkspace } from "@/office/features/platform/ui/period-locks-workspace"
import { PriceOrdersWorkspace } from "@/office/features/price-orders/ui/price-orders-workspace"
import { TerminalsWorkspace } from "@/office/features/platform/ui/terminals-workspace"
import { ProductGroupsWorkspace } from "@/office/features/product-groups/ui/product-groups-workspace"
import { ReportFavoritesWorkspace } from "@/office/features/reports/ui/report-favorites-page"
import { ReportsWorkspace } from "@/office/features/reports/ui/reports-workspace"
import { KitchenBoardWorkspace } from "@/office/features/kitchen/ui/kitchen-board-workspace"
import { CashShiftsWorkspace } from "@/office/features/retail/ui/cash-shifts-workspace"
import { OrdersWorkspace } from "@/office/features/retail/ui/orders-workspace"
import { CashOperationsWorkspace } from "@/office/features/retail-settings/ui/cash-operations-workspace"
import { DeletionReasonsWorkspace, DiscountTypesWorkspace, OrderTypesWorkspace, PaymentTypesWorkspace } from "@/office/features/retail-settings/ui/retail-settings-workspace"
import { useOfficeContext } from "@/office/features/session/data/use-office-context"
import { OfficeBootstrap } from "@/office/features/session/ui/office-bootstrap"
import { OfficeAccessDenied, OfficeSignIn } from "@/office/features/session/ui/office-sign-in"
import { SizeScalesWorkspace } from "@/office/features/size-scales/ui/size-scales-workspace"
import { ReceiptsWorkspace } from "@/office/features/receipts/ui/receipts-workspace"
import { InventoriesWorkspace, OutgoingInvoicesWorkspace, SupplierReturnsWorkspace, TransfersWorkspace, WriteoffsWorkspace } from "@/office/features/stock-documents/ui/documents-workspace"
import { BalancesPage } from "@/office/features/stock/ui/balances-page"
import { SuppliersPage } from "@/office/features/stock/ui/suppliers-page"
import { UnitsPage } from "@/office/features/stock/ui/units-page"
import { WarehousesPage } from "@/office/features/stock/ui/warehouses-page"
import { AttendanceWorkspace } from "@/office/features/workforce/ui/attendance-workspace"
import { PayrollWorkspace } from "@/office/features/workforce/ui/payroll-workspace"
import { PositionsWorkspace } from "@/office/features/workforce/ui/positions-workspace"
import { ScheduleWorkspace } from "@/office/features/workforce/ui/schedule-workspace"
import { ShiftTypesWorkspace } from "@/office/features/workforce/ui/shift-types-workspace"
import { WorkforceWorkspace } from "@/office/features/workforce/ui/workforce-workspace"
import { allowsCapability } from "@/office/model/capabilities"
import { filterNavigationByCapabilities } from "@/office/model/nav-filter"
import { DEFAULT_OFFICE_DESTINATION, findOfficeGroup, findOfficeItem, LEGACY_OFFICE_SECTIONS, OFFICE_LINKS, officeNavigation } from "@/office/model/navigation"
import { EmptyState } from "@/shared/components/ui"
import { NotFound } from "@/shared/routing/not-found"

/** Sections with a working screen today; the rest of the 91 show a "coming" page until their W1+ task. */
const WORKSPACES: Record<string, ComponentType> = {
  dashboard: DashboardWorkspace,
  orders: OrdersWorkspace,
  "cash-shifts": CashShiftsWorkspace,
  "kitchen-board": KitchenBoardWorkspace,
  "payment-types": PaymentTypesWorkspace,
  "order-types": OrderTypesWorkspace,
  "discount-types": DiscountTypesWorkspace,
  "deletion-reasons": DeletionReasonsWorkspace,
  "cash-operations": CashOperationsWorkspace,
  nomenclature: NomenclatureWorkspace,
  "product-groups": ProductGroupsWorkspace,
  modifiers: ModifiersWorkspace,
  "size-scales": SizeScalesWorkspace,
  "price-orders": PriceOrdersWorkspace,
  stock: BalancesPage,
  units: UnitsPage,
  warehouses: WarehousesPage,
  suppliers: SuppliersPage,
  receipts: ReceiptsWorkspace,
  inventories: InventoriesWorkspace,
  transfers: TransfersWorkspace,
  writeoffs: WriteoffsWorkspace,
  "outgoing-invoices": OutgoingInvoicesWorkspace,
  "supplier-returns": SupplierReturnsWorkspace,
  "cashflow-categories": CashflowCategoriesWorkspace,
  counterparties: CounterpartiesWorkspace,
  transactions: TransactionsWorkspace,
  "shift-acceptance": ShiftAcceptanceWorkspace,
  services: ServicesWorkspace,
  "accounts-payable": AccountsPayableWorkspace,
  payments: PaymentsWorkspace,
  employees: WorkforceWorkspace,
  positions: PositionsWorkspace,
  "shift-types": ShiftTypesWorkspace,
  schedule: ScheduleWorkspace,
  attendance: AttendanceWorkspace,
  payroll: PayrollWorkspace,
  guests: LoyaltyWorkspace,
  "loyalty-programs": LoyaltyProgramsWorkspace,
  "guest-categories": GuestCategoriesWorkspace,
  reports: ReportsWorkspace,
  "report-favorites": ReportFavoritesWorkspace,
  roles: AccessControlWorkspace,
  users: AccessControlWorkspace,
  terminals: TerminalsWorkspace,
  "document-locks": PeriodLocksWorkspace,
  "data-exchange": DataExchangeWorkspace,
  "audit-log": AuditLogWorkspace,
  organizations: OrganizationsWorkspace,
  restaurants: RestaurantsWorkspace,
  departments: DepartmentsWorkspace,
  "integration-jobs": IntegrationJobsWorkspace,
}

export function OfficeRouter() {
  const auth = useConvexAuth()
  const { signOut } = useAuthActions()
  const { context, bootstrap } = useOfficeContext()
  const { section } = useParams()
  const capabilities = context?.capabilities
  const groups = useMemo(() => filterNavigationByCapabilities(officeNavigation, capabilities ?? []), [capabilities])

  if (auth.isLoading) return <FullPageLoading />
  if (!auth.isAuthenticated) return <OfficeSignIn />
  if (context === undefined) return <FullPageLoading />

  if (!context.ready) {
    if (!context.canBootstrap) return <OfficeAccessDenied onSignOut={() => void signOut()} />
    return <OfficeBootstrap email={context.email} onSignOut={() => void signOut()} onBootstrap={bootstrap} />
  }

  // The section lives in the URL (/office/:section), so deep links and F5 keep it.
  if (section && LEGACY_OFFICE_SECTIONS[section]) return <Navigate to={`/office/${LEGACY_OFFICE_SECTIONS[section]}`} replace />
  if (section && OFFICE_LINKS[section]) return <Navigate to={OFFICE_LINKS[section]} replace />
  const item = findOfficeItem(section)
  if (!item) return <NotFound />
  const group = findOfficeGroup(item.id)
  const organization = context.organization
  const footerLine = [organization?.name ?? "Sandyq", organization?.timezone ?? "Asia/Almaty", organization?.currency ?? "KZT"].join(" · ")
  const Workspace = WORKSPACES[item.id]
  const allowed = allowsCapability(context.capabilities, item.capability)
  // /office opens the start page; a role without it lands on its first allowed section, not on «Нет доступа».
  const startFallback = !allowed && item.id === DEFAULT_OFFICE_DESTINATION ? groups.flatMap((candidate) => candidate.items).find((candidate) => !OFFICE_LINKS[candidate.id]) : undefined
  if (startFallback) return <Navigate to={`/office/${startFallback.id}`} replace />

  return (
    <CapabilitiesProvider capabilities={context.capabilities}>
      <OfficeShell groups={groups} activeItemId={item.id} userName={context.user?.name} footerLine={footerLine} onSignOut={() => void signOut()}>
        {!allowed ? (
          <OfficePage group={group} title={item.label}>
            <OfficeStatePage state={{ kind: "denied" }} />
          </OfficePage>
        ) : Workspace ? (
          <OfficePage group={group} title={item.label} description={item.description} layout="fill">
            <Workspace />
          </OfficePage>
        ) : (
          <OfficePage group={group} title={item.label} description={item.description}>
            <EmptyState
              size="lg"
              title={item.id === "integration-egais" ? "Недоступно для Казахстана" : "Раздел в разработке"}
              description={item.id === "integration-egais" ? "ЕГАИС — российская система учёта алкоголя; в Казахстане она не применяется." : "Раздел появится в одной из следующих поставок плана."}
            />
          </OfficePage>
        )}
      </OfficeShell>
    </CapabilitiesProvider>
  )
}

function FullPageLoading() {
  return <div className="grid h-full place-items-center bg-background text-body-sm text-muted-foreground">Загрузка…</div>
}
