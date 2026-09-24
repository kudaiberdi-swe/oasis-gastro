import { createBrowserRouter, RouterProvider } from "react-router"

import { appRoutes } from "@/shared/routing/routes"

const router = createBrowserRouter(appRoutes)

export default function App() {
  return <RouterProvider router={router} />
}
