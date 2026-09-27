import { createBrowserRouter } from "react-router"

import { Layout } from "@/components/Layout"
import { HomePage } from "@/pages/HomePage"
import { NotFoundPage } from "@/pages/NotFoundPage"
import { RestaurantPage } from "@/pages/RestaurantPage"

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/restaurant", element: <RestaurantPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
])
