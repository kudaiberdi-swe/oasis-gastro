// Full-page screenshots at the three reference widths.
// Usage: node scripts/screenshots.mjs <outDir> <name>=<url> [<name>=<url> ...]
import { mkdirSync } from "node:fs"
import { chromium } from "playwright"

const [outDir, ...targets] = process.argv.slice(2)
if (!outDir || targets.length === 0) {
  console.error("usage: node scripts/screenshots.mjs <outDir> name=url ...")
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })

const widths = [1440, 768, 375]
const browser = await chromium.launch()
for (const target of targets) {
  const [name, url] = target.split(/=(.*)/s)
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const errors = []
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
    page.on("pageerror", (e) => errors.push(String(e)))
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 })
    // Scroll through the page so lazy images and in-view animations fire.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 400) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 120))
      }
      window.scrollTo(0, 0)
    })
    await page.waitForTimeout(1200)
    const docWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    await page.screenshot({ path: `${outDir}/${name}-${width}.png`, fullPage: true })
    console.log(`${name}-${width}: scrollWidth=${docWidth}${docWidth > width ? " (HORIZONTAL OVERFLOW)" : ""}${errors.length ? ` errors=${JSON.stringify(errors)}` : ""}`)
    await page.close()
  }
}
await browser.close()
