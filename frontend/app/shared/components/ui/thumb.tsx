import type { LucideIcon } from "lucide-react"

import { cn } from "@/shared/lib/utils"

/** The leading cell of a register row: an icon on the soft violet tint, 40px (56 in a card header). */
export function IconThumb({ icon: Icon, size = 40, className }: { icon: LucideIcon; size?: 40 | 56 | 96; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-control bg-linear-to-br from-accent-surface to-muted text-accent",
        size === 96 ? "size-24 rounded-card [&_svg]:size-9" : size === 56 ? "size-14 [&_svg]:size-6" : "size-10 [&_svg]:size-[18px]",
        className,
      )}
    >
      <Icon />
    </span>
  )
}

/** «Айгерим Сапарова» → «АС»; masked or empty names have no initials. */
export function initials(name: string | undefined) {
  if (!name || name.includes("•")) return ""
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toLocaleUpperCase("ru") ?? "")
    .join("")
}

/** Round avatar with the person's initials on the violet tint; a fallback icon when there are none. */
export function Avatar({ name, fallback: Fallback, className }: { name: string | undefined; fallback: LucideIcon; className?: string }) {
  const letters = initials(name)
  return (
    <span aria-hidden className={cn("grid size-10 shrink-0 place-items-center rounded-round bg-accent-surface text-body-sm font-semibold text-accent", className)}>
      {letters || <Fallback className="size-[18px]" />}
    </span>
  )
}
