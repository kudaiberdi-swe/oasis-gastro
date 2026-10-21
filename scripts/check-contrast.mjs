#!/usr/bin/env node
// WCAG 2.1 contrast check for the theme tokens (docs/04-POS-DESIGN.md §2): every text pair ≥ 4.5:1,
// focus ring and input borders ≥ 3:1, in both the day and the night theme.

import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const THEME_PATH = path.join(ROOT, "frontend/app/shared/styles/theme.css")

// [foreground token, background token, minimum ratio]
export const PAIRS = [
  ["foreground", "background", 4.5],
  ["foreground", "card", 4.5],
  ["foreground", "muted", 4.5],
  ["muted-foreground", "background", 4.5],
  ["muted-foreground", "card", 4.5],
  ["muted-foreground", "muted", 4.5],
  ["primary-foreground", "primary", 4.5],
  ["accent", "background", 4.5],
  ["accent", "card", 4.5],
  ["success", "card", 4.5],
  ["warning", "card", 4.5],
  ["warning", "background", 4.5],
  ["destructive", "card", 4.5],
  ["destructive", "background", 4.5],
  ["destructive-foreground", "destructive", 4.5],
  // Status pills and banners sit on opaque tints: the tone text, the banner title and its body.
  ["success", "success-surface", 4.5],
  ["warning-foreground", "warning-surface", 4.5],
  ["destructive", "destructive-surface", 4.5],
  ["foreground", "warning-surface", 4.5],
  ["foreground", "destructive-surface", 4.5],
  ["muted-foreground", "warning-surface", 4.5],
  ["muted-foreground", "destructive-surface", 4.5],
  ["destructive-muted", "muted", 4.5],
  ["chip-active-foreground", "chip-active", 4.5],
  ["chip-active-muted", "chip-active", 4.5],
  ["nav-foreground", "nav", 4.5],
  ["nav-muted", "nav", 4.5],
  ["nav-accent", "nav", 4.5],
  // Violet tint behind active tabs and info pills; hovered sidebar items.
  ["accent", "accent-surface", 4.5],
  ["nav-foreground", "nav-raised", 4.5],
  ["nav-muted", "nav-raised", 4.5],
  ["ring", "background", 3],
  ["ring", "muted", 3],
  ["ring", "card", 3],
  ["input", "card", 3],
]

/** Reads the hex tokens of one selector block (`:root,\n[data-theme="day"]` or `[data-theme="night"]`). */
export function parseThemeBlock(css, selectorStart) {
  const start = css.indexOf(selectorStart)
  if (start < 0) throw new Error(`Theme block not found: ${selectorStart}`)
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start))
  const tokens = {}
  for (const match of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) tokens[match[1]] = match[2]
  return tokens
}

function luminance(hex) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(foreground, background) {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

/** Night inherits any token it does not override from day. */
export function checkTheme(css = readFileSync(THEME_PATH, "utf8")) {
  const day = parseThemeBlock(css, ":root,")
  const night = { ...day, ...parseThemeBlock(css, '[data-theme="night"]') }
  const failures = []
  for (const [themeName, tokens] of [["day", day], ["night", night]]) {
    for (const [fg, bg, min] of PAIRS) {
      if (!tokens[fg] || !tokens[bg]) {
        failures.push(`${themeName}: missing --${!tokens[fg] ? fg : bg}`)
        continue
      }
      const ratio = contrastRatio(tokens[fg], tokens[bg])
      if (ratio < min) failures.push(`${themeName}: --${fg} on --${bg} = ${ratio.toFixed(2)} (needs ${min})`)
    }
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = checkTheme()
  if (failures.length) {
    console.error("Contrast failures:")
    for (const line of failures) console.error(`  ✖ ${line}`)
    process.exit(1)
  }
  console.log(`Contrast: all ${PAIRS.length} pairs pass in day and night.`)
}
