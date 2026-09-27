import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { useEffect, useRef, type RefObject } from "react"
import { createPortal } from "react-dom"

import { SmartLink } from "@/components/Button"
import { LanguageSwitch } from "@/components/LanguageSwitch"
import { site } from "@/config/site"

type MobileMenuProps = { open: boolean; onClose: () => void; returnFocusRef: RefObject<HTMLButtonElement | null> }

/**
 * Full-screen stone overlay with the flattened nav (brand children listed directly).
 * Portaled to <body>: the header's backdrop-filter would otherwise become the
 * containing block for this fixed element.
 */
export function MobileMenu({ open, onClose, returnFocusRef }: MobileMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()

  useEffect(() => {
    if (!open) return
    document.body.classList.add("menu-open")
    const panel = panelRef.current
    panel?.querySelector<HTMLElement>("button, a")?.focus()
    const returnTo = returnFocusRef.current

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      if (e.key !== "Tab" || !panel) return
      // Keep focus inside the dialog.
      const focusable = [...panel.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")]
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.body.classList.remove("menu-open")
      document.removeEventListener("keydown", onKey)
      returnTo?.focus()
    }
  }, [open, onClose, returnFocusRef])

  const links = site.nav.flatMap((item) => ("children" in item ? item.children : [item]))

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          id="mobile-menu"
          role="dialog"
          aria-modal="true"
          aria-label="Меню"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[60] flex h-dvh flex-col items-center justify-center bg-stone"
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть меню"
            className="absolute top-[18px] right-[18px] flex h-12 w-12 cursor-pointer items-center justify-center border-0 bg-transparent text-[35px] leading-none text-ink"
          >
            <span aria-hidden="true">×</span>
          </button>
          <nav aria-label="Мобильное меню">
            <ul className="m-0 list-none p-0 text-center">
              {links.map((link) => (
                <li key={link.href + link.label}>
                  <SmartLink href={link.href} onClick={onClose} className="block p-[15px] text-[28px] text-ink no-underline hover:text-clay-strong">
                    {link.label}
                  </SmartLink>
                </li>
              ))}
            </ul>
          </nav>
          <LanguageSwitch tone="light" className="mt-6 text-base" />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
