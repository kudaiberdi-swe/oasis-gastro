#!/usr/bin/env node
// Parity report (W0-CI-03): one row per screen of the §13 matrix in reference/archive/PLAN.md, the bahandi screenshot on
// the left and the sandyq one (reference/app-screenshots/<wave>/…, from `npm run e2e:screens`) on the
// right, day and night. Output: reference/app-screenshots/<wave>/compare.html. Courier rows are skipped.

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const REFERENCE = path.join(ROOT, "reference")
const wave = process.argv[2] ?? "W0"
const outDir = path.join(REFERENCE, "app-screenshots", wave)

// POS screens have no /office/<id> route; map matrix routes to the harness screenshot names.
const POS_SHOTS = { "Выбор терминала": "pos/01-terminal-picker", "Вход по коду и PIN": "pos/02-login-empty" }

export function parseMatrix(markdown) {
  const section = markdown.slice(markdown.indexOf("## 13."), markdown.indexOf("\n## 14.") > 0 ? markdown.indexOf("\n## 14.") : undefined)
  const rows = []
  for (const line of section.split("\n")) {
    if (!line.startsWith("|") || line.startsWith("|---") || line.includes("| Скриншот bahandi |")) continue
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim())
    if (cells.length < 5) continue
    const [screen, shots, template, route, waveCell] = cells
    const bahandi = [...shots.matchAll(/(?:bahandi-screenshots\/)?((?:pos|office|office-details|kitchen)\/[\w.…-]+\.(?:jpg|png))/g)].map((match) => `bahandi-screenshots/${match[1]}`)
    if (/courier/i.test(shots) || /\/courier/.test(route)) continue
    const officeId = route.match(/`\/office\/([\w-]+)`/)?.[1]
    const sandyq = officeId ? `office/${officeId}` : POS_SHOTS[screen.replace(/\s*\(.*\)$/, "")]
    rows.push({ screen: screen.replace(/`/g, ""), template, route: route.replace(/`/g, ""), wave: waveCell, bahandi, sandyq })
  }
  return rows
}

function image(src, alt) {
  return existsSync(path.join(REFERENCE, src)) ? `<img loading="lazy" src="../../${src}" alt="${alt}">` : `<div class="missing">нет скриншота<br><code>${src}</code></div>`
}

function render(rows) {
  const body = rows
    .map(
      (row) => `<tr>
  <td><strong>${row.screen}</strong><br><small>${row.route} · ${row.wave}</small><br><small>${row.template}</small></td>
  <td>${row.bahandi.filter((src) => !src.includes("…")).map((src) => image(src, "bahandi")).join("") || '<div class="missing">—</div>'}</td>
  <td>${row.sandyq ? image(`app-screenshots/${wave}/${row.sandyq}-day.png`, "sandyq day") : '<div class="missing">не снимается в этой волне</div>'}</td>
  <td>${row.sandyq ? image(`app-screenshots/${wave}/${row.sandyq}-night.png`, "sandyq night") : ""}</td>
</tr>`,
    )
    .join("\n")
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Сверка экранов ${wave}</title>
<style>
body{font:14px/1.4 system-ui,sans-serif;margin:24px;background:#fff7ec;color:#121316}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #e8e3dc;padding:8px;vertical-align:top;background:#fff}
th{text-align:left;font-weight:600;position:sticky;top:0}img{max-width:420px;display:block;margin-bottom:6px;border:1px solid #e8e3dc}
.missing{width:260px;padding:24px;color:#6b6159;background:#f5ecdf;text-align:center}small{color:#6b6159}
</style></head><body>
<h1>Сверка экранов ${wave}: bahandi → sandyq</h1>
<p>${rows.length} экранов из reference/archive/PLAN.md §13 (курьер пропущен). Скриншоты sandyq — <code>npm run e2e:screens</code>.</p>
<table><thead><tr><th>Экран</th><th>bahandi</th><th>sandyq · день</th><th>sandyq · ночь</th></tr></thead><tbody>
${body}
</tbody></table></body></html>
`
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = parseMatrix(readFileSync(path.join(REFERENCE, "archive", "PLAN.md"), "utf8"))
  const file = path.join(outDir, "compare.html")
  writeFileSync(file, render(rows))
  const withShots = rows.filter((row) => row.sandyq && existsSync(path.join(REFERENCE, `app-screenshots/${wave}/${row.sandyq}-day.png`))).length
  console.log(`Parity report: ${path.relative(ROOT, file)} — ${rows.length} screens, ${withShots} with sandyq screenshots.`)
}
