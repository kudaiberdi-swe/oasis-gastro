import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react"
import { Link } from "react-router"

import { cn } from "@/lib/cn"

/**
 * Button variants found on the reference:
 * - amber:   supplier CTA (13px/600, 10×20 padding, 6px radius)
 * - wine:    banquet card CTA (full width, 14px/600)
 * - outline: serif pill with a clay border ("Все новости →")
 * - dark:    restaurant SEO "Читать далее"
 * - link:    gold text link with arrow (group SEO)
 */
export type ButtonVariant = "amber" | "wine" | "outline" | "dark" | "link"

const variants: Record<ButtonVariant, string> = {
  amber:
    "inline-flex items-center justify-center rounded-btn bg-amber px-5 py-2.5 text-[13px] font-semibold text-white transition-colors duration-200 hover:bg-amber-dark",
  wine: "flex w-full items-center justify-center rounded-btn bg-wine px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-200 ease-out hover:bg-wine-dark",
  outline:
    "inline-flex min-w-[260px] items-center justify-center gap-1.5 rounded-pill border border-clay bg-cream px-2.5 py-2.5 font-serif text-base font-bold text-clay-strong transition-colors duration-200 hover:bg-clay hover:text-white",
  dark: "inline-flex items-center justify-center rounded-[4px] bg-charcoal px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-charcoal-hover",
  link: "inline-flex items-center gap-1.5 p-0 text-base font-bold text-gold-link underline-offset-4 hover:underline",
}

type Common = { variant?: ButtonVariant; className?: string; children: ReactNode }

export function buttonClass(variant: ButtonVariant = "amber", className?: string) {
  return cn(variants[variant], "cursor-pointer", className)
}

export function Button({ variant, className, ...rest }: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={buttonClass(variant, className)} {...rest} />
}

/** Internal routes go through React Router; hashes, mailto/tel, files and external URLs are plain anchors. */
export function ButtonLink({ variant, className, href, ...rest }: Common & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <SmartLink href={href} className={buttonClass(variant, className)} {...rest} />
}

export function SmartLink({ href, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const isRoute = href.startsWith("/") && !href.startsWith("/menu/")
  if (isRoute) return <Link to={href} {...rest} />
  const external = /^https?:/.test(href)
  return <a href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} {...rest} />
}
