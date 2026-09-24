import { lazy, Suspense } from "react"
import { Navigate, useLocation, type RouteObject } from "react-router"

import { KitchenRouter } from "@/kitchen/router"
import { OfficeRouter } from "@/office/router"
import { DEFAULT_OFFICE_DESTINATION } from "@/office/model/navigation"
import { PosRouter } from "@/pos/router"
import { NotFound } from "@/shared/routing/not-found"

/** `/` is the cashier: keep `?terminal=` (branch selection) when redirecting. */
function RootRedirect() {
  const location = useLocation()
  return <Navigate to={{ pathname: "/pos", search: location.search }} replace />
}

/** The old `/pos/kitchen` address opens the kitchen screen (W1-KDS-02), keeping `?terminal=`. */
function KitchenRedirect() {
  const location = useLocation()
  return <Navigate to={{ pathname: "/kitchen", search: location.search }} replace />
}

// Primitive showcase for screenshot checks; the dynamic import is dropped from production builds.
const UiShowcase = import.meta.env.DEV ? lazy(() => import("@/dev/ui-showcase").then((module) => ({ default: module.UiShowcase }))) : null
const OfficeShowcase = import.meta.env.DEV ? lazy(() => import("@/dev/office-showcase").then((module) => ({ default: module.OfficeShowcase }))) : null
const EngineShowcase = import.meta.env.DEV ? lazy(() => import("@/dev/engine-showcase").then((module) => ({ default: module.EngineShowcase }))) : null
const devRoutes: RouteObject[] =
  UiShowcase && OfficeShowcase && EngineShowcase
    ? [
        { path: "/dev/ui", element: <Suspense><UiShowcase /></Suspense> },
        { path: "/dev/office/:section?", element: <Suspense><OfficeShowcase /></Suspense> },
        { path: "/dev/engine/:module?/:id?", element: <Suspense><EngineShowcase /></Suspense> },
      ]
    : []

// The POS is a fixed-size touch surface; the office scrolls its own content (no page-level scroll).
export const appRoutes: RouteObject[] = [
  { path: "/", element: <RootRedirect /> },
  { path: "/pos", element: <div className="pos-surface h-full w-full"><PosRouter /></div> },
  { path: "/kitchen", element: <div className="pos-surface h-full w-full"><KitchenRouter /></div> },
  { path: "/pos/kitchen", element: <KitchenRedirect /> },
  { path: "/office", element: <Navigate to={`/office/${DEFAULT_OFFICE_DESTINATION}`} replace /> },
  { path: "/office/:section/:id?", element: <div className="h-full w-full"><OfficeRouter /></div> },
  ...devRoutes,
  { path: "*", element: <NotFound /> },
]
