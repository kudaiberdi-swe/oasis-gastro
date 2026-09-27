#!/usr/bin/env node
// Writes the local manual-testing sheet test-credentials.local.md (gitignored, mode 0600) for
// docs/10-TESTING-GUIDE.md: dev POS logins from the newest .sandyq-seed/credentials-*.json (written by
// `npm run seed` / `npm run seed:e2e`) plus blank rows for what only the owner knows (office passwords,
// prod PINs). Values are never printed. Re-running refreshes only the generated block and keeps
// everything the owner typed outside it.
//
//   npm run test:credentials

import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SEED_DIR = path.join(ROOT, ".sandyq-seed")
const OUT = path.join(ROOT, "test-credentials.local.md")
const START = "<!-- generated:start -->"
const END = "<!-- generated:end -->"

const ROLE_LABEL = { cashier: "Кассир", manager: "Менеджер", administrator: "Администратор", kitchen: "Кухня" }
const DEV_TERMINALS = [
  ["sandyq-almaty-01", "Sandyq Алматы · Касса 1"],
  ["sandyq-shymkent-01", "Sandyq Шымкент · Касса 1"],
  ["sandyq-turkistan-01", "Sandyq Түркістан · Касса 1"],
]

/** The generated block: dev POS logins by role, from the seed's plaintext credentials. */
export function renderGenerated({ generatedAt, deployment, credentials }) {
  const rows = credentials.map((entry) => `| ${ROLE_LABEL[entry.role] ?? entry.role} | \`${entry.code}\` | \`${entry.pin}\` |`)
  return [
    START,
    "## Dev — вход в кассу и на кухню (из последнего сида)",
    "",
    `Сид: ${generatedAt ?? "—"}, деплой \`${deployment ?? "—"}\`. Сотрудники работают во всех трёх филиалах.`,
    "Каждый `npm run seed` / `npm run seed:e2e` выдаёт новые PIN — после него запустите `npm run test:credentials` ещё раз.",
    "",
    "| Роль | Код | PIN |",
    "|---|---|---|",
    ...rows,
    "",
    "Терминалы dev (адрес `http://localhost:5173/pos?terminal=<id>`):",
    "",
    ...DEV_TERMINALS.map(([id, name]) => `- \`${id}\` — ${name}`),
    END,
  ].join("\n")
}

/** The owner-filled part, written only when the file does not exist yet. */
export function renderManual() {
  return [
    "",
    "## Dev — офис",
    "",
    "| Что | Значение |",
    "|---|---|",
    "| Адрес | http://localhost:5173/office |",
    "| Email администратора | |",
    "| Пароль | |",
    "| Второй пользователь (филиал / роль) | |",
    "",
    "## Prod",
    "",
    "Сид на prod PIN не создаёт — тестовых сотрудников заводите сами (docs/10-TESTING-GUIDE.md §1.3) и отключайте после проверки.",
    "",
    "| Что | Значение |",
    "|---|---|",
    "| Офис | https://thankful-moss-04c3d4a0f.4.azurestaticapps.net/office |",
    "| Касса | https://thankful-moss-04c3d4a0f.4.azurestaticapps.net/pos |",
    "| Email администратора (`OFFICE_BOOTSTRAP_EMAIL`) | |",
    "| Пароль | |",
    "| Тестовый кассир: филиал / код / PIN | |",
    "| Тестовый менеджер: филиал / код / PIN | |",
    "| Тестовая кухня: филиал / код / PIN | |",
    "",
  ].join("\n")
}

/** Replaces the generated block of an existing sheet, or builds a new one. */
export function composeSheet(existing, generated) {
  const header = "# Тестовые доступы Sandyq — только локально, не коммитить и не пересылать\n\n"
  if (existing && existing.includes(START) && existing.includes(END)) {
    return existing.slice(0, existing.indexOf(START)) + generated + existing.slice(existing.indexOf(END) + END.length)
  }
  return header + generated + "\n" + renderManual()
}

function newestSeed() {
  if (!existsSync(SEED_DIR)) return null
  const files = readdirSync(SEED_DIR).filter((name) => /^credentials-\d+\.json$/.test(name)).sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]))
  return files[0] ? path.join(SEED_DIR, files[0]) : null
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const seed = newestSeed()
  if (!seed) {
    console.error("✖ No .sandyq-seed/credentials-*.json — run `npm run seed` on the dev deployment first.")
    process.exit(1)
  }
  const generated = renderGenerated(JSON.parse(readFileSync(seed, "utf8")))
  const existing = existsSync(OUT) ? readFileSync(OUT, "utf8") : null
  writeFileSync(OUT, composeSheet(existing, generated), { mode: 0o600 })
  chmodSync(OUT, 0o600)
  console.log(`✔ ${path.relative(ROOT, OUT)} updated from ${path.relative(ROOT, seed)} (values not printed). Open it in your editor.`)
}
