import { useId, useState } from "react"

import { Button } from "@/components/Button"
import { cn } from "@/lib/cn"

type ExpandableTextProps = {
  title: string
  intro: string
  sections: readonly { heading: string; body: string }[]
  more: string
  less: string
  /** group page: sans + gold text trigger; restaurant page: serif + dark button. */
  tone?: "group" | "restaurant"
}

/** SEO text block: intro visible, the rest expands with a height + opacity transition (0.5s). */
export function ExpandableText({ title, intro, sections, more, less, tone = "group" }: ExpandableTextProps) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <section aria-labelledby={`${id}-title`} className={cn("mx-auto my-5 max-w-boxed px-5 leading-[1.6] text-body", tone === "restaurant" && "font-serif")}>
      <h2 id={`${id}-title`} className="m-0 mb-[15px] text-[28px] leading-tight font-bold text-ink">
        {title}
      </h2>
      <p className="m-0 mb-[15px] text-base">{intro}</p>
      <div
        id={`${id}-more`}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-500",
          open ? "grid-rows-[1fr] opacity-100 ease-in" : "grid-rows-[0fr] opacity-0 ease-out",
        )}
      >
        <div className="overflow-hidden">
          {sections.map((s) => (
            <div key={s.heading}>
              <h3 className="mt-[25px] mb-3 text-[22px] font-semibold text-ink">{s.heading}</h3>
              <p className="m-0 mb-3 text-[15px] md:text-base">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-[15px]">
        <Button variant={tone === "group" ? "link" : "dark"} aria-expanded={open} aria-controls={`${id}-more`} onClick={() => setOpen((v) => !v)}>
          {open ? less : more}
          {tone === "group" && <span aria-hidden="true">{open ? "↑" : "↓"}</span>}
        </Button>
      </div>
    </section>
  )
}
