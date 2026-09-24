import { Money } from "@/shared/components/ui/money"
import { cn, focusRingClass } from "@/shared/lib/utils"

export function ProductCard({ name, nameKk, price, onClick }: { name: string; nameKk: string; price: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("flex h-32 flex-col justify-between rounded-card border border-border bg-card p-3.5 text-left transition-transform hover:bg-muted active:scale-[0.97]", focusRingClass)}
    >
      <div>
        <p className="font-display line-clamp-2 text-body leading-snug font-semibold text-foreground">{name}</p>
        {nameKk !== name && <p className="mt-0.5 line-clamp-1 text-caption text-muted-foreground">{nameKk}</p>}
      </div>
      <Money value={price} size="md" />
    </button>
  )
}
