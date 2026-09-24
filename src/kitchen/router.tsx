import { Link } from "react-router"

// Full-screen kitchen display lands in W1-KDS-02; until then the board lives inside the POS.
export function KitchenRouter() {
  return (
    <div className="grid h-full place-items-center bg-nav px-6 text-center text-nav-foreground">
      <div className="flex max-w-sm flex-col items-center gap-3">
        <p className="font-display text-2xl font-semibold">Экран кухни</p>
        <p className="text-sm text-nav-foreground/70">Отдельный экран кухни появится в ближайшем обновлении. Пока доска кухни открывается из кассы.</p>
        <Link className="text-sm font-semibold text-nav-foreground underline-offset-4 hover:underline" to="/pos">Открыть кассу</Link>
      </div>
    </div>
  )
}
