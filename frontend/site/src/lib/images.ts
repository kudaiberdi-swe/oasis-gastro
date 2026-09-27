import manifest from "@/config/images.gen.json"

type RasterEntry = { type: "raster"; width: number; height: number; widths: number[] }
type SvgEntry = { type: "svg"; src: string; width: number; height: number }
type Entry = RasterEntry | SvgEntry

const images = manifest as Record<string, Entry>

export function getImage(name: string): Entry {
  const entry = images[name]
  if (!entry) throw new Error(`Unknown image "${name}" — run npm run images and check docs/09-WEBSITE-ASSETS.md`)
  return entry
}

/** Resolved <img> attributes for an asset: src, srcSet and intrinsic size. */
export function imageSource(name: string) {
  const entry = getImage(name)
  if (entry.type === "svg") return { src: entry.src, width: entry.width, height: entry.height }
  const largest = entry.widths[entry.widths.length - 1]
  return {
    src: `/img/${name}-${largest}.webp`,
    srcSet: entry.widths.map((w) => `/img/${name}-${w}.webp ${w}w`).join(", "),
    width: entry.width,
    height: entry.height,
  }
}
