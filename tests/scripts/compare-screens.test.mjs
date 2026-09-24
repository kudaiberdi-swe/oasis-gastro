import { describe, expect, it } from "vitest"

import { parseMatrix } from "../../scripts/compare-screens.mjs"

const SAMPLE = `## 13. Матрица
| Экран | Скриншот bahandi | Шаблон Sandyq | Маршрут | Волна | Сейчас в sandyq |
|---|---|---|---|---|---|
| Выбор терминала | \`bahandi-screenshots/pos/01-terminal-picker.jpg\` | Вход | \`/pos\` (без сессии) | W0 | ⚠️ |
| Номенклатура (\`nomenclature\`) | [\`office/10-nomenclature.jpg\`](bahandi-screenshots/office/10-nomenclature.jpg) | Реестр | \`/office/nomenclature\` | W1 | ⚠️ |
| Курьер | \`bahandi-screenshots/courier/01-x.jpg\` | PWA | \`/courier\` | W2 | ❌ |
## 14. Next
`

describe("compare-screens matrix parser", () => {
  it("pairs bahandi screenshots with sandyq screens and skips the courier", () => {
    const rows = parseMatrix(SAMPLE)
    expect(rows.map((row) => row.sandyq)).toEqual(["pos/01-terminal-picker", "office/nomenclature"])
    expect(rows[1].bahandi).toContain("bahandi-screenshots/office/10-nomenclature.jpg")
  })
})
