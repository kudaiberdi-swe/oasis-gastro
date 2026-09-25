import { useState } from "react"
import { Star } from "lucide-react"

import type { CategoryTone } from "@/shared/components/ui/chip"
import { Money } from "@/shared/components/ui/money"
import { TonePill } from "@/shared/components/ui/status-pill"
import { cn, focusRingClass } from "@/shared/lib/utils"

const toneStrip: Record<CategoryTone, string> = {
  meat: "bg-cat-meat",
  dairy: "bg-cat-dairy",
  bread: "bg-cat-bread",
  green: "bg-cat-green",
  tea: "bg-cat-tea",
  turkistan: "bg-cat-turkistan",
}

export interface ProductCardProps {
  name: string
  nameKk: string
  price: number
  onClick: () => void
  /** Category color strip (POS-DESIGN §2.3) — also the fallback when there is no photo. */
  tone?: CategoryTone
  /** Dish photo, 4:3 on --muted with object-fit: cover in both themes (L-3). */
  imageUrl?: string
  /** «Комбо», «Хит» — an info pill over the photo, sentence case. */
  badge?: string
  /** false: stop list — 50 % and «нет в наличии», the card does not add. */
  available?: boolean
  /** ☆ in a 44px zone; omitted — no star. */
  favorite?: boolean
  onToggleFavorite?: () => void
}

/**
 * Dish card (W1-POS-11, POS-DESIGN §6.2): the whole card is the add button (no «+»); the ☆ is a
 * separate button over it so the two never nest.
 */
export function ProductCard({ name, nameKk, price, onClick, tone, imageUrl, badge, available = true, favorite, onToggleFavorite }: ProductCardProps) {
  const [imageFailed, setImageFailed] = useState(false)
  const showImage = Boolean(imageUrl) && !imageFailed
  const showKk = Boolean(nameKk) && nameKk !== name

  return (
    <div className={cn("relative flex min-w-0", !available && "opacity-50")}>
      <button
        type="button"
        onClick={onClick}
        disabled={!available}
        aria-label={available ? undefined : `${name} — нет в наличии`}
        className={cn(
          "relative flex w-full min-w-0 flex-col overflow-hidden rounded-card border border-border bg-card text-left transition-colors hover:bg-muted active:bg-muted disabled:cursor-not-allowed disabled:hover:bg-card",
          focusRingClass,
        )}
      >
        {showImage ? (
          <div className="aspect-[4/3] w-full shrink-0 bg-muted">
            <img src={imageUrl} alt="" loading="lazy" onError={() => setImageFailed(true)} className="h-full w-full object-cover" />
          </div>
        ) : null}
        {tone ? <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", toneStrip[tone])} /> : null}
        {badge ? (
          <TonePill tone="info" className={cn("absolute left-2 bg-card", showImage ? "top-2" : "top-2.5 left-3")}>
            {badge}
          </TonePill>
        ) : null}
        <div className={cn("flex flex-1 flex-col justify-between gap-2 p-3", !showImage && "min-h-32 pl-4", !showImage && badge && "pt-10", onToggleFavorite && !showImage && "pr-12")}>
          <div className="min-w-0">
            <p className="line-clamp-2 text-body leading-snug font-semibold text-foreground">{name}</p>
            {showKk && <p className="mt-0.5 line-clamp-1 text-body-sm text-muted-foreground">{nameKk}</p>}
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <Money value={price} size="md" />
            {!available && <span className="text-body-sm font-semibold text-muted-foreground">нет в наличии</span>}
          </div>
        </div>
      </button>
      {onToggleFavorite ? (
        <button
          type="button"
          onClick={onToggleFavorite}
          aria-pressed={Boolean(favorite)}
          aria-label={favorite ? `Убрать из избранного: ${name}` : `В избранное: ${name}`}
          className={cn("absolute top-1 right-1 grid size-11 place-items-center rounded-control", focusRingClass)}
        >
          <span className={cn("grid size-8 place-items-center rounded-control border border-border bg-card", favorite ? "text-accent" : "text-muted-foreground")}>
            <Star aria-hidden className={cn("size-[18px]", favorite && "fill-current")} />
          </span>
        </button>
      ) : null}
    </div>
  )
}
