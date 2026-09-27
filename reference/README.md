# reference — справочные материалы

Не документация проекта (она в `docs/`, порядок чтения — `docs/01-ONBOARDING.md`), а материалы, на которые
документы ссылаются. В git попадают только этот файл, `archive/` и исходники `site-rebuild/`; папки со скриншотами и исходниками
(≈41 МБ) лежат локально и перечислены в `.gitignore`.

| Папка | Что там | Откуда | В git |
|---|---|---|---|
| `archive/` | Старые документы, оставленные для истории: `PLAN.md` — исходный план переноса bahandi-pos → sandyq (решения D1–D9, матрица паритета §13), `AGENT-PROMPT.md` — промпт, по которому написан `docs/08-IMPLEMENTATION-PLAN.md`, `DESIGN-pointer.md` — бывший `docs/DESIGN.md`, указатель на корневой `DESIGN.md` | бывшая `docs/` | да |
| `app-screenshots/` | Скриншоты sandyq по волнам (`W0/<surface>/<name>-<theme>.png`) и страница сверки `W0/compare.html` | `npm run e2e:screens` (`e2e/fixtures.ts`, `scripts/compare-screens.mjs`) | нет |
| `bahandi-screenshots/` | Скриншоты живого стенда bahandi-pos — эталон раскладки экранов; индекс — `bahandi-screenshots/README.md` | сняты 2026-09-24, часть — `reference/site-rebuild/scripts/_b2.mjs` | нет |
| `site-screenshots/` | Скриншоты сайтов-образцов sandyq.kz и sandyqgroup.com (375 / 768 / 1440 px) | бывшая `docs/reference-screenshots/` | нет |
| `site-src/` | Сохранённые HTML / CSS / JS этих сайтов (исходник токенов маркетингового сайта) | бывшая `docs/reference-src/` | нет |
| `site-rebuild/` | Недоделанная пересборка маркетингового сайта sandyqgroup.com на React (сентябрь 2026): блоки главной есть, страниц (`src/pages/`) нет, тексты и контакты — заглушки. Из неё снят раздел «Website» корневого `DESIGN.md`. Настоящий сайт гостей sandyq.kz отдельный и связан с системой через Cloud API (`docs/07-CLOUD-API.md`) | бывшая `website/`, потом `frontend/site/`; картинки в `public/` генерирует `scripts/optimize-images.mjs` из `frontend/public` | исходники — да, картинки — нет |

`scripts/compare-screens.mjs` читает матрицу из `archive/PLAN.md` §13 и картинки из `app-screenshots/` и
`bahandi-screenshots/`, поэтому эти пути не переименовывать без правки скрипта.
