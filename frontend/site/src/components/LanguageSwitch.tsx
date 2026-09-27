import { Fragment } from "react"

import { site } from "@/config/site"
import { cn } from "@/lib/cn"

/** RU — KZ — EN. Only Russian exists for now; the others are shown but inert (see NOTES.md). */
export function LanguageSwitch({ tone = "dark", className }: { tone?: "dark" | "light"; className?: string }) {
  return (
    <ul aria-label="Язык сайта" className={cn("m-0 flex list-none items-center gap-1 p-0 text-[13px] font-semibold", className)}>
      {site.languages.map((lang, i) => (
        <Fragment key={lang.code}>
          {i > 0 && (
            <li aria-hidden="true" className={tone === "dark" ? "text-white/70" : "text-ink/60"}>
              —
            </li>
          )}
          <li>
            {lang.active ? (
              <span aria-current="true" className={tone === "dark" ? "text-gold" : "text-clay-strong"}>
                {lang.code}
              </span>
            ) : (
              <span
                aria-disabled="true"
                title="Скоро"
                className={cn("cursor-not-allowed", tone === "dark" ? "text-white" : "text-ink")}
              >
                {lang.code}
              </span>
            )}
          </li>
        </Fragment>
      ))}
    </ul>
  )
}
