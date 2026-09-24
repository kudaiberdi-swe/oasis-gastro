import { useAuthActions } from "@convex-dev/auth/react"
import { useConvexAuth } from "convex/react"
import { useNavigate, useParams } from "react-router"

import { isOfficeDestination, OfficeLayout } from "@/office/components/office-layout"
import { CatalogWorkspace } from "@/office/features/catalog/ui/catalog-workspace"
import { useOfficeContext } from "@/office/features/session/data/use-office-context"
import { OfficeSignIn } from "@/office/features/session/ui/office-sign-in"
import { OfficeBootstrap } from "@/office/features/session/ui/office-bootstrap"
import { StockWorkspace } from "@/office/features/stock/ui/stock-workspace"
import { FinanceWorkspace } from "@/office/features/finance/ui/finance-workspace"
import { WorkforceWorkspace } from "@/office/features/workforce/ui/workforce-workspace"
import { LoyaltyWorkspace } from "@/office/features/loyalty/ui/loyalty-workspace"
import { ReportsWorkspace } from "@/office/features/reports/ui/reports-workspace"
import { NotFound } from "@/shared/routing/not-found"

export function OfficeRouter() {
  const auth = useConvexAuth()
  const { signOut } = useAuthActions()
  const { context, bootstrap } = useOfficeContext()
  const { section } = useParams()
  const navigate = useNavigate()

  if (auth.isLoading) return <FullPageLoading />
  if (!auth.isAuthenticated) return <OfficeSignIn />
  if (context === undefined) return <FullPageLoading />

  if (!context.ready) {
    return <OfficeBootstrap email={context.email} onSignOut={() => void signOut()} onBootstrap={bootstrap} />
  }

  // The section lives in the URL (/office/:section), so deep links and F5 keep it.
  if (!isOfficeDestination(section)) return <NotFound />
  const destination = section

  return (
    <OfficeLayout active={destination} onNavigate={(next) => navigate(`/office/${next}`)} userName={context.user?.name} onSignOut={() => void signOut()}>
      {destination === "catalog" ? <CatalogWorkspace /> : null}
      {destination === "stock" ? <StockWorkspace /> : null}
      {destination === "finance" ? <FinanceWorkspace /> : null}
      {destination === "workforce" ? <WorkforceWorkspace /> : null}
      {destination === "loyalty" ? <LoyaltyWorkspace /> : null}
      {destination === "reports" ? <ReportsWorkspace /> : null}
    </OfficeLayout>
  )
}

function FullPageLoading() {
  return <div className="grid h-full place-items-center bg-background text-sm text-muted-foreground">Загрузка…</div>
}
