import { useAuthActions } from "@convex-dev/auth/react"
import { useConvexAuth } from "convex/react"
import { lazy, Suspense, useMemo, type ComponentType } from "react"
import { Navigate, useParams } from "react-router"

import { CapabilitiesProvider } from "@/office/components/can"
import { OfficePage, OfficeShell } from "@/office/components/office-shell"
import { OfficeStatePage } from "@/office/components/state-page"
import { FavoriteStar } from "@/office/features/favorites/ui/favorite-star"
import type { CardModuleId } from "@/office/features/integrations/model/cards"
import { useOfficeContext } from "@/office/features/session/data/use-office-context"
import { OfficeBootstrap } from "@/office/features/session/ui/office-bootstrap"
import { OfficeAccessDenied, OfficeSignIn } from "@/office/features/session/ui/office-sign-in"
import { allowsCapability, PERSONAL_SECTIONS } from "@/office/model/capabilities"
import { filterNavigationByCapabilities } from "@/office/model/nav-filter"
import { registerSectionPreload } from "@/office/model/section-preload"
import { DEFAULT_OFFICE_DESTINATION, findOfficeGroup, findOfficeItem, LEGACY_OFFICE_SECTIONS, OFFICE_LINKS, officeNavigation } from "@/office/model/navigation"
import { EmptyState } from "@/shared/components/ui"
import { NotFound } from "@/shared/routing/not-found"

// Every section is its own chunk (the POS and the kitchen never download the office, and the office
// downloads a section when it is opened); the shell and the navigation render at once.
function lazySection<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M & string) {
  return Object.assign(lazy(() => load().then((module) => ({ default: module[name] as ComponentType }))), { preload: load })
}

const AccessControlWorkspace = lazySection(() => import("@/office/features/access-control/ui/access-control-workspace"), "AccessControlWorkspace")
const CashflowCategoriesWorkspace = lazySection(() => import("@/office/features/finance/ui/cashflow-categories-workspace"), "CashflowCategoriesWorkspace")
const CounterpartiesWorkspace = lazySection(() => import("@/office/features/finance/ui/counterparties-workspace"), "CounterpartiesWorkspace")
const DepartmentsWorkspace = lazySection(() => import("@/office/features/corporation/ui/departments-workspace"), "DepartmentsWorkspace")
const IntegrationJobsWorkspace = lazySection(() => import("@/office/features/corporation/ui/integration-jobs-workspace"), "IntegrationJobsWorkspace")
const OrganizationsWorkspace = lazySection(() => import("@/office/features/corporation/ui/organizations-workspace"), "OrganizationsWorkspace")
const RestaurantsWorkspace = lazySection(() => import("@/office/features/corporation/ui/restaurants-workspace"), "RestaurantsWorkspace")
const DashboardWorkspace = lazySection(() => import("@/office/features/dashboard/ui/office-dashboard"), "DashboardWorkspace")
const FavoritesWorkspace = lazySection(() => import("@/office/features/favorites/ui/favorites-workspace"), "FavoritesWorkspace")
const DataExchangeWorkspace = lazySection(() => import("@/office/features/data-exchange/ui/data-exchange-workspace"), "DataExchangeWorkspace")
const CouriersWorkspace = lazySection(() => import("@/office/features/delivery/ui/couriers-workspace"), "CouriersWorkspace")
const CallCenterWorkspace = lazySection(() => import("@/office/features/delivery/ui/delivery-orders-workspace"), "CallCenterWorkspace")
const DeliveryOrdersWorkspace = lazySection(() => import("@/office/features/delivery/ui/delivery-orders-workspace"), "DeliveryOrdersWorkspace")
const TelephonyWorkspace = lazySection(() => import("@/office/features/delivery/ui/telephony-workspace"), "TelephonyWorkspace")
const SourcesWorkspace = lazySection(() => import("@/office/features/delivery/ui/sources-workspace"), "SourcesWorkspace")
const ZonesWorkspace = lazySection(() => import("@/office/features/delivery/ui/zones-workspace"), "ZonesWorkspace")
const TransactionsWorkspace = lazySection(() => import("@/office/features/finance/ui/journal-workspace"), "TransactionsWorkspace")
const ShiftAcceptanceWorkspace = lazySection(() => import("@/office/features/finance/ui/shift-acceptance-workspace"), "ShiftAcceptanceWorkspace")
const AccountsPayableWorkspace = lazySection(() => import("@/office/features/finance/ui/accounts-payable-workspace"), "AccountsPayableWorkspace")
const BankStatementsWorkspace = lazySection(() => import("@/office/features/finance/ui/bank-statements-workspace"), "BankStatementsWorkspace")
const BudgetsWorkspace = lazySection(() => import("@/office/features/finance/ui/budgets-workspace"), "BudgetsWorkspace")
const PaymentCalendarWorkspace = lazySection(() => import("@/office/features/finance/ui/payment-calendar-workspace"), "PaymentCalendarWorkspace")
const PaymentsWorkspace = lazySection(() => import("@/office/features/finance/ui/payments-workspace"), "PaymentsWorkspace")
const ServicesWorkspace = lazySection(() => import("@/office/features/finance/ui/services-workspace"), "ServicesWorkspace")
const GuestCategoriesWorkspace = lazySection(() => import("@/office/features/loyalty/ui/categories-workspace"), "GuestCategoriesWorkspace")
const LoyaltyWorkspace = lazySection(() => import("@/office/features/loyalty/ui/loyalty-workspace"), "LoyaltyWorkspace")
const LoyaltyProgramsWorkspace = lazySection(() => import("@/office/features/loyalty/ui/programs-workspace"), "LoyaltyProgramsWorkspace")
const ReservationsWorkspace = lazySection(() => import("@/office/features/loyalty/ui/reservations-workspace"), "ReservationsWorkspace")
const CloudApiWorkspace = lazySection(() => import("@/office/features/integrations/ui/cloud-api-workspace"), "CloudApiWorkspace")
const EgaisUnavailable = lazySection(() => import("@/office/features/integrations/ui/egais-unavailable"), "EgaisUnavailable")
const loadIntegrationCards = () => import("@/office/features/integrations/ui/integration-register")
const IntegrationCardsWorkspace = lazy(() => loadIntegrationCards().then((module) => ({ default: module.IntegrationCardsWorkspace })))
const ExternalMenuWorkspace = lazySection(() => import("@/office/features/integrations/ui/external-menu-workspace"), "ExternalMenuWorkspace")
const CampaignsWorkspace = lazySection(() => import("@/office/features/loyalty/ui/campaigns-register"), "CampaignsWorkspace")
const ModifiersWorkspace = lazySection(() => import("@/office/features/modifiers/ui/modifiers-workspace"), "ModifiersWorkspace")
const NomenclatureWorkspace = lazySection(() => import("@/office/features/nomenclature/ui/nomenclature-workspace"), "NomenclatureWorkspace")
const AuditLogWorkspace = lazySection(() => import("@/office/features/platform/ui/audit-log-workspace"), "AuditLogWorkspace")
const PeriodLocksWorkspace = lazySection(() => import("@/office/features/platform/ui/period-locks-workspace"), "PeriodLocksWorkspace")
const PriceListsWorkspace = lazySection(() => import("@/office/features/price-lists/ui/price-lists-workspace"), "PriceListsWorkspace")
const PriceOrdersWorkspace = lazySection(() => import("@/office/features/price-orders/ui/price-orders-workspace"), "PriceOrdersWorkspace")
const KitchenPlanWorkspace = lazySection(() => import("@/office/features/production-logistics/ui/logistics-page"), "KitchenPlanWorkspace")
const SemiFinishedSheetWorkspace = lazySection(() => import("@/office/features/production-logistics/ui/logistics-page"), "SemiFinishedSheetWorkspace")
const AssemblyActsWorkspace = lazySection(() => import("@/office/features/production/ui/production-workspace"), "AssemblyActsWorkspace")
const InternalOrdersWorkspace = lazySection(() => import("@/office/features/production/ui/production-workspace"), "InternalOrdersWorkspace")
const ProcessingActsWorkspace = lazySection(() => import("@/office/features/production/ui/production-workspace"), "ProcessingActsWorkspace")
const ProductionWorkspace = lazySection(() => import("@/office/features/production/ui/production-workspace"), "ProductionWorkspace")
const PurchaseOrdersWorkspace = lazySection(() => import("@/office/features/production/ui/production-workspace"), "PurchaseOrdersWorkspace")
const SalesActsWorkspace = lazySection(() => import("@/office/features/production/ui/production-workspace"), "SalesActsWorkspace")
const TerminalsWorkspace = lazySection(() => import("@/office/features/platform/ui/terminals-workspace"), "TerminalsWorkspace")
const EquipmentWorkspace = lazySection(() => import("@/office/features/platform/ui/equipment-workspace"), "EquipmentWorkspace")
const PrintTemplatesWorkspace = lazySection(() => import("@/office/features/platform/ui/print-templates-workspace"), "PrintTemplatesWorkspace")
const SystemSettingsWorkspace = lazySection(() => import("@/office/features/platform/ui/system-settings-workspace"), "SystemSettingsWorkspace")
const ProductGroupsWorkspace = lazySection(() => import("@/office/features/product-groups/ui/product-groups-workspace"), "ProductGroupsWorkspace")
const ReportFavoritesWorkspace = lazySection(() => import("@/office/features/reports/ui/report-favorites-page"), "ReportFavoritesWorkspace")
const ReportSchedulesWorkspace = lazySection(() => import("@/office/features/reports/ui/report-schedules-page"), "ReportSchedulesWorkspace")
const ReportsWorkspace = lazySection(() => import("@/office/features/reports/ui/reports-workspace"), "ReportsWorkspace")
const KitchenBoardWorkspace = lazySection(() => import("@/office/features/kitchen/ui/kitchen-board-workspace"), "KitchenBoardWorkspace")
const CashShiftsWorkspace = lazySection(() => import("@/office/features/retail/ui/cash-shifts-workspace"), "CashShiftsWorkspace")
const OrdersWorkspace = lazySection(() => import("@/office/features/retail/ui/orders-workspace"), "OrdersWorkspace")
const CashOperationsWorkspace = lazySection(() => import("@/office/features/retail-settings/ui/cash-operations-workspace"), "CashOperationsWorkspace")
const DeletionReasonsWorkspace = lazySection(() => import("@/office/features/retail-settings/ui/retail-settings-workspace"), "DeletionReasonsWorkspace")
const DiscountTypesWorkspace = lazySection(() => import("@/office/features/retail-settings/ui/retail-settings-workspace"), "DiscountTypesWorkspace")
const OrderTypesWorkspace = lazySection(() => import("@/office/features/retail-settings/ui/retail-settings-workspace"), "OrderTypesWorkspace")
const PaymentTypesWorkspace = lazySection(() => import("@/office/features/retail-settings/ui/retail-settings-workspace"), "PaymentTypesWorkspace")
const SizeScalesWorkspace = lazySection(() => import("@/office/features/size-scales/ui/size-scales-workspace"), "SizeScalesWorkspace")
const ReceiptsWorkspace = lazySection(() => import("@/office/features/receipts/ui/receipts-workspace"), "ReceiptsWorkspace")
const InventoriesWorkspace = lazySection(() => import("@/office/features/stock-documents/ui/documents-workspace"), "InventoriesWorkspace")
const OutgoingInvoicesWorkspace = lazySection(() => import("@/office/features/stock-documents/ui/documents-workspace"), "OutgoingInvoicesWorkspace")
const SupplierReturnsWorkspace = lazySection(() => import("@/office/features/stock-documents/ui/documents-workspace"), "SupplierReturnsWorkspace")
const TransfersWorkspace = lazySection(() => import("@/office/features/stock-documents/ui/documents-workspace"), "TransfersWorkspace")
const WriteoffsWorkspace = lazySection(() => import("@/office/features/stock-documents/ui/documents-workspace"), "WriteoffsWorkspace")
const BalancesPage = lazySection(() => import("@/office/features/stock/ui/balances-page"), "BalancesPage")
const SuppliersPage = lazySection(() => import("@/office/features/stock/ui/suppliers-page"), "SuppliersPage")
const UnitsPage = lazySection(() => import("@/office/features/stock/ui/units-page"), "UnitsPage")
const WarehousesPage = lazySection(() => import("@/office/features/stock/ui/warehouses-page"), "WarehousesPage")
const AttendanceWorkspace = lazySection(() => import("@/office/features/workforce/ui/attendance-workspace"), "AttendanceWorkspace")
const MedicalRecordsWorkspace = lazySection(() => import("@/office/features/workforce/ui/medical-records-workspace"), "MedicalRecordsWorkspace")
const MotivationWorkspace = lazySection(() => import("@/office/features/workforce/ui/motivation-workspace"), "MotivationWorkspace")
const PayrollWorkspace = lazySection(() => import("@/office/features/workforce/ui/payroll-workspace"), "PayrollWorkspace")
const PositionsWorkspace = lazySection(() => import("@/office/features/workforce/ui/positions-workspace"), "PositionsWorkspace")
const ScheduleWorkspace = lazySection(() => import("@/office/features/workforce/ui/schedule-workspace"), "ScheduleWorkspace")
const ShiftTypesWorkspace = lazySection(() => import("@/office/features/workforce/ui/shift-types-workspace"), "ShiftTypesWorkspace")
const WorkforceWorkspace = lazySection(() => import("@/office/features/workforce/ui/workforce-workspace"), "WorkforceWorkspace")

/** Sections with a working screen today; the rest of the 91 show a "coming" page until their W1+ task. */
/** One Register per «Обмен и интеграции» section with a provider card (W3-INT-01). */
const cardsWorkspace = (moduleId: CardModuleId): ComponentType & { preload: () => Promise<unknown> } => Object.assign(() => <IntegrationCardsWorkspace moduleId={moduleId} />, { preload: loadIntegrationCards })
const CARD_WORKSPACES: Record<CardModuleId, ComponentType> = {
  "integration-1c": cardsWorkspace("integration-1c"),
  "integration-edi": cardsWorkspace("integration-edi"),
  "integration-bank": cardsWorkspace("integration-bank"),
  "integration-fiscal": cardsWorkspace("integration-fiscal"),
  "integration-loyalty": cardsWorkspace("integration-loyalty"),
  "integration-messaging": cardsWorkspace("integration-messaging"),
  "integration-maps": cardsWorkspace("integration-maps"),
}

// Workspaces made of their own cards (KPI, chart, tables) sit on the lavender background, not in one white card.
const BARE_SECTIONS = ["dashboard"]

const WORKSPACES: Record<string, ComponentType & { preload?: () => Promise<unknown> }> = {
  ...CARD_WORKSPACES,
  "integration-egais": EgaisUnavailable,
  dashboard: DashboardWorkspace,
  favorites: FavoritesWorkspace,
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
  "price-lists": PriceListsWorkspace,
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
  production: ProductionWorkspace,
  "processing-acts": ProcessingActsWorkspace,
  "assembly-acts": AssemblyActsWorkspace,
  "sales-acts": SalesActsWorkspace,
  "purchase-orders": PurchaseOrdersWorkspace,
  "internal-orders": InternalOrdersWorkspace,
  "kitchen-plan": KitchenPlanWorkspace,
  "semi-finished-sheet": SemiFinishedSheetWorkspace,
  "cashflow-categories": CashflowCategoriesWorkspace,
  counterparties: CounterpartiesWorkspace,
  transactions: TransactionsWorkspace,
  "shift-acceptance": ShiftAcceptanceWorkspace,
  services: ServicesWorkspace,
  "accounts-payable": AccountsPayableWorkspace,
  payments: PaymentsWorkspace,
  "bank-statements": BankStatementsWorkspace,
  "payment-calendar": PaymentCalendarWorkspace,
  budgets: BudgetsWorkspace,
  employees: WorkforceWorkspace,
  positions: PositionsWorkspace,
  "shift-types": ShiftTypesWorkspace,
  schedule: ScheduleWorkspace,
  attendance: AttendanceWorkspace,
  payroll: PayrollWorkspace,
  motivation: MotivationWorkspace,
  "medical-records": MedicalRecordsWorkspace,
  guests: LoyaltyWorkspace,
  "loyalty-programs": LoyaltyProgramsWorkspace,
  "guest-categories": GuestCategoriesWorkspace,
  campaigns: CampaignsWorkspace,
  reservations: ReservationsWorkspace,
  "delivery-orders": DeliveryOrdersWorkspace,
  "delivery-zones": ZonesWorkspace,
  couriers: CouriersWorkspace,
  "call-center": CallCenterWorkspace,
  telephony: TelephonyWorkspace,
  "delivery-sources": SourcesWorkspace,
  reports: ReportsWorkspace,
  "report-favorites": ReportFavoritesWorkspace,
  "report-schedules": ReportSchedulesWorkspace,
  roles: AccessControlWorkspace,
  users: AccessControlWorkspace,
  terminals: TerminalsWorkspace,
  equipment: EquipmentWorkspace,
  "print-templates": PrintTemplatesWorkspace,
  "system-settings": SystemSettingsWorkspace,
  "document-locks": PeriodLocksWorkspace,
  "data-exchange": DataExchangeWorkspace,
  "audit-log": AuditLogWorkspace,
  organizations: OrganizationsWorkspace,
  restaurants: RestaurantsWorkspace,
  departments: DepartmentsWorkspace,
  "integration-jobs": IntegrationJobsWorkspace,
  "integration-cloud-api": CloudApiWorkspace,
  "external-menu": ExternalMenuWorkspace,
}

for (const [sectionId, workspace] of Object.entries(WORKSPACES)) if (workspace.preload) registerSectionPreload(sectionId, workspace.preload)

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
  const footerLine = [organization?.name, organization?.timezone ?? "Asia/Almaty", organization?.currency ?? "KZT"].filter(Boolean).join(" · ")
  const Workspace = WORKSPACES[item.id]
  const allowed = allowsCapability(context.capabilities, item.capability)
  // /office opens the start page; a role without it lands on its first allowed section, not on «Нет доступа».
  const startFallback = !allowed && item.id === DEFAULT_OFFICE_DESTINATION ? groups.flatMap((candidate) => candidate.items).find((candidate) => !OFFICE_LINKS[candidate.id] && !PERSONAL_SECTIONS.includes(candidate.id)) : undefined
  if (startFallback) return <Navigate to={`/office/${startFallback.id}`} replace />
  // W3-ADM-13: every section the user opens can be pinned from its header (not «Избранное» itself).
  const favorite = allowed && !PERSONAL_SECTIONS.includes(item.id) ? <FavoriteStar sectionId={item.id} label={item.label} /> : undefined

  return (
    <CapabilitiesProvider capabilities={context.capabilities}>
      <OfficeShell groups={groups} activeItemId={item.id} userName={context.user?.name} footerLine={footerLine} onSignOut={() => void signOut()}>
        {!allowed ? (
          <OfficePage group={group} title={item.label}>
            <OfficeStatePage state={{ kind: "denied" }} />
          </OfficePage>
        ) : Workspace ? (
          <OfficePage group={group} title={item.label} description={item.description} layout={BARE_SECTIONS.includes(item.id) ? "bare" : "fill"} favorite={favorite}>
            <Suspense fallback={<OfficeStatePage state={{ kind: "loading" }} />}>
              <Workspace />
            </Suspense>
          </OfficePage>
        ) : (
          <OfficePage group={group} title={item.label} description={item.description} favorite={favorite}>
            <EmptyState
              size="lg"
              title="Раздел в разработке"
              description="Раздел появится в одной из следующих поставок плана."
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
