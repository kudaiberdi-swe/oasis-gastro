import { SmartLink } from "@/components/Button"
import { Picture } from "@/components/Picture"
import { site } from "@/config/site"

/**
 * Cream footer: stacked group logo + one column per brand, then a legal bar.
 * The reference uses fixed 310px columns that overflow the 1200px container
 * (a source of its horizontal scroll); here the columns share the space.
 */
export function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer className="bg-cream pt-16 pb-8 font-serif text-brown">
      <div className="mx-auto flex w-full max-w-content flex-col gap-10 px-5 xl:flex-row xl:items-start">
        <SmartLink href="/" className="block w-[140px] shrink-0" aria-label={`${site.brand.group} — на главную`}>
          <Picture image={{ ...site.brand.footerLogo, alt: "" }} sizes="140px" className="block h-auto w-full" />
        </SmartLink>
        <div className="grid flex-1 grid-cols-1 gap-8 sm:grid-cols-3 sm:gap-10 xl:ml-[100px] xl:gap-20">
          {site.footer.columns.map((column) => (
            <nav key={column.title} aria-label={column.title} className="flex min-w-0 flex-col gap-4">
              <SmartLink href={column.href} className="flex h-[70px] items-center gap-4 text-xl font-medium whitespace-nowrap text-brown no-underline">
                <Picture image={column.icon} sizes="32px" className="h-9 w-auto" />
                {column.title}
              </SmartLink>
              <ul className="m-0 flex list-none flex-col gap-4 p-0">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <SmartLink href={link.href} className="text-base leading-[1.4] font-medium text-brown no-underline hover:opacity-70">
                      {link.label}
                    </SmartLink>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>
      <div className="mt-12 border-t border-[var(--brown-line)] pt-6">
        <div className="mx-auto flex w-full max-w-content flex-col items-center gap-3 px-5 text-center text-sm text-[var(--brown-muted)] xl:flex-row xl:justify-between xl:text-left">
          <p className="m-0">
            © {site.brand.since} – {year} {site.footer.copyright}
          </p>
          <p className="m-0">
            <a href={`mailto:${site.contacts.email}`} className="font-medium text-brown no-underline hover:opacity-70">
              {site.contacts.email}
            </a>
          </p>
        </div>
      </div>
    </footer>
  )
}
