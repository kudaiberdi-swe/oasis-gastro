import { useUiLabels } from "@/shared/lib/ui-labels"
import { cn } from "@/shared/lib/utils"

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-control bg-muted", className)} />
}

/** Placeholder rows for a table or list while the first page loads. */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  const labels = useUiLabels()
  return (
    <div role="status" aria-label={labels.loading} className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-[calc(var(--table-row-h)-8px)] w-full" />
      ))}
    </div>
  )
}
