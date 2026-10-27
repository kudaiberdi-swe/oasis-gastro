import { lazy, Suspense, useEffect, type ReactNode } from "react"
import { Navigate, useLocation, type RouteObject } from "react-router"

import { DEFAULT_OFFICE_DESTINATION } from "@/office/model/navigation"
import { DemoFrame } from "@/shared/demo/demo-mode"
import { NotFound } from "@/shared/routing/not-found"

// Each surface is its own chunk: a cash register never downloads the office or the kitchen screen.
const PosRouter = lazy(() => import("@/pos/router").then((module) => ({ default: module.PosRouter })))
const KitchenRouter = lazy(() => import("@/kitchen/router").then((module) => ({ default: module.KitchenRouter })))
const OfficeRouter = lazy(() => import("@/office/router").then((module) => ({ default: module.OfficeRouter })))

/**
 * The browser tab names the product and the surface: «OASIS Gastro · Касса», «… · Кухня», «… · Офис» — three open tabs stay apart.
 * Every surface passes through here, so a demo build puts its «Демо-версия» line on top of all three.
 */
function SurfaceTitle({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    document.title = title
  }, [title])
  return <DemoFrame>{children}</DemoFrame>
}

/** While a surface's chunk loads: the same quiet line the office shows while its session loads. */
function SurfaceLoading() {
  return (
    <div role="status" className="grid h-full place-items-center bg-background text-body-sm text-muted-foreground">
      Загрузка…
    </div>
  )
}

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
  { path: "/pos", element: <SurfaceTitle title="OASIS Gastro · Касса"><div className="pos-surface h-full w-full"><Suspense fallback={<SurfaceLoading />}><PosRouter /></Suspense></div></SurfaceTitle> },
  { path: "/kitchen", element: <SurfaceTitle title="OASIS Gastro · Кухня"><div className="pos-surface h-full w-full"><Suspense fallback={<SurfaceLoading />}><KitchenRouter /></Suspense></div></SurfaceTitle> },
  { path: "/pos/kitchen", element: <KitchenRedirect /> },
  { path: "/office", element: <Navigate to={`/office/${DEFAULT_OFFICE_DESTINATION}`} replace /> },
  { path: "/office/:section/:id?", element: <SurfaceTitle title="OASIS Gastro · Офис"><div className="h-full w-full"><Suspense fallback={<SurfaceLoading />}><OfficeRouter /></Suspense></div></SurfaceTitle> },
  // A card nested in a section: /office/production/preparations/:productId (W2-PRD-01).
  { path: "/office/:section/:id/:subId", element: <SurfaceTitle title="OASIS Gastro · Офис"><div className="h-full w-full"><Suspense fallback={<SurfaceLoading />}><OfficeRouter /></Suspense></div></SurfaceTitle> },
  ...devRoutes,
  { path: "*", element: <NotFound /> },
]
