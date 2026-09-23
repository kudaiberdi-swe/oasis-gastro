import { OfficeRouter } from "@/office/router"
import { PosRouter } from "@/pos/router"

export default function App() {
  const isOffice = window.location.pathname.startsWith("/office")
  return <div className="pos-canvas h-full w-full">{isOffice ? <OfficeRouter /> : <PosRouter />}</div>
}
