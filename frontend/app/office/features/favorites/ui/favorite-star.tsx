import { Star } from "lucide-react"

import { Button, useToast } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { cn } from "@/shared/lib/utils"

import { useFavoriteActions, useOfficeFavorites } from "../data/use-office-favorites"

/** «В избранное» next to the page title (W3-ADM-13): pins or unpins the current section for this user. */
export function FavoriteStar({ sectionId, label }: { sectionId: string; label: string }) {
  const items = useOfficeFavorites()
  const { toggle } = useFavoriteActions()
  const toast = useToast()
  const pinned = items?.some((item) => item.kind === "section" && item.targetId === sectionId) ?? false

  async function onClick() {
    try {
      const result = await toggle({ kind: "section", targetId: sectionId, label })
      toast(result.favorite ? `«${label}» в избранном` : `«${label}» убрано из избранного`, "success")
    } catch (caught) {
      toast(errorMessage(caught, "Не удалось изменить избранное"), "error")
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-pressed={pinned}
      aria-label={pinned ? "Убрать из избранного" : "В избранное"}
      title={pinned ? "Убрать из избранного" : "В избранное"}
      disabled={items === undefined}
      onClick={() => void onClick()}
      className={cn("self-center", pinned ? "text-gold" : "text-muted-foreground hover:text-foreground")}
    >
      <Star aria-hidden className={cn(pinned && "fill-current")} />
    </Button>
  )
}
