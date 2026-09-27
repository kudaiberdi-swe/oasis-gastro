import { cn } from "@/shared/lib/utils"

/** The qoshqar-muiz (ram horn) motif of frontend/public/branding/ornament.svg, colored by currentColor. */
export function Ornament({ className, width = 72 }: { className?: string; width?: number }) {
  return (
    <svg
      viewBox="0 0 120 40"
      width={width}
      height={(width / 120) * 40}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M60 6 L66 20 L60 34 L54 20 Z" />
      <path d="M66 20 C76 20 82 12 90 12 C98 12 102 18 100 23 C98 28 91 28 90 23 C89 19 94 18 95 21" />
      <path d="M54 20 C44 20 38 12 30 12 C22 12 18 18 20 23 C22 28 29 28 30 23 C31 19 26 18 25 21" />
      <path d="M66 20 C76 20 82 28 90 28" />
      <path d="M54 20 C44 20 38 28 30 28" />
      <path d="M104 20 H118" />
      <path d="M16 20 H2" />
      <circle cx="60" cy="20" r="2" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Two mirrored ornaments — the sign-in and empty-state flourish. */
export function OrnamentPair({ className, width = 72 }: { className?: string; width?: number }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Ornament width={width} />
      <Ornament width={width} className="-scale-x-100" />
    </div>
  )
}
