import { chromium } from "playwright"
const out = "/Users/beket/Desktop/echo/sandyq/reference/bahandi-screenshots"
const base = "https://bahandi-pos.vercel.app"
const b = await chromium.launch()
const shot = async (page, name) => { await page.waitForTimeout(3000); await page.screenshot({ path: `${out}/${name}.png` }); console.log("shot", name, page.url()) }
// Office
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
let p = await ctx.newPage()
await p.goto(base + "/office/dashboard", { waitUntil: "networkidle" })
await p.fill('input[type="email"]', "admin@bahandi.kz")
await p.fill('input[type="password"]', "BahandiTest2026")
await p.getByRole("button", { name: "Войти" }).click()
await p.waitForTimeout(5000)
await shot(p, "office-01-dashboard")
console.log((await p.evaluate(() => document.body.innerText)).slice(0, 2500))
for (const [path, name] of [["/office/kitchen-board","office-02-kitchen-board"],["/office/nomenclature","office-03-nomenclature"],["/office/reports","office-04-reports"],["/office/receipts","office-05-receipts"]]) {
  await p.goto(base + path, { waitUntil: "networkidle" }); await shot(p, name)
}
await b.close()
