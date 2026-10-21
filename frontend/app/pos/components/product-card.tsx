import { Plus, Star } from "lucide-react"

import { bilingualName, useT } from "@/pos/i18n"
import type { CategoryTone } from "@/shared/components/ui/chip"
import { DishPhoto } from "@/shared/components/ui/dish-photo"
import { Money } from "@/shared/components/ui/money"
import { TonePill } from "@/shared/components/ui/status-pill"
import { cn, focusRingClass } from "@/shared/lib/utils"

const toneDot: Record<CategoryTone, string> = {
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
  /** Category color dot before the name (POS-DESIGN §2.3). */
  tone?: CategoryTone
  /** Dish photo, 4:3, object-fit: cover (L-3); missing or broken — the DishPhoto placeholder. */
  imageUrl?: string
  /** «Комбо», «Хит» — an info pill over the photo, sentence case. */
  badge?: string
  /** false: stop list — 50 % and «нет в наличии» / «қолда жоқ», the card does not add. */
  available?: boolean
  /** ☆ in a 48px zone; omitted — no star. */
  favorite?: boolean
  onToggleFavorite?: () => void
}

/**
 * Dish card (W1-POS-11, redesign 2026-10): a large 4:3 photo on top (DishPhoto: the product's image, else a
 * violet placeholder with a utensils icon), the name, the price in bold and a round violet «+» bottom-right.
 * The whole card is the add button — the «+» is its visual cue, not a second control; the ☆ is a separate
 * button over the photo so the two never nest. The interface language's name leads — Russian in ru, Kazakh
 * in kk — and the other one is the quiet second line; a dish without a Kazakh name shows only Russian.
 */
export function ProductCard({ name, nameKk, price, onClick, tone, imageUrl, badge, available = true, favorite, onToggleFavorite }: ProductCardProps) {
  const t = useT()
  const title = bilingualName(t.locale, { name, nameKk })

  return (
    <div className={cn("relative flex min-w-0", !available && "opacity-50")}>
      <button
        type="button"
        onClick={onClick}
        disabled={!available}
        aria-label={available ? undefined : t("product.unavailableAria", { name: title.primary.text })}
        className={cn(
          "group relative flex w-full min-w-0 flex-col gap-3 rounded-panel bg-card p-2 text-left shadow-panel transition-[box-shadow,translate] duration-150 hover:shadow-float active:translate-y-px disabled:cursor-not-allowed disabled:hover:shadow-panel motion-reduce:active:translate-y-0",
          focusRingClass,
        )}
      >
        <DishPhoto src={imageUrl} className="aspect-[4/3] w-full rounded-card" />
        {badge ? (
          <TonePill tone="info" className="absolute top-4 left-4">
            {badge}
          </TonePill>
        ) : null}
        <div className="flex flex-1 flex-col justify-between gap-2 px-1.5 pb-1">
          <div className="flex min-w-0 items-start gap-2">
            {tone ? <span aria-hidden className={cn("mt-2 size-2 shrink-0 rounded-round", toneDot[tone])} /> : null}
            <div className="min-w-0">
              <p lang={title.primary.lang} className="line-clamp-2 text-body leading-snug font-semibold text-foreground">
                {title.primary.text}
              </p>
              {title.secondary && (
                <p lang={title.secondary.lang} className="mt-0.5 line-clamp-2 text-body-sm text-muted-foreground">
                  {title.secondary.text}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 flex-col">
              <Money value={price} size="md" className="font-bold text-foreground" />
              {!available && <span className="text-body-sm font-semibold text-muted-foreground">{t("product.unavailable")}</span>}
            </span>
            {available ? (
              <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-round bg-primary text-primary-foreground transition-colors group-hover:bg-primary-hover">
                <Plus className="size-5" />
              </span>
            ) : null}
          </div>
        </div>
      </button>
      {onToggleFavorite ? (
        <button
          type="button"
          onClick={onToggleFavorite}
          aria-pressed={Boolean(favorite)}
          aria-label={favorite ? t("product.unfavorite", { name: title.primary.text }) : t("product.favorite", { name: title.primary.text })}
          className={cn("absolute top-2 right-2 grid size-12 place-items-center rounded-round", focusRingClass)}
        >
          <span className={cn("grid size-8 place-items-center rounded-round bg-card shadow-panel", favorite ? "text-accent" : "text-muted-foreground")}>
            <Star aria-hidden className={cn("size-[18px]", favorite && "fill-current")} />
          </span>
        </button>
      ) : null}
    </div>
  )
}
