import { UtensilsCrossed } from "lucide-react"
import { useState } from "react"

import { IconThumb } from "@/shared/components/ui"
import { cn } from "@/shared/lib/utils"

/** The dish photo; without one (or when it fails to load) a violet-tinted tile with a utensils icon, never a broken image. */
export function ProductThumb({ imageUrl, size = 40 }: { imageUrl: string | null; size?: 40 | 56 | 96 }) {
  const [failed, setFailed] = useState(false)
  if (imageUrl && !failed) {
    const box = size === 96 ? "size-24 rounded-card" : size === 56 ? "size-14 rounded-control" : "size-10 rounded-control"
    return <img src={imageUrl} alt="" loading="lazy" onError={() => setFailed(true)} className={cn(box, "shrink-0 bg-muted object-cover")} />
  }
  return (
    <span data-testid="thumb-placeholder" className="contents">
      <IconThumb icon={UtensilsCrossed} size={size} />
    </span>
  )
}
