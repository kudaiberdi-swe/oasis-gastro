import { useCallback, useId, useRef, useState } from "react"
import { Link } from "react-router"

import { SmartLink } from "@/components/Button"
import { LanguageSwitch } from "@/components/LanguageSwitch"
import { MobileMenu } from "@/components/MobileMenu"
import { Picture } from "@/components/Picture"
import { site, type NavItem } from "@/config/site"

const linkClass =
  "text-[13px] font-medium uppercase text-white no-underline transition-colors duration-200 hover:text-gold focus-visible:text-gold"

/** Fixed dark translucent header (75px), desktop nav ≥1024px, burger below. */
export function Header() {
  const [menuOpen, setMenuOpen] = useState(false)
  const burgerRef = useRef<HTMLButtonElement>(null)
  const closeMenu = useCallback(() => setMenuOpen(false), [])

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex h-header items-center border-b border-[var(--header-border)] bg-[var(--header-bg)] backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-header items-center justify-between px-[30px] max-xs:px-5">
        <div className="flex flex-1">
          <Link to="/" className="flex items-center gap-3 no-underline" aria-label={`${site.brand.group} — на главную`}>
            <Picture image={{ ...site.brand.logo, alt: "" }} className="h-auto w-7" priority />
            <span className="text-[19px] font-medium tracking-[-0.04em] text-white">{site.brand.group}</span>
          </Link>
        </div>

        <nav aria-label="Основное меню" className="hidden flex-[2] justify-center xl:flex">
          <ul className="m-0 flex list-none gap-[30px] p-0">
            {site.nav.map((item) => (
              <li key={item.label} className="relative">
                {"children" in item ? <Dropdown item={item} /> : <SmartLink href={item.href} className={linkClass}>{item.label}</SmartLink>}
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex flex-1 items-center justify-end">
          <LanguageSwitch className="max-xl:hidden" />
          <button
            ref={burgerRef}
            type="button"
            aria-label="Открыть меню"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen(true)}
            className="flex h-10 w-10 cursor-pointer flex-col items-center justify-center gap-[5px] border-0 bg-transparent p-0 xl:hidden"
          >
            <span className="h-0.5 w-[25px] bg-white" />
            <span className="h-0.5 w-[25px] bg-white" />
            <span className="h-0.5 w-[25px] bg-white" />
          </button>
        </div>
      </div>
      <MobileMenu open={menuOpen} onClose={closeMenu} returnFocusRef={burgerRef} />
    </header>
  )
}

/** "Бренды": not a link on the reference; here a disclosure button that also opens on hover. */
function Dropdown({ item }: { item: Extract<NavItem, { children: readonly unknown[] }> }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className={`${linkClass} cursor-pointer border-0 bg-transparent p-0 hover:text-white`}
      >
        {item.label}
      </button>
      <ul
        id={id}
        hidden={!open}
        className="absolute top-full left-0 m-0 flex min-w-[220px] list-none flex-col border border-[var(--dropdown-border)] bg-ink py-2.5 pt-2.5"
      >
        {item.children.map((child) => (
          <li key={child.href}>
            <SmartLink
              href={child.href}
              className="block px-5 py-3 text-sm font-medium text-white no-underline transition-colors duration-200 hover:text-gold"
            >
              {child.label}
            </SmartLink>
          </li>
        ))}
      </ul>
    </div>
  )
}
