import type { ReactNode } from "react"

import { cn } from "@/lib/cn"

type SectionTitleProps = {
  children: ReactNode
  id?: string
  /** sans = group page headings, serif = restaurant page headings (see DESIGN.md §2). */
  font?: "sans" | "serif"
  /** Show the 186×4px rust rule after the title (tech block). */
  rule?: boolean
  className?: string
  as?: "h1" | "h2"
}

export function SectionTitle({ children, id, font = "sans", rule = false, className, as: Tag = "h2" }: SectionTitleProps) {
  const heading = (
    <Tag
      id={id}
      className={cn(
        "m-0 text-[1.75rem] leading-tight font-semibold md:text-4xl",
        font === "serif" ? "font-serif font-bold" : "font-sans",
        className,
      )}
    >
      {children}
    </Tag>
  )
  if (!rule) return heading
  return (
    <div className="flex items-center gap-10">
      {heading}
      <span aria-hidden="true" className="hidden h-1 w-[186px] shrink-0 bg-rust wide:block" />
    </div>
  )
}
