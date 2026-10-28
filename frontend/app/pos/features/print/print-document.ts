import { formatTenge } from "@/shared/lib/format"

// Browser printing of 80 mm documents (POS-DESIGN §6.6, О-8): check, pre-check, X- and Z-reports.
// A print form is plain HTML with its own black-and-white styles (raw colors are allowed only here);
// it is printed from a hidden iframe, so no popup window is opened and nothing is blocked.

export function escapeHtml(value: string | number | undefined | null) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

/** Money on paper: the same «7 990 ₸» as on screen. */
export const printMoney = (value: number) => escapeHtml(formatTenge(value))

export function printDateTime(value: number) {
  return new Date(value).toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

/** Shared 80 mm styles: monospace body, dashed dividers, bold totals. */
export const PRINT_STYLES = `
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { font-family: "Courier New", ui-monospace, monospace; font-size: 12px; line-height: 1.35; }
  .paper { width: 72mm; margin: 0 auto; padding: 4mm 2mm 6mm; }
  .brand { margin: 0; text-align: center; font-family: Georgia, "PT Serif", serif; font-size: 22px; font-weight: 700; letter-spacing: .04em; }
  .kind { margin: 2px 0 0; text-align: center; font-weight: 700; letter-spacing: .12em; }
  .center { text-align: center; }
  .muted { color: #333; font-size: 11px; }
  .number { margin: 8px 0 2px; text-align: center; font-family: Arial, sans-serif; font-size: 18px; font-weight: 700; }
  .divider { margin: 8px 0; border: 0; border-top: 1px dashed #000; }
  .row, .sub { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; padding: 1px 0; }
  .row span:last-child, .sub span:last-child { text-align: right; white-space: nowrap; }
  .sub { padding-left: 10px; color: #333; font-size: 11px; }
  .item { padding: 4px 0; border-bottom: 1px dotted #777; break-inside: avoid; }
  .item:last-child { border-bottom: 0; }
  .section { margin: 0 0 4px; font-weight: 700; }
  .strong { font-weight: 700; }
  .total { margin-top: 4px; padding-top: 5px; border-top: 2px solid #000; font-family: Arial, sans-serif; font-size: 15px; font-weight: 700; }
  .box { margin: 7px 0; border: 2px solid #000; padding: 4px; text-align: center; font-weight: 700; }
  .note { margin-top: 6px; padding: 5px; border: 1px solid #000; overflow-wrap: anywhere; }
  .footer { margin-top: 12px; text-align: center; }
  .line { margin: 0; padding: 1px 0; overflow-wrap: anywhere; }
  .align-right { text-align: right; }
  .large { font-family: Arial, sans-serif; font-size: 16px; }
  .divider.solid { border-top: 2px solid #000; }
  .copy { break-after: page; }
  @media screen { body { padding: 16px 0; background: #eee; } .paper { background: #fff; } }
  @media print { body { width: 80mm; } .paper { margin: 0; } }
`

export function printPage(title: string, body: string, options: { widthMm?: 58 | 80; copies?: number } = {}) {
  // 58 mm tape: 50 mm printable; copies are separate pages of the same form.
  const narrow = options.widthMm === 58 ? "@page { size: 58mm auto; margin: 0; } .paper { width: 50mm; } @media print { body { width: 58mm; } }" : ""
  const copies = Math.min(Math.max(1, Math.round(options.copies ?? 1)), 5)
  const papers = Array.from({ length: copies }, (_, index) => `<main class="paper${index < copies - 1 ? " copy" : ""}">${body}</main>`).join("")
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${PRINT_STYLES}${narrow}</style>
</head>
<body>${papers}</body>
</html>`
}

/**
 * Prints an HTML document through a hidden iframe (window.print of that frame). Returns false when
 * the browser cannot print (no document body, e.g. during tests).
 */
export function printHtml(html: string): boolean {
  if (typeof document === "undefined" || !document.body) return false
  const frame = document.createElement("iframe")
  frame.setAttribute("aria-hidden", "true")
  frame.title = "Печать"
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0", visibility: "hidden" })
  document.body.appendChild(frame)
  const target = frame.contentWindow
  const doc = target?.document
  if (!target || !doc) {
    frame.remove()
    return false
  }
  doc.open()
  doc.write(html)
  doc.close()
  const cleanup = () => window.setTimeout(() => frame.remove(), 1000)
  target.addEventListener("afterprint", cleanup, { once: true })
  const print = () => {
    try {
      target.focus()
      target.print()
    } finally {
      // Browsers without afterprint on frames still get the frame removed.
      window.setTimeout(() => frame.remove(), 60_000)
    }
  }
  // A template's logo is an image: print once it has loaded (at most 1.5 s), so the paper never misses it.
  const pending = Array.from(doc.images ?? []).filter((image) => !image.complete)
  if (!pending.length) window.setTimeout(print, 50)
  else {
    let printed = false
    const once = () => {
      if (printed) return
      printed = true
      print()
    }
    let left = pending.length
    for (const image of pending) {
      const done = () => {
        left -= 1
        if (left <= 0) once()
      }
      image.addEventListener("load", done, { once: true })
      image.addEventListener("error", done, { once: true })
    }
    window.setTimeout(once, 1500)
  }
  return true
}
