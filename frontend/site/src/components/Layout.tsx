import { Outlet } from "react-router"

import { Footer } from "@/components/Footer"
import { Header } from "@/components/Header"
import { ScrollManager } from "@/components/ScrollManager"

export function Layout() {
  return (
    <>
      <a
        href="#main"
        className="fixed top-2 left-2 z-[70] -translate-y-24 rounded-btn bg-white px-4 py-2 text-ink focus:translate-y-0"
      >
        Перейти к содержимому
      </a>
      <ScrollManager />
      <Header />
      <main id="main" tabIndex={-1} className="outline-none">
        <Outlet />
      </main>
      <Footer />
    </>
  )
}
