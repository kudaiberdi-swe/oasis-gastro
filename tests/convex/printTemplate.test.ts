import { describe, expect, it } from "vitest"

import { PRINT_DOCUMENT_TYPES, PRINT_SAMPLES, printLinesHtml, renderPrintTemplate, DEFAULT_PRINT_TEMPLATES, validatePrintTemplate, type PrintTextLine } from "../../convex/lib/printTemplate"

const text = (lines: ReturnType<typeof renderPrintTemplate>["lines"]) => lines.map((line) => (line.kind === "text" ? (line.right !== undefined ? `${line.left} | ${line.right}` : line.left) : line.kind === "logo" ? "[logo]" : "---"))

describe("print template renderer (W3-ADM-10)", () => {
  it("escapes <script> in the template and in values — the print form never carries markup", () => {
    const template = "<script>alert(1)</script>\n[bold]{{order.comment}} || {{totals.total}}"
    const data = { order: { comment: `<img src=x onerror="alert(1)">` }, totals: { total: "1 000 ₸" } }
    const { lines, errors } = renderPrintTemplate(template, "receipt", data)
    expect(errors).toEqual([])
    const html = printLinesHtml(lines)
    expect(html).not.toMatch(/<script|<img/)
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;")
  })

  it("forbids unescaped output and partials", () => {
    expect(validatePrintTemplate("{{{order.comment}}}", "receipt").map((error) => error.message)).toContain("Вывод без экранирования ({{{…}}} и {{&…}}) запрещён")
    expect(validatePrintTemplate("{{& order.comment}}", "receipt")).toHaveLength(1)
    expect(validatePrintTemplate("{{> other}}", "receipt")[0].message).toMatch(/Вложенные шаблоны/)
  })

  it("rejects an unknown placeholder with its line number", () => {
    const errors = validatePrintTemplate("Заказ {{order.number}}\nСтол {{order.tabel}}\n{{#linez}}x{{/linez}}", "receipt")
    expect(errors).toEqual([
      { line: 2, message: "Неизвестный плейсхолдер {{order.tabel}}" },
      { line: 3, message: "Неизвестная секция {{#linez}}" },
    ])
    // A list is not a value; a field of a list is known only inside it.
    expect(validatePrintTemplate("{{lines}}", "receipt")[0].message).toMatch(/это список/)
    expect(validatePrintTemplate("{{amount}}", "receipt")[0].message).toBe("Неизвестный плейсхолдер {{amount}}")
    // Each document type has its own placeholders.
    expect(validatePrintTemplate("{{cash.expected}}", "receipt")).toHaveLength(1)
    expect(validatePrintTemplate("{{cash.expected}}", "z-report")).toEqual([])
  })

  it("checks section nesting", () => {
    expect(validatePrintTemplate("{{#lines}}{{name}}", "receipt")[0].message).toBe("Секция {{#lines}} не закрыта")
    expect(validatePrintTemplate("{{/lines}}", "receipt")[0].message).toMatch(/без открывающего/)
    expect(validatePrintTemplate("{{#lines}}{{#payments}}{{/lines}}{{/payments}}", "receipt")[0].message).toBe("Ожидался {{/payments}}, а не {{/lines}}")
    expect(validatePrintTemplate("{{order.number", "receipt")[0].message).toMatch(/Незакрытые/)
  })

  it("repeats list sections, drops empty lines and keeps standalone tags off paper", () => {
    const template = "Чек\n{{#lines}}\n{{quantity}} × {{name}} || {{amount}}\n[small]  {{details}}\n{{/lines}}\n{{^payments}}\nНе оплачен\n{{/payments}}"
    const { lines, errors } = renderPrintTemplate(template, "receipt", {
      lines: [
        { name: "Бешбармак", quantity: 2, amount: "11 800 ₸", details: "Большая порция" },
        { name: "Чай", quantity: 1, amount: "900 ₸", details: "" },
      ],
      payments: [],
    })
    expect(errors).toEqual([])
    expect(text(lines)).toEqual(["Чек", "2 × Бешбармак | 11 800 ₸", "Большая порция", "1 × Чай | 900 ₸", "Не оплачен"])
    expect((lines[2] as PrintTextLine).size).toBe("small")
  })

  it("reads layout only from the template: a value with || or [bold] stays text", () => {
    const { lines } = renderPrintTemplate("[center][bold]{{order.comment}}\n---\n[logo]", "receipt", { order: { comment: "[box]А || Б\nВ" } })
    expect(lines[0]).toMatchObject({ kind: "text", left: "[box]А || Б В", align: "center", bold: true, box: false })
    expect(lines[0]).not.toHaveProperty("right")
    expect(lines.slice(1).map((line) => line.kind)).toEqual(["divider", "logo"])
    expect(printLinesHtml(renderPrintTemplate("[logo]", "receipt", { restaurant: { name: "Шафран <Алматы>" }, organization: { name: "ТОО" } }).lines)).toBe('<h1 class="brand">Шафран &lt;Алматы&gt;</h1>')
    expect(printLinesHtml(renderPrintTemplate("[logo]", "receipt", { organization: { name: "ТОО «Сеть»" } }).lines)).toContain("ТОО «Сеть»")
    expect(printLinesHtml(lines.slice(2))).toBe("")
  })

  it("seeds valid default templates with the bilingual service charge line and no client branding", () => {
    for (const seed of DEFAULT_PRINT_TEMPLATES) expect(validatePrintTemplate(seed.template, seed.documentType), seed.name).toEqual([])
    const receipt = DEFAULT_PRINT_TEMPLATES.find((seed) => seed.documentType === "receipt")!
    const rendered = text(renderPrintTemplate(receipt.template, "receipt", PRINT_SAMPLES.receipt).lines)
    expect(rendered).toContain("Қызмет ақысы 15 % / Обслуживание 15 % | 2 385 ₸")
    expect(rendered[0]).toBe("[logo]")
    expect(renderPrintTemplate(receipt.template, "receipt", PRINT_SAMPLES.receipt).lines[0]).toEqual({ kind: "logo", name: "Ресторан Алматы" })
    for (const seed of DEFAULT_PRINT_TEMPLATES) expect(seed.template + seed.name).not.toMatch(/sandyq|DALA/i)
    for (const type of PRINT_DOCUMENT_TYPES) expect(PRINT_SAMPLES[type]).toBeTruthy()
  })
})
