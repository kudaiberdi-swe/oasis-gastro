import { formatTenge } from "@/shared/lib/utils"

export function ProductCard({ name, nameKk, price, onClick }: { name: string; nameKk: string; price: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-32 flex-col justify-between rounded-[var(--radius-card)] border border-border bg-card p-3.5 text-left transition-transform active:scale-[0.97]"
    >
      <div>
        <p className="font-display line-clamp-2 text-[15px] font-semibold leading-snug text-foreground">{name}</p>
        {nameKk !== name && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{nameKk}</p>}
      </div>
      <p className="font-display text-lg font-semibold tabular-nums text-accent">{formatTenge(price)}</p>
    </button>
  )
}
