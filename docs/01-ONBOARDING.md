# 01 — Онбординг: с чего начать

Документ для нового разработчика или владельца: что за проект, как он устроен, как его запустить и в каком
порядке читать остальную документацию. Всё техническое подробно — в следующих документах; здесь только карта.

## 1. Что такое Sandyq

Собственная система кассы и бэк-офиса для **Sandyq** — казахстанской сети ресторанов этно-кухни
(филиалы Алматы, Шымкент, Түркістан). Цель — со временем заменить iiko (стороннюю ресторанную платформу),
сейчас система работает пилотом рядом с iiko: iiko остаётся источником реальных данных (меню, техкарты, цены,
остатки, персонал, продажи) и **только читается**. Чеки в пилоте нефискальные (`nonFiscal: true`), фискальные
печатает iiko. Подробно о продукте, пользователях и принципах — корневой `PRODUCT.md`.

Проект сделан на основе шаблона `bahandi-pos` (соседний репозиторий в `echo/`), но у него свой бренд и свой,
отдельный Convex-деплой.

## 2. Три поверхности и сайт

| Адрес | Кто работает | Что это |
|---|---|---|
| `/pos` | кассиры, официанты, менеджеры | Касса: выбор терминала, вход по коду и PIN, сетка зала, чеки, оплата, смены, X/Z-отчёты. Интерфейс RU/KK |
| `/kitchen` | кухня | Экран кухни: терминал → PIN → доска заказов по станциям (только RU) |
| `/office` | администраторы, бухгалтерия, склад, HR | Бэк-офис: вход по email и паролю, 12 групп / 91 раздел, 190 отчётов, обмен данными с iiko |
| `frontend/site/` | гости | Отдельный маркетинговый сайт (свой `package.json`, Vite на порту 5180). Сейчас не собирается: папка `src/pages/` пустая (страницы не написаны), деплоя нет |

Корень `/` перенаправляет на `/pos`, `?terminal=<id>` сразу выбирает кассу. Вход в кассу (PIN) и в офис
(email) — две независимые системы, они намеренно не связаны.

## 3. Стек

- **Бэкенд:** Convex — функции (query / mutation / action), realtime-подписки, своя база с индексами.
  Отдельного API-сервера нет.
- **Фронтенд:** React 19, Vite 8, Tailwind 4, `react-router` 7. Касса, кухня и каждый раздел офиса грузятся
  отдельными чанками.
- **Авторизация:** PIN-сессии кассы (свои) и email/пароль офиса (`@convex-dev/auth`).
- **Интеграция:** iiko Server API, только чтение.
- **Тесты:** vitest (+ `convex-test`, Testing Library, jsdom), Playwright для e2e.

## 4. Карта репозитория

Весь фронтенд — в `frontend/`, бэкенд — в `convex/`:

```
sandyq/
├─ convex/            бэкенд (Convex)
├─ frontend/
│  ├─ app/            касса, кухня, офис — алиас `@/` (было `src/`)
│  ├─ site/           маркетинговый сайт для гостей (было `website/`)
│  └─ public/         общие файлы бренда: логотипы, фото, меню (было `public/`)
├─ scripts/ tests/ e2e/ docs/ reference/
└─ index.html vite.config.ts package.json   сборка `frontend/app`
```

Импорты бэкенда из фронтенда — через алиас `@convex/…` (например `@convex/_generated/api`), без относительных `../../convex`.

| Путь | Что там |
|---|---|
| `convex/` | Бэкенд: `schema.ts`, `domains/<домен>/{queries,mutations}.ts` (28 доменов: orders, shifts, catalog, stock, finance, workforce, loyalty, reports, iiko …), общие помощники в `lib/`, `http.ts` (Cloud API), `crons.ts`, `migrations/` |
| `frontend/app/pos/` | Касса: `features/`, `components/`, `model/`, тексты интерфейса RU/KK в `i18n/` |
| `frontend/app/kitchen/` | Экран кухни |
| `frontend/app/office/` | Бэк-офис: оболочка, `engine/` (движок реестров), `features/` (разделы), `model/navigation.ts` |
| `frontend/app/shared/` | Общее: UI-примитивы, маршруты (`routing/routes.tsx`), токены темы (`styles/theme.css` — единственное место с цветами) |
| `scripts/` | Сид (`seed-sandyq.mjs`, `seed-e2e.mjs`), проверки (`check-guards.mjs`, `check-contrast.mjs`, `check-unbounded-queries.mjs`, `verify.sh`), e2e (`e2e-pos.sh`), prod-скрипты (`prod-iiko-import.sh`, `prod-w1-maintenance.sh`), ротация ключей (`rotate-ci-deploy-key.sh`, `rotate-cloud-api-secret.sh`) |
| `scripts/iiko/` | Синхронизация с iiko только на чтение: `extract` → `import-convex` → `reconcile`; клиент в `lib.mjs` умеет только `GET` |
| `e2e/` | Playwright: `smoke/`, `a11y/`, `regressions/`, `screens/` (скриншоты для сверки с bahandi) |
| `tests/` | Все unit/integration-тесты: `convex/`, `pos/`, `kitchen/`, `office/`, `scripts/` |
| `frontend/public/` | Меню (`menu-pdfs/`, разобранные `menu-data/*.json`), логотипы и орнаменты (`branding/`), фото (`images/`) |
| `frontend/site/` | Маркетинговый сайт (отдельное приложение) |
| `docs/` | Эта документация — только `.md`, по порядку чтения |
| `reference/` | Справочные материалы: скриншоты bahandi и сайтов, исходники сайтов-образцов, архив старых планов (см. `reference/README.md`) |
| `.github/workflows/` | CI/CD: `deploy-frontend.yml`, `deploy-backend.yml` |

## 5. Как запустить локально

```bash
npm install
npx convex dev    # в отдельном терминале: поднимает и отслеживает dev-деплой
npm run seed      # один раз: реальное меню, организация, рестораны, терминалы и 3 тестовых PIN
npm run dev       # http://localhost:5173
```

- `npm run seed` выводит PIN кассира, менеджера и администратора и сохраняет их в `.sandyq-seed/`
  (в git не попадает). Запускается только против dev, повторный запуск безопасен.
- Офис: зарегистрироваться на `/office` с любым email, указать его в `OFFICE_BOOTSTRAP_EMAIL`
  (`npx convex env set OFFICE_BOOTSTRAP_EMAIL …`) и при первом входе нажать «Инициализировать офис».
- Реальные данные из iiko (необязательно, нужен локальный `.env` с доступом к iiko): `npm run iiko:discover`,
  затем `npm run iiko:seed`. Как это устроено — `06-IIKO-RUNBOOK.md`.

Все команды — таблица «Common commands» в `README.md`.

## 6. Окружения и деплой

| | dev | production |
|---|---|---|
| Convex-деплой | `dapper-lobster-404` | `clear-flamingo-97` |
| Данные | тестовые, накоплены при разработке | реальный каталог и зеркало iiko |
| Кто туда пишет | `npx convex dev`, `npm run seed`, `npm run iiko:*` | CI и скрипты с ключом деплоя |

- **CI/CD.** Каждый push в `main` запускает GitHub Actions: `verify` (typecheck, тесты, guards; во фронтенде
  ещё contrast, в бэкенде lint:convex), затем деплой — фронтенд в Azure Static Web App `sandyq-frontend`
  (адрес `*.azurestaticapps.net`, своего домена пока нет), бэкенд — `npx convex deploy` в prod. Workflow
  запускаются по путям: фронтенд — `frontend/app/**`, `frontend/public/**` и др., бэкенд — `convex/**` и др. Pull request только
  проверяется и не деплоится. **Push в `main` = выкат в прод.**
- **Ключ деплоя prod: mint → use → delete.** Для ручных действий с prod ключ создаётся одноразово
  (`npx convex deployment token create … --deployment prod`), используется в одной команде как
  `CONVEX_DEPLOY_KEY` и сразу удаляется (`deployment token delete`). Постоянных ключей не держим.
  `prod-iiko-import.sh` и `prod-w1-maintenance.sh` делают это сами.
- **Исключение — CI.** Workflow нужен постоянный ключ: он хранится только в секрете GitHub `CONVEX_DEPLOY_KEY`
  (рядом `AZURE_STATIC_WEB_APPS_API_TOKEN`). Ротация — `scripts/rotate-ci-deploy-key.sh`: ключ не печатается,
  сразу уходит в `gh secret set`.
- **Prod ещё не «живой».** По `README.md` и `03-ARCHITECTURE.md` на prod нет сотрудников с PIN и пользователей
  офиса. Владелец решил запускать prod (`TODO.md` §5) и выдаёт доступы сам: регистрирует офис на
  `OFFICE_BOOTSTRAP_EMAIL`, выдаёт PIN в «Обмен данными с iiko → Доступ сотрудников к Sandyq POS».
  Разработчики и агенты PIN на prod не заводят и офис там не инициализируют без явного решения владельца.

## 7. Жёсткие правила

1. **Никогда не писать в iiko.** Любой скрипт, action и ручной `curl` к iiko — только `GET`. Это рабочий
   аккаунт действующего бизнеса, а не песочница. Мутирующие методы (`POST`/`PUT`/`DELETE`, например
   `/documents/import/*`, `/edi/*/orders/ack`) запрещены. Клиент `scripts/iiko/lib.mjs` умеет только `.get()`,
   это проверяет `tests/scripts/iikoReadOnly.test.ts`.
2. **Только бренд Sandyq.** В аккаунте iiko 8 брендов (Sandyq, Tary, Shopan, Salam Bro, Cinotti и др.). Импорт
   ограничен Sandyq. Другие бренды и спорные подразделения Sandyq (например, Астана, «Сандык Кайнар»)
   не берём без решения руководителя (Haidar).
3. **Секреты не коммитим.** Доступы к iiko — только в локальных `.env` / `iiko-credentials.md`, PIN — в
   `.sandyq-seed/` (все три в `.gitignore`), секреты деплоев — в переменных окружения Convex. В документах и
   `TODO.md` пишем только имена переменных, без значений.
4. **Prod — без PIN и офиса, пока не решит владелец** (см. §6).
5. **Правки Sandyq переживают реимпорт.** Импорт из iiko идемпотентен и не затирает то, что изменили в Sandyq.

## 8. Проверки качества

```bash
bash scripts/verify.sh      # то же, что CI: typecheck → test → guards → contrast → lint:convex
bash scripts/e2e-pos.sh     # e2e локально: сид dev для e2e + весь Playwright (PIN не печатается)
```

- По отдельности: `npm run typecheck`, `npm test`, `npm run guards`, `npm run contrast`, `npm run lint:convex`.
- `npm run e2e` — Playwright сам поднимает Vite на порту 5198 против dev-деплоя. Для теста продажи сначала
  нужен `npm run seed:e2e`, поэтому проще `bash scripts/e2e-pos.sh`. В CI e2e нет, только локально.
- `npm run e2e:screens` — скриншоты в `reference/app-screenshots/W0/` и страница сверки с bahandi
  `reference/app-screenshots/W0/compare.html`.
- `npm run guards` проверяет правила кода: авторизация в публичных функциях, `ConvexError`, ограничение офиса
  по ресторанам, только токены дизайна во фронтенде. Список — `03-ARCHITECTURE.md` § Quality gates.

## 9. Где что искать

| Вопрос | Где |
|---|---|
| Что за продукт, для кого, принципы | `PRODUCT.md` |
| Бизнес-требования и открытые вопросы | `docs/02-BRD.md` |
| Таблицы, функции, связи доменов, окружения | `docs/03-ARCHITECTURE.md` |
| Как выглядит касса / офис | `DESIGN.md`, `docs/04-POS-DESIGN.md`, `docs/05-OFFICE-DESIGN.md` |
| Цвета и токены в коде | `frontend/app/shared/styles/theme.css` |
| Как загрузить данные из iiko | `docs/06-IIKO-RUNBOOK.md`, `scripts/iiko/` |
| API для сайта sandyq.kz | `docs/07-CLOUD-API.md`, `convex/http.ts` |
| Что сделано по плану, решения владельца | `docs/08-IMPLEMENTATION-PLAN.md` §0 и §2 |
| Что осталось сделать людям (ключи, вопросы, запуск prod) | `TODO.md` |
| Картинки сайта | `docs/09-WEBSITE-ASSETS.md` |
| Дизайн-система бренда (токены, паттерны) | `../.claude/sandyq-design.skill` (zip, вне репозитория) |
| Скриншоты bahandi, старые планы | `reference/` |

## 10. Порядок чтения

Документы в корне репозитория (остаются там — их читает инструментарий дизайна):

- `README.md` — запуск, команды, окружения, CI/CD, тесты, известные пробелы.
- `PRODUCT.md` — продукт: пользователи, назначение, ограничения, принципы.
- `DESIGN.md` — дизайн-система приложения и, в разделе «Website», спецификация сайта.
- `TODO.md` — что осталось людям: ключи, вопросы бухгалтеру и шефу, чек-лист запуска prod, очередь кода.

Документы в `docs/`, по порядку:

1. `01-ONBOARDING.md` — этот документ: общая карта проекта.
2. `02-BRD.md` — бизнес-требования: контекст, цели, объём, открытые вопросы и их статус.
3. `03-ARCHITECTURE.md` — технический справочник: схема, API, побочные эффекты, окружения, проверки, пробелы.
4. `04-POS-DESIGN.md` — дизайн кассы, кухни и общих примитивов: токены, типографика, экраны.
5. `05-OFFICE-DESIGN.md` — дизайн офиса: оболочка, шаблоны страниц, навигация, колонки реестров, статусы.
6. `06-IIKO-RUNBOOK.md` — подключение к iiko и загрузка данных (только чтение), в том числе на prod.
7. `07-CLOUD-API.md` — контракт Cloud API для сайта sandyq.kz: подпись, маршруты, вебхуки.
8. `08-IMPLEMENTATION-PLAN.md` — выполненный план W0–W3: статус (§0), решения владельца (§2), задачи по волнам.
9. `09-WEBSITE-ASSETS.md` — карта изображений маркетингового сайта `frontend/site/`.

Архив (история, для работы не нужен): `reference/archive/PLAN.md` — исходный план переноса из bahandi-pos
(решения D1–D9, матрица паритета §13, её читает `scripts/compare-screens.mjs`),
`reference/archive/AGENT-PROMPT.md` — промпт, по которому писался план реализации.
