import { useState } from "react"
import { Star } from "lucide-react"

import { bilingualName, useT } from "@/pos/i18n"
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
  /** Category color strip (POS-DESIGN §2.3). */
  tone?: CategoryTone
  /** Dish photo, 4:3 on --muted with object-fit: cover in both themes (L-3); a broken one falls back to the placeholder. */
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
 * Dish card (W1-POS-11, POS-DESIGN §6.2): the whole card is the add button (no «+»); the ☆ is a
 * separate button over it so the two never nest. Every card has the same 4:3 media area — the photo, or
 * a quiet placeholder with the dish's initial when there is none or it fails to load — so cards in a row
 * line up. The interface language's name leads — Russian in ru, Kazakh in kk — and the other one is the
 * quiet second line (up to two lines, each with its own lang); a dish without a Kazakh name shows only Russian.
 */
export function ProductCard({ name, nameKk, price, onClick, tone, imageUrl, badge, available = true, favorite, onToggleFavorite }: ProductCardProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const showImage = Boolean(imageUrl) && failedUrl !== imageUrl
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
          "relative flex w-full min-w-0 flex-col overflow-hidden rounded-card border border-border bg-card text-left transition-colors duration-150 hover:bg-muted active:bg-muted disabled:cursor-not-allowed disabled:hover:bg-card",
          focusRingClass,
        )}
      >
        <div data-testid="product-media" className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-muted">
          {showImage ? (
            <img src={imageUrl} alt="" loading="lazy" onError={() => setFailedUrl(imageUrl ?? null)} className="h-full w-full object-cover" />
          ) : (
            // The initial is drawn by CSS (attr()), so it never joins the card's text or accessible name.
            <span
              aria-hidden
              data-testid="product-placeholder"
              data-initial={initial(title.primary.text)}
              className="grid h-full w-full place-items-center font-display text-display font-semibold text-muted-foreground select-none before:content-[attr(data-initial)]"
            />
          )}
        </div>
        {tone ? <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", toneStrip[tone])} /> : null}
        {badge ? (
          <TonePill tone="info" className="absolute top-2 left-3 bg-card">
            {badge}
          </TonePill>
        ) : null}
        <div className="flex flex-1 flex-col justify-between gap-2 py-3 pr-3 pl-4">
          <div className="min-w-0">
            <p lang={title.primary.lang} className="line-clamp-2 text-body leading-snug font-semibold text-foreground">
              {title.primary.text}
            </p>
            {title.secondary && (
              <p lang={title.secondary.lang} className="mt-1 line-clamp-2 text-body-sm text-muted-foreground">
                {title.secondary.text}
              </p>
            )}
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <Money value={price} size="md" />
            {!available && <span className="text-body-sm font-semibold text-muted-foreground">{t("product.unavailable")}</span>}
          </div>
        </div>
      </button>
      {onToggleFavorite ? (
        <button
          type="button"
          onClick={onToggleFavorite}
          aria-pressed={Boolean(favorite)}
          aria-label={favorite ? t("product.unfavorite", { name: title.primary.text }) : t("product.favorite", { name: title.primary.text })}
          className={cn("absolute top-0 right-0 grid size-12 place-items-center rounded-control", focusRingClass)}
        >
          <span className={cn("grid size-8 place-items-center rounded-control border border-border bg-card", favorite ? "text-accent" : "text-muted-foreground")}>
            <Star aria-hidden className={cn("size-[18px]", favorite && "fill-current")} />
          </span>
        </button>
      ) : null}
    </div>
  )
}

/** The first letter of the dish name (as shown first), for the photo-less placeholder. */
function initial(name: string) {
  return (name.trim().match(/\p{L}/u)?.[0] ?? "·").toLocaleUpperCase("ru")
}
