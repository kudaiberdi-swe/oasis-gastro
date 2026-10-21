import { useState } from "react"
import { UtensilsCrossed } from "lucide-react"

import { cn } from "@/shared/lib/utils"

/**
 * A dish photo, object-cover, decorative (alt=""): the name beside it carries the meaning. Without a photo,
 * or when it fails to load, a soft violet tint with a utensils icon — never the browser's broken-image glyph.
 * Size and rounding come from `className` (menu card, order-line thumbnail, kitchen line).
 */
export function DishPhoto({ src, className, iconClassName }: { src?: string; className?: string; iconClassName?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  const show = Boolean(src) && failed !== src
  return (
    <span data-testid="dish-photo" className={cn("relative block shrink-0 overflow-hidden bg-linear-to-br from-accent-surface to-muted", className)}>
      {show ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailed(src ?? null)} className="size-full object-cover" />
      ) : (
        <span data-testid="dish-placeholder" className="grid size-full place-items-center text-gold">
          <UtensilsCrossed aria-hidden className={cn("size-1/3 max-h-12 max-w-12 min-h-4 min-w-4", iconClassName)} />
        </span>
      )}
    </span>
  )
}
