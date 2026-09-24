import { useAuthActions } from "@convex-dev/auth/react"
import { useConvexAuth } from "convex/react"
import { useMemo, type ComponentType } from "react"
import { Navigate, useParams } from "react-router"

import { OfficePage, OfficeShell } from "@/office/components/office-shell"
import { CatalogWorkspace } from "@/office/features/catalog/ui/catalog-workspace"
import { FinanceWorkspace } from "@/office/features/finance/ui/finance-workspace"
import { LoyaltyWorkspace } from "@/office/features/loyalty/ui/loyalty-workspace"
import { ReportsWorkspace } from "@/office/features/reports/ui/reports-workspace"
import { useOfficeContext } from "@/office/features/session/data/use-office-context"
import { OfficeBootstrap } from "@/office/features/session/ui/office-bootstrap"
import { OfficeAccessDenied, OfficeSignIn } from "@/office/features/session/ui/office-sign-in"
import { StockWorkspace } from "@/office/features/stock/ui/stock-workspace"
import { WorkforceWorkspace } from "@/office/features/workforce/ui/workforce-workspace"
import { allowsCapability } from "@/office/model/capabilities"
import { filterNavigationByCapabilities } from "@/office/model/nav-filter"
import { findOfficeGroup, findOfficeItem, LEGACY_OFFICE_SECTIONS, OFFICE_LINKS, officeNavigation } from "@/office/model/navigation"
import { EmptyState } from "@/shared/components/ui"
import { NotFound } from "@/shared/routing/not-found"

/** Sections with a working screen today; the rest of the 91 show a "coming" page until their W1+ task. */
const WORKSPACES: Record<string, ComponentType> = {
  nomenclature: CatalogWorkspace,
  stock: StockWorkspace,
  transactions: FinanceWorkspace,
  employees: WorkforceWorkspace,
  guests: LoyaltyWorkspace,
  reports: ReportsWorkspace,
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

  return (
    <OfficeShell groups={groups} activeItemId={item.id} userName={context.user?.name} footerLine={footerLine} onSignOut={() => void signOut()}>
      {!allowed ? (
        <OfficePage group={group} title={item.label}>
          <EmptyState size="lg" title="Нет доступа" description="У вашей роли нет права на этот раздел. Обратитесь к администратору." />
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
  )
}

function FullPageLoading() {
  return <div className="grid h-full place-items-center bg-background text-body-sm text-muted-foreground">Загрузка…</div>
}
