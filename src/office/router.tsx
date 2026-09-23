import { useAuthActions } from "@convex-dev/auth/react"
import { useConvexAuth } from "convex/react"
import { useState } from "react"

import { OfficeLayout, type OfficeDestination } from "@/office/components/office-layout"
import { CatalogWorkspace } from "@/office/features/catalog/ui/catalog-workspace"
import { useOfficeContext } from "@/office/features/session/data/use-office-context"
import { OfficeSignIn } from "@/office/features/session/ui/office-sign-in"
import { OfficeBootstrap } from "@/office/features/session/ui/office-bootstrap"
import { StockWorkspace } from "@/office/features/stock/ui/stock-workspace"
import { FinanceWorkspace } from "@/office/features/finance/ui/finance-workspace"
import { WorkforceWorkspace } from "@/office/features/workforce/ui/workforce-workspace"
import { LoyaltyWorkspace } from "@/office/features/loyalty/ui/loyalty-workspace"

export function OfficeRouter() {
  const auth = useConvexAuth()
  const { signOut } = useAuthActions()
  const { context, bootstrap } = useOfficeContext()
  const [destination, setDestination] = useState<OfficeDestination>("catalog")

  if (auth.isLoading) return <FullPageLoading />
  if (!auth.isAuthenticated) return <OfficeSignIn />
  if (context === undefined) return <FullPageLoading />

  if (!context.ready) {
    return <OfficeBootstrap email={context.email} onSignOut={() => void signOut()} onBootstrap={bootstrap} />
  }

  return (
    <OfficeLayout active={destination} onNavigate={setDestination} userName={context.user?.name} onSignOut={() => void signOut()}>
      {destination === "catalog" ? <CatalogWorkspace /> : null}
      {destination === "stock" ? <StockWorkspace /> : null}
      {destination === "finance" ? <FinanceWorkspace /> : null}
      {destination === "workforce" ? <WorkforceWorkspace /> : null}
      {destination === "loyalty" ? <LoyaltyWorkspace /> : null}
    </OfficeLayout>
  )
}

function FullPageLoading() {
  return <div className="grid h-full place-items-center bg-background text-sm text-muted-foreground">Загрузка…</div>
}
