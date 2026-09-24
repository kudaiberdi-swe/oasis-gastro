import { Link } from "react-router"

export function NotFound() {
  return (
    <div className="grid h-full place-items-center bg-background px-6 text-center">
      <div className="flex max-w-sm flex-col items-center gap-3">
        <img src="/branding/ornament.svg" alt="" aria-hidden className="h-10 opacity-60" />
        <p className="font-display text-2xl font-semibold text-foreground">Страница не найдена</p>
        <p className="text-sm text-muted-foreground">Такого раздела нет. Проверьте адрес или вернитесь на главную.</p>
        <div className="flex gap-4 text-sm font-semibold">
          <Link className="text-accent underline-offset-4 hover:underline" to="/pos">Касса</Link>
          <Link className="text-accent underline-offset-4 hover:underline" to="/office">Офис</Link>
        </div>
      </div>
    </div>
  )
}
