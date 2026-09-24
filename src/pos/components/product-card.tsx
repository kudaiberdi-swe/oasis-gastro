import { useState } from "react"

import type { CategoryTone } from "@/shared/components/ui/chip"
import { Money } from "@/shared/components/ui/money"
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
  /** Dish photo; shown on --muted with object-fit: cover in both themes (L-3). */
  imageUrl?: string
}

export function ProductCard({ name, nameKk, price, onClick, tone, imageUrl }: ProductCardProps) {
  const [imageFailed, setImageFailed] = useState(false)
  const showImage = Boolean(imageUrl) && !imageFailed

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex flex-col overflow-hidden rounded-card border border-border bg-card text-left transition-transform hover:bg-muted active:scale-[0.97]",
        showImage ? "h-52" : "h-32",
        focusRingClass,
      )}
    >
      {showImage ? (
        <div className="h-20 w-full shrink-0 bg-muted">
          <img src={imageUrl} alt="" loading="lazy" onError={() => setImageFailed(true)} className="h-full w-full object-cover" />
        </div>
      ) : null}
      {tone ? <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", toneStrip[tone])} /> : null}
      <div className="flex flex-1 flex-col justify-between p-3.5">
        <div>
          <p className="font-display line-clamp-2 text-body leading-snug font-semibold text-foreground">{name}</p>
          {nameKk !== name && <p className="mt-0.5 line-clamp-1 text-caption text-muted-foreground">{nameKk}</p>}
        </div>
        <Money value={price} size="md" />
      </div>
    </button>
  )
}
