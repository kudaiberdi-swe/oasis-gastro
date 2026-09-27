# reference — справочные материалы

Не документация проекта (она в `docs/`, порядок чтения — `docs/01-ONBOARDING.md`), а материалы, на которые
документы ссылаются. В git попадают этот файл, `archive/` и исходники `site-rebuild/`; `site-src/` лежит только локально (`.gitignore`).
Скриншоты bahandi, сайтов-образцов и sandyq удалены 2026-09-27.

| Папка | Что там | Откуда | В git |
|---|---|---|---|
| `archive/` | Старые документы, оставленные для истории: `PLAN.md` — исходный план переноса bahandi-pos → sandyq (решения D1–D9, матрица паритета §13), `AGENT-PROMPT.md` — промпт, по которому написан `docs/08-IMPLEMENTATION-PLAN.md`, `DESIGN-pointer.md` — бывший `docs/DESIGN.md`, указатель на корневой `DESIGN.md` | бывшая `docs/` | да |
| `site-src/` | Сохранённые HTML / CSS / JS этих сайтов (исходник токенов маркетингового сайта) | бывшая `docs/reference-src/` | нет |
| `site-rebuild/` | Недоделанная пересборка маркетингового сайта sandyqgroup.com на React (сентябрь 2026): блоки главной есть, страниц (`src/pages/`) нет, тексты и контакты — заглушки. Из неё снят раздел «Website» корневого `DESIGN.md`. Настоящий сайт гостей sandyq.kz отдельный и связан с системой через Cloud API (`docs/07-CLOUD-API.md`) | бывшая `website/`, потом `frontend/site/`; картинки в `site-rebuild/public/` генерирует `site-rebuild/scripts/optimize-images.mjs` из `frontend/public` | исходники — да, картинки — нет |

