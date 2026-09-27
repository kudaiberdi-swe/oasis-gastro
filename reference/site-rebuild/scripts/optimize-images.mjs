// Turns the raster images in ../../frontend/public (the repo's single source of brand/photo assets)
// into responsive WebP variants under reference/site-rebuild/public/img, copies the SVGs to
// reference/site-rebuild/public/svg, copies the menu PDFs to reference/site-rebuild/public/menu, and writes src/config/images.gen.json with intrinsic sizes
// so every <img> can reserve its box and carry a srcset.
//
// Runs automatically before `dev` and `build`; unchanged sources are skipped.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { basename, extname, join } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const here = fileURLToPath(new URL(".", import.meta.url))
const sourceRoot = join(here, "../../../frontend/public")
const outImg = join(here, "../public/img")
const outSvg = join(here, "../public/svg")
const manifestPath = join(here, "../src/config/images.gen.json")
const sourceDirs = ["images", "branding"]
const widths = [480, 768, 1080, 1440, 1920]
const quality = 78

mkdirSync(outImg, { recursive: true })
mkdirSync(outSvg, { recursive: true })

const manifest = {}
for (const dir of sourceDirs) {
  for (const file of readdirSync(join(sourceRoot, dir))) {
    const src = join(sourceRoot, dir, file)
    const ext = extname(file).toLowerCase()
    const name = basename(file, extname(file))

    if (ext === ".svg") {
      // Strip XML comments: some sources contain "--" inside comments, which is invalid XML.
      const svg = readFileSync(src, "utf8").replace(/<!--[\s\S]*?-->/g, "")
      writeFileSync(join(outSvg, file), svg)
      const [, w, h] = svg.match(/viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/) ?? []
      manifest[name] = { type: "svg", src: `/svg/${file}`, width: Number(w), height: Number(h) }
      continue
    }
    if (![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) continue

    const { width, height } = await sharp(src).metadata()
    // Skip variants within 15% of the original width — they cost bytes and save nothing.
    const sizes = widths.filter((w) => w < width * 0.85)
    sizes.push(width)
    const srcMtime = statSync(src).mtimeMs
    for (const w of sizes) {
      const out = join(outImg, `${name}-${w}.webp`)
      if (existsSync(out) && statSync(out).mtimeMs >= srcMtime) continue
      await sharp(src).resize({ width: w }).webp({ quality, effort: 5 }).toFile(out)
    }
    manifest[name] = { type: "raster", width, height, widths: sizes }
  }
}

// Menu PDFs are linked from the location cards; copy them as-is.
const outMenu = join(here, "../public/menu")
mkdirSync(outMenu, { recursive: true })
for (const file of readdirSync(join(sourceRoot, "menu-pdfs"))) {
  if (!file.endsWith(".pdf")) continue
  const src = join(sourceRoot, "menu-pdfs", file)
  const out = join(outMenu, file)
  if (!existsSync(out) || statSync(out).mtimeMs < statSync(src).mtimeMs) copyFileSync(src, out)
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
console.log(`images: ${Object.keys(manifest).length} assets → public/img, public/svg`)
