import { cn } from "@/lib/cn"

/**
 * Ram-horn ornament from public/branding/ornament.svg, inlined so it can take
 * currentColor. Used as the bullet icon in restaurant lists.
 */
export function Ornament({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 40"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("text-rust", className)}
    >
      <path d="M60 6 L66 20 L60 34 L54 20 Z" />
      <path d="M66 20 C76 20 82 12 90 12 C98 12 102 18 100 23 C98 28 91 28 90 23 C89 19 94 18 95 21" />
      <path d="M54 20 C44 20 38 12 30 12 C22 12 18 18 20 23 C22 28 29 28 30 23 C31 19 26 18 25 21" />
      <path d="M66 20 C76 20 82 28 90 28" />
      <path d="M54 20 C44 20 38 28 30 28" />
      <circle cx="60" cy="20" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  )
}
