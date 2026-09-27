// Split tall full-page screenshots into viewable chunks: node scripts/slice.mjs <in.png> <outDir> [chunkHeight]
import { mkdirSync } from "node:fs"
import { basename } from "node:path"
import sharp from "sharp"
const [input, outDir, h = "1400"] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const { width, height } = await sharp(input).metadata()
const chunk = Number(h)
for (let i = 0, top = 0; top < height; i++, top += chunk) {
  const hh = Math.min(chunk, height - top)
  await sharp(input).extract({ left: 0, top, width, height: hh }).toFile(`${outDir}/${basename(input, ".png")}-${String(i).padStart(2, "0")}.png`)
}
console.log(input, width, height, Math.ceil(height / chunk))
