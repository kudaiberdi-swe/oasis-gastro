# PLAN — перенос всего функционала bahandi-pos в sandyq с дизайном Sandyq

> Статус: план от 2026-09-24, выполнен через `docs/08-IMPLEMENTATION-PLAN.md` (W0–W3; что осталось — его §0 и `TODO.md`). Описания «как сейчас в S» ниже — состояние sandyq на 2026-09-24, до переноса; как устроено сейчас — `docs/03-ARCHITECTURE.md`.
> Источник функционала — `/Users/beket/Desktop/echo/bahandi-pos` (демо-стенд https://bahandi-pos.vercel.app).
> Целевой проект — `/Users/beket/Desktop/echo/sandyq`.
> Дизайн — `docs/04-POS-DESIGN.md` (токены и касса, кухня, курьер), `docs/05-OFFICE-DESIGN.md` (офис: оболочка, шаблоны, колонки реестров, статусы), `DESIGN.md` в корне (дизайн-система приложения и раздел «Website» — токены, снятые с sandyqgroup.com; `docs/DESIGN.md` — указатель), `docs/09-WEBSITE-ASSETS.md` (картинки), `/Users/beket/Desktop/echo/.claude/sandyq-design.skill` (дизайн-система Sandyq, zip).

Документ собран по полному чтению обоих репозиториев: `convex/`, `src/`, `scripts/`, `docs/`, `plans/`. Пути ниже даны относительно корня соответствующего репо: **B:** — `bahandi-pos/`, **S:** — `sandyq/`.

---

## 0. Коротко

| | bahandi-pos | sandyq сейчас |
|---|---|---|
| Бэкенд | ≈13,1 тыс. строк, 45 модулей, `schema.ts` на 1722 строки (≈90 таблиц) | ≈4,9 тыс. строк, 11 доменов, `schema.ts` на 581 строку (≈35 таблиц) |
| Фронтенд | 62 `.tsx`, 91 раздел офиса в 12 группах, POS, кухня, курьерское PWA | 33 `.tsx`, 6 разделов офиса, POS с кухней внутри |
| Учёт | двойная запись, иммутабельные складские движения, техкарты с автосписанием, закрытие периода, outbox | плоский P&L-журнал, ручной склад без техкарт |
| Модель продаж | фастфуд: **один** черновик на терминал, **без** сервисного сбора, типы заказа in/takeaway/delivery | ресторан с обслуживанием: **много** открытых чеков (столы), сервисный сбор 15 %, только dine-in |
| Дизайн | шаблон Bahandi: оранжевый `#FF5E12`, Manrope, текст 7–9 px, радиусы 10–12 px | токены Sandyq-skill (walnut/felt/kilim/brass, Cormorant + Golos), но компоненты по-прежнему от шаблона |

Итог: sandyq сейчас покрывает примерно 15–20 % функционала bahandi. Сильно не хватает номенклатуры (модификаторы, размеры, приказы о ценах, техкарты), склада-документооборота, производства, двойной записи и финансов, персонала и зарплаты, CRM и лояльности со списанием, доставки и курьера, отчётов (190 против 3), платформенных разделов и интеграций.

**Что в sandyq лучше и что надо сохранить при переносе** (подробно в §5): много открытых чеков, сервисный сбор 15 % с отменой через менеджера, двуязычный каталог (`nameKk`), цены по филиалам, доменная структура `convex/domains/*`, реальные данные iiko Sandyq на проде, проверки `restaurantScope` в мутациях, отсутствие неавторизованных мутаций каталога (у bahandi их много).

---

## 1. Решения, которые нужны до старта

Ниже решения, без которых нельзя начинать. Рекомендация стоит первой.

| # | Вопрос | Рекомендация | Почему |
|---|---|---|---|
| D1 | **Стратегия переноса** | **Переносить по доменам в структуру sandyq** (`convex/domains/<d>/{queries,mutations}.ts`), используя bahandi как эталон логики. Не копировать `convex/` и `src/` bahandi целиком. | У sandyq на проде реальные данные (135 продуктов, 12 подразделений, 363 сотрудника iiko), а CI деплоит `convex/**` прямо в прод (`S:.github/workflows/deploy-backend.yml`). Если заменить схему целиком, деплой упадёт на валидации существующих документов. У bahandi ≈10 модулей без авторизации (§7) — копировать их как есть нельзя. |
| D2 | **Палитра** | Цвета брать с реального сайта (`docs/DESIGN.md`): cream `#FFF7EC`, ink `#121316`, gold `#B28F6F`, wine `#8C2323`, rust `#A33009`. Skill-палитру (walnut/felt/kilim/brass) держать как вторичную: kilim ≈ wine, brass-lo ≈ gold-link. Подробно в `POS-DESIGN.md` §2. | Skill сам пишет: «If you have exact hex values from the live site… replace them here only» (`references/tokens.css:2-4`). В `S:src/shared/styles/theme.css:7-10` сказано, что палитра «sourced from sandyqgroup.com», но это не так. |
| D3 | **Шрифты** | Оставить **Golos Text** для UI и **Cormorant** для display (цены, заголовки), как сейчас в sandyq. Системные шрифты и Times с сайта в приложение не переносить. | Касса — это плотный интерфейс с цифрами. Golos хорошо поддерживает казахскую кириллицу (ә ғ қ ң ө ұ ү һ і). Times на сайте появился случайно (DESIGN.md §2). |
| D4 | **Объём модулей** | **Полный паритет с bahandi.** Переносятся все 90 разделов офиса, касса, экран кухни, курьер, киоск, Cloud API, телефония, карточки интеграций и все 190 отчётов. Раскладка экранов и состав функций — как на стенде bahandi (`reference/bahandi-screenshots/`), визуальный стиль — Sandyq (`POS-DESIGN.md`). Меняется только очерёдность (волны §9), объём не урезается. Единственное исключение — ЕГАИС: в bahandi он тоже выключен для KZ, раздел переносится в том же виде «Недоступно для KZ». | Решение пользователя от 2026-09-24: «все фичи с bahandi должны быть в sandyq, дизайн и фичи примерно как в bahandi, но дизайн Sandyq». |
| D5 | **Модель продаж** | **Раскладка кассы как у bahandi + ресторанные функции sandyq.** Экран кассы повторяет bahandi (`pos/04-main-screen.jpg`): слева панель заказа, справа каталог с тёмной полосой поиска и чипами категорий, внизу панель «Скидка / Гость / Комментарий / Ещё» и «Отложить / Оплатить». Из sandyq добавляются много открытых чеков (переключатель столов в шапке панели заказа, `POS-DESIGN.md` §11.2), столы и сервисный сбор. Из bahandi — модификаторы, размеры, типы заказа (В зале / Навынос / Доставка), справочники розницы, split, transfer, возвраты, история. Сервисный сбор настраивается по типу заказа. | Sandyq — ресторан (BRD), bahandi — фастфуд: раскладку берём у bahandi, ресторанную логику сохраняем. |
| D6 | **Фискализация** | Пока оставить `nonFiscal: true`, как в обоих проектах. Интеграцию с ОФД или ККМ РК спроектировать отдельно, когда бизнес подтвердит. | `S:README.md:52`, `S:docs/03-ARCHITECTURE.md:419`, `S:docs/02-BRD.md` §5. |
| D7 | **Персональные данные из iiko** | Перед импортом новых эндпоинтов (attendance, orders, guests) нужно решение BRD §9. Пока импортировать только мастер-данные (stores, terminals, products, units, suppliers) — это GET-only. | Зеркало сотрудников уже лежит на проде без решения по ПДн. |
| D8 | **Язык интерфейса** | RU по умолчанию. Названия блюд показывать на KZ и RU (`nameKk` и `name`). Переключатель RU — KZ — EN держать в конфиге на будущее. | Skill задаёт порядок KZ → RU → EN, у меню уже есть `nameKk`. |
| D9 | **CI/CD** | До начала крупных миграций добавить в `deploy-backend.yml` шаги `npm test` + `tsc -b` + `convex dev --once --typecheck` перед `convex deploy`. Выделить отдельный preview- или dev-деплой. | Сейчас любой мёрж в `convex/**` сразу уходит в прод без тестов. |

---

## 2. Сводная матрица возможностей

Легенда: ✅ есть · ⚠️ частично · ❌ нет · ➖ не нужно или отложено.

| Домен | bahandi-pos | sandyq | Разрыв (что переносить) |
|---|---|---|---|
| Авторизация POS (PIN, сессии, блокировка) | ✅ `B:convex/posAuth.ts`, `posAuthInternal.ts`, `posHelpers.ts` | ✅ `S:convex/domains/auth/*`, `lib/auth.ts` | Паритет. Добавить: `posExperience` (избранное, уведомления, аудит терминала), список терминалов с бэкенда вместо захардкоженного пикера |
| Авторизация и права офиса | ✅ права `office.<module>.<view/edit/post/approve/reverse/cancel>`, 3 вида scope (org, restaurant, warehouse), 7 системных ролей, UI ролей и пользователей | ⚠️ одна роль `administrator` через bootstrap, права на уровне модуля, без UI | Гранулярные действия, `organizationScopes` и `warehouseScopes`, `saveRole`, `saveUser`, `listAccessControl`, системные роли, UI «Роли и права» и «Пользователи» |
| Орг. структура | ✅ organizations, restaurants, terminals, departments, закрытие периода, `platformRecords` | ⚠️ organizations, restaurants, terminals (только seed и iiko) | `periodLocks` + `assertPeriodOpen`, CRUD организаций, ресторанов и терминалов в офисе, `salesWarehouseId` у терминала |
| Каталог | ✅ иерархия групп, фото (storage), тип (dish/good/preparation), prepArea, writeOffMethod, markup, overlay iiko | ⚠️ плоские категории, RU и KZ, цены по филиалам, без фото | Иерархия, фото, `itemType`, `prepArea`, `writeOffMethod`, `unitWeightKg`, `iikoEntityOverlays` (локальные правки поверх iiko). **Сохранить** `nameKk` и `productPrices` по филиалам |
| Модификаторы | ✅ группы, модификаторы, привязки к блюду с правилами min/max/free/default, бесплатные порции | ❌ `modifiers: string[]` как свободный текст | Весь домен (`B:convex/modifiers.ts`, 5 таблиц) + расчёт `validateAndPriceModifiers` |
| Шкалы размеров | ✅ | ❌ (`sizeLabel` зарезервировано) | `B:convex/sizeScales.ts` + цена размера + коэффициент списания |
| Приказы о ценах | ✅ с расписанием по дням недели и часам, крон статусов | ❌ | `B:convex/pricing.ts` + крон `reconcileStatuses`. Решить конфликт с `productPrices` по филиалам (§3.3) |
| Техкарты | ✅ одна на продукт, брутто, нетто, потери, автосписание при продаже | ❌ | `recipes` и `recipeLines`, `saveRecipe`, `consumeOrderStock`. Исправить баги bahandi (§7) |
| Заказы POS | ✅ один черновик, split, transfer, cancel с причиной, refund с лояльностью, история | ⚠️ много чеков, hold, resume, cancel, refund, transfer на бэке; в UI нет refund, cancel, resume, истории, transfer | Split, причины удаления (справочник), `orderTypeExternalId`, `discountTypeExternalId`, `modifierSelections`, `kitchenModifiers`, `retailConfigVersion`, UI истории, возврата, отмены, переноса, комментария |
| Оплата | ✅ типы оплат из справочника (processorKind, account, combinable), проводки на каждую оплату | ⚠️ cash/card/qr захардкожены, без проводок | `retailSettings` payment-type, проводки Дт касса/банк — Кт выручка, флаги `combinable`/`allowsChange` |
| Смены и касса | ✅ + типы кассовых операций из справочника, проводки внесений и изъятий, автоявка сотрудника, приёмка смены в офисе | ⚠️ open/close/X, внесение и изъятие без UI | Справочник кассовых операций, проводки, `cashShiftAcceptances` (одна реализация, с проводкой расхождения), UI внесения и изъятия, история смен, Z-отчёт как сущность |
| Справочники розницы | ✅ `retailSettings`: payment-type, order-type, discount-type, deletion-reason, cash-operation-type; версии и публикация | ❌ | Весь `B:convex/retail.ts` + UI 5 разделов |
| Кухня | ⚠️ тикеты, строгие статусы, без фильтра по ресторану | ⚠️ то же, открывается только из кассы | Отдельный маршрут `/kitchen?restaurant=…`, фильтр по ресторану и станции (`prepArea`), таймеры, звук, bump-back, аудит. **Лучше обоих** |
| Склад | ✅ склады, поставщики, единицы с пересчётом, прайс-листы, остатки на дату, документы (расход, возврат поставщику, инвентаризация, перемещение, списание) с проведением и сторно, приходные накладные с контролем цен | ⚠️ позиции, остатки по ресторану, ручные приход, списание и корректировка | Почти весь домен: `warehouses`, `suppliers`, `units`, `priceLists`, `receipts`, `stockDocuments`, `stockLots`; перевод остатков с «ресторан» на «склад» |
| Производство | ✅ акты приготовления, заготовки, акты переработки, разбора и реализации, внутренние заказы, заказы поставщикам, план кухни, прогноз | ❌ | `B:convex/production.ts`, `productionLogistics.ts` |
| Финансы | ✅ двойная запись, план счетов, статьи ДДС, контрагенты, услуги и обязательства, платежи, выписки, бюджеты, платёжный календарь, приёмка смен | ⚠️ плоский P&L (revenue и expense), ручные расходы | Весь домен. Миграция `ledgerEntries` из плоского вида в двойную запись (§3.9) |
| Персонал | ✅ сотрудники с HR-полями, должности, типы смен, расписание, явка (автоматически из смены), зарплата РК 2026 (ОПВ, ВОСМС, ИПН, СО, СН, ОСМС, ОПВР), мотивация, медкнижки | ⚠️ выдача доступа в POS из iiko, роль, филиалы, сброс PIN | `workforceRecords` + `calculateKzPayroll` + явка из POS. **Сохранить** мост iiko → POS |
| Гости и лояльность | ✅ гости с согласиями, программы, бонусные и депозитные счета, начисление и списание, сторно при возврате, категории, кампании, резервы и банкеты | ⚠️ гость по телефону, начисление 1 балл за 100 ₸, ручная корректировка; **списания нет** | Программы, счета, списание при оплате, сторно при возврате, согласия (закон РК о ПДн), кампании, резервы столов |
| Доставка | ⚠️ заказы доставки, зоны (полигоны), курьеры, GPS, источники, колл-центр; **не закрывает коммерческий заказ** | ❌ | Весь домен + **закрыть разрыв bahandi**: оплата, проводки и списание при `delivered` |
| Курьерское PWA | ⚠️ на телефоне сломано (`min-width:1024px`) | ❌ | Весь экран + мобильная вёрстка + иконки манифеста |
| Отчёты | ⚠️ 190 id, много упрощений; избранное, рассылки (без доставки), CSV, XLSX, PDF | ⚠️ 3 отчёта (продажи, топ блюд, X-отчёты) | Реестр отчётов, `execute`, OLAP по продажам и проводкам, `dailySalesFacts`, экспорт, избранное. Реализовывать честно, а не 190 заглушек (§3.14) |
| Интеграции и платформа | ⚠️ outbox, очередь интеграций (всё кроме `convex-event-bus` уходит в dead-letter), Cloud API с HMAC, вебхуки, карточки 1С, EDI, банка, фискальных сервисов | ❌ | Outbox + очередь + UI очереди интеграций. Cloud API и карточки провайдеров — W3, но обязательно (D4) |
| Аудит | ✅ журнал + UI | ⚠️ пишется, но не читается | `auditLog` query + UI «Журнал событий» |
| iiko | ✅ проекции: stores, terminals, units, suppliers, products, categories, balances, documents, cash shifts, orders, OLAP, сверка | ⚠️ только departments и employees | Новые проекции (только GET): stores, terminals, measureUnits, suppliers, products и groups, balance. Решение D7 для остального |
| Демо-данные | ✅ генератор на 90 дней | ➖ (есть реальные данные) | Не переносить. Для тестов написать компактный seed |

---

## 3. Бэкенд: что добавить в sandyq, по доменам

Общие правила переноса (обязательны для каждого пункта):
- Структура: `S:convex/domains/<domain>/{queries,mutations,internal}.ts`. Общие хелперы — в `S:convex/lib/`.
- Ошибки только через `ConvexError` (коммит `ce73541`).
- Каждая публичная функция вызывает `requireOperator` (POS) или `requireOfficeCapability` + `requireRestaurantScope` (офис). Функций без авторизации нет, кроме явного списка: `posTerminalOptions` и `listCategories` для экрана до входа.
- Схема меняется только совместимо с данными прода: новые поля `v.optional`, переименования через миграции (§10).
- Никаких записей в iiko: все новые iiko-эндпоинты только GET, с allowlist в `sanitizeRecord` (`S:scripts/iiko/`).

### 3.1 Платформа учёта (фундамент, делается первым)

Все следующие домены зависят от этих механизмов.

| Что | Источник в bahandi | Цель в sandyq | Детали |
|---|---|---|---|
| Иммутабельные складские движения со средневзвешенной себестоимостью | `B:convex/stockAccounting.ts` (`applyStockMovement`, `reverseSourceMovements`) | `S:convex/lib/stockAccounting.ts` | Идемпотентность по `externalId`, `balanceAfter`, `averageUnitCostAfter`, `reversalOf`, флаг `allowNegative`. Исправить: пересчёт `balanceAfter` при записи задним числом (§7 B-12) |
| Двойная запись | `B:convex/stockAccounting.ts` (`writeLedgerEntry`), таблица `ledgerEntries` (B:schema 212) | `S:convex/lib/ledger.ts` + новая таблица `journalEntries`, либо миграция `ledgerEntries` (§3.9) | Счета — ссылки на план счетов (`chartOfAccounts.externalId`), а не строки, как в bahandi |
| Закрытие периода | `B:convex/officeAccess.ts:49` `assertPeriodOpen`, таблица `periodLocks` | `S:convex/lib/periods.ts` | Исправить: блокировки уровня организации должны фильтроваться по организации (§7 B-26). Проверять в `checkout` (у bahandi этой проверки нет) |
| Transactional outbox | `appendOutboxEvent`, `outboxEvents`, крон `publishOutboxEvents` | `S:convex/lib/outbox.ts`, `S:convex/domains/integrations/*` | |
| Жизненный цикл доменной записи | `B:convex/domainRecordHelpers.ts` | `S:convex/lib/domainRecords.ts` | Состояния draft → pending-approval → approved → posted → reversed и т. д. Исправить: не использовать `take(1000)` + фильтр в памяти, нужны индексы по `moduleId`/`status`/`restaurant` и пагинация |
| Аудит | `B:auditEvents` (поле `capability`, `details`) | расширить `S:auditEvents` | Добавить индексы `by_resource`, `by_restaurant_occurred`, `by_actor_occurred` и query `auditLog` |
| Бизнес-дата | `B:posHelpers.almatyBusinessDate` | `S:convex/lib/time.ts` | В обоих проектах сдвиг фиксирован +5 и отсечка в полночь. Добавить настраиваемую отсечку (например, 04:00) на уровне ресторана, иначе ночная смена ресторана делится на два дня |

### 3.2 Права и доступ в офисе

| Добавить | Источник | Детали |
|---|---|---|
| Поля `officeUsers.organizationScopes`, `warehouseScopes` | B:schema 171 | `restaurantScopes` уже есть |
| Гранулярные права `office.<module>.<view/edit/post/approve/reverse/cancel>` и `office.guests.pii` | `B:convex/officeAccess.ts:14` | Сейчас в sandyq только `office.<module>.*` (`S:convex/lib/officeAccess.ts`). Формат совместим, миграция не нужна |
| `listAccessControl`, `saveRole`, `saveUser` | `B:convex/office.ts` | Правила: scope редактируемого не шире своего; свою учётку отключить нельзя; у administrator остаётся `*` |
| 6 системных ролей при bootstrap | `B:convex/office.ts:78-83` | restaurant-manager, accountant, warehouse-manager, hr-payroll, loyalty-manager, report-viewer |
| `adminMaintenance.setOfficePassword` | `B:convex/adminMaintenance.ts` | Internal action + скрипт. Плюс восстановление пароля (нет ни в одном проекте) |
| Закрыть дыры sandyq | — | Scope во всех офисных queries: reports, finance, stock, loyalty (сейчас не фильтруются); scope сотрудника в `workforce.setEmployeeActive` и `resetPin` |

### 3.3 Каталог, модификаторы, размеры, цены

**Схема (добавить в `S:convex/schema.ts`):**
- `categories.parentExternalId?`.
- `products`: `imageStorageId?`, `itemType` (dish/good/preparation), `prepArea`, `writeOffMethod` (ingredients/finished-product), `unitWeightKg?`, `markupPercent?`, `customizable`, `sizeScaleId?`, `firstSaleAt?`. Сохранить `nameKk`, `basePrice`, `productPrices`.
- `sizeScales`, `sizeOptions` (B:schema 850-873).
- `modifierGroups`, `modifiers`, `productModifierGroups`, `productModifierRules` (B:schema 874-931).
- `priceOrders`, `priceOrderLines`, `priceSchedules` (B:schema 932-975). Добавить `restaurantExternalIds[]` в `priceOrders`, потому что у sandyq цены зависят от филиала.
- `employeeFavorites` (B:schema 1695).
- `iikoEntityOverlays`: уже есть заготовка (`S:schema 527`, `data: any`). Нужно типизировать по B:schema 598.

**Функции:**
- `catalog.getProductConfiguration` (размеры, группы, правила), `catalog.getProduct` с техкартой, `updateProduct` с overlay для iiko-продуктов, `saveRecipe` (§3.4). Источник: `B:convex/catalog.ts`.
- `files.generateUploadUrl`, `attachProductImage`, `attachModifierImage` (`B:convex/files.ts`) — **с проверкой** `office.nomenclature.edit`.
- `modifiers.*`: `B:convex/modifiers.ts` целиком, с проверкой `office.modifiers.*`. Расчёт цены — `validateAndPriceModifiers` (`B:convex/orders.ts:755`): бесплатные порции по правилу и пулу группы, кухонные метки «БЕЗ X». Добавить реализацию `enforceItemLimits`, которое в bahandi хранится, но не используется.
- `sizeScales.*` (`B:convex/sizeScales.ts`): ровно один размер по умолчанию, коэффициент больше 0.
- `pricing.*` (`B:convex/pricing.ts`) + крон `reconcileStatuses` раз в минуту.
- **Порядок разрешения цены в sandyq** (чего нет ни в одном проекте): overlay → активная строка приказа для этого ресторана и размера (по приоритету: позже `effectiveFrom` — выше, при равенстве решает номер) → `productPrices[restaurant]` → `basePrice` × коэффициент размера. Одна функция `resolvePrice` в `S:convex/lib/pricing.ts`, общая для каталога, заказов, доставки и Cloud API. Сейчас в sandyq `orders.priceLines` дублирует `catalog.resolveProductPrice`, а в bahandi Cloud API и доставка берут голый `product.price`.
- Исправить баги bahandi: при истечении приказа цена не откатывается; порядок пересекающихся приказов недетерминирован; в сиде расписания нет воскресенья (`weekdays [1..7]`); `products.price` перезаписывается при активации. В sandyq **не** мутировать `products`: цена всегда вычисляется.
- `posExperience.favoriteIds`, `favoriteProducts`, `toggleFavorite` (`B:convex/posExperience.ts`).
- Стоп-лист по филиалу. Нет в обоих проектах, при этом в меню Sandyq есть блюда «тек Шымкент қаласында» (`S:public/menu-data/README.md`). Нужна таблица `productAvailability {productId, restaurantExternalId, available, reason}`, а не только `enabled`.

### 3.4 Техкарты и списание по продаже

- Таблицы `recipes` и `recipeLines` (B:schema 821-849). Добавить **версионирование**: `recipeVersions` с `effectiveFrom` и выбором версии на дату продажи. У bahandi одна техкарта без версий, и создать новую нельзя.
- `saveRecipe`: создание и новая версия. Используется UI `RecipeCardEditor` (§4.3).
- `consumeOrderStock` при `checkout` (`B:convex/orders.ts:1000`). Исправить при переносе:
  - учитывать потери cold/hot и `unitWeightKg` (сейчас только во фронтенд-модели `B:src/features/catalog-management/model/recipe-card.ts`);
  - списывать ингредиенты модификаторов;
  - раскрывать вложенные заготовки или списывать заготовку как готовый продукт, по `writeOffMethod`;
  - если у продукта нет ни техкарты, ни складской позиции, не пропускать молча, а писать предупреждение в отчёт «Продажи без техкарты»;
  - склад списания: `terminal.salesWarehouseId`, иначе склад ресторана по умолчанию (флаг `isSalesDefault`), а не поиск «distribution» в `externalId`.
- Проводка себестоимости: Дт «Себестоимость продаж» — Кт «Товары».
- Возврат: сторно движений и себестоимости пропорционально возвращённой доле. У bahandi этого нет (B-9).

### 3.5 Заказы, оплата, смены (POS)

Сохранить из sandyq: `orders` с `tableLabel`, много открытых чеков (`listOpenChecks`), `serviceChargePercent`/`serviceChargeAmount`/`serviceChargeWaived`, OCC через `version`, `hold`/`resume`/`transfer`, `orderDeletionEvents` при отмене.

Добавить из bahandi:

| Что | Источник | Изменения для sandyq |
|---|---|---|
| `orderLines.sizeExternalId`, `modifierSelections[]`, `kitchenModifiers[]` | B:schema 1617 | Цена строки включает модификаторы |
| `orders.orderTypeExternalId/Name`, `discountTypeExternalId/Name`, `retailConfigVersion`, `loyaltyProgramExternalId`, `loyaltyAccrued/Redeemed`, `guestExternalId` | B:schema 1568 | `orderType` расширить до `dine-in \| takeaway \| delivery`. Сервисный сбор брать из настройки типа заказа (`data.serviceChargePercent`, по умолчанию 15 % для dine-in и 0 для takeaway). Сейчас он жёстко 15 % на всё |
| `split` | `B:convex/orders.ts` `split` | Новый чек — held, с тем же `tableLabel` + суффикс |
| Справочник причин удаления в `cancel` | `retailSettings` deletion-reason | `writeOff` ⇒ списание по техкарте + проводка на `expenseAccount`. В bahandi флаг сохраняется, но не исполняется |
| Удаление строки после отправки на кухню (void) с причиной | ❌ в обоих | `orderDeletionEvents` с `orderLineId` уже есть в схеме. Нужна мутация `voidLine` с менеджером и списанием |
| **Отправка на кухню до оплаты** («Отправить на кухню», курсы) | ❌ в обоих: тикет создаётся только при `checkout` | Для ресторана это обязательно. Мутация `sendToKitchen(orderId, lineIds?)` создаёт `kitchenTickets` на новые строки. `checkout` больше не создаёт тикет для уже отправленных строк |
| Типы оплат из справочника | `B:convex/orders.ts` checkout + `retailSettings` payment-type | `payments.paymentTypeExternalId/Name`. Проводка на каждую оплату. Проверка `combinable`, `allowsChange` |
| Проводки оплаты и возврата | `B:convex/orders.ts` checkout и refund | Исправить B-18: при возврате брать `data.account` типа оплаты, а не его название |
| Лояльность при checkout и refund | `B:convex/loyaltyCore.ts` | §3.11 |
| `orders.list` для истории (есть в sandyq, не используется) | — | Подключить в UI истории |
| `retail.activeForPos` | `B:convex/retail.ts` | Опубликованные справочники для ресторана терминала |
| Кассовые операции из справочника + проводки | `B:convex/shifts.ts` `recordCashMovement` | Сейчас в sandyq типов нет (комментарий `S:convex/domains/shifts/mutations.ts:61`) |
| Автоявка сотрудника при open/close смены | `B:convex/shifts.ts` | Пишется в `workforceRecords` attendance (§3.10) |
| `shifts.availableTransferTargets` | `B:convex/shifts.ts` | Для UI переноса чека |
| **Z-отчёт как сущность** | ❌ в обоих | Таблица `zReports` (снимок как у `xReports`) при `close`. Сейчас есть только номер. `S:docs/03-ARCHITECTURE.md:101` утверждает обратное — поправить документ |
| Приёмка смены в офисе | `B:convex/finance.ts` `acceptShift` (с проводкой) и `B:convex/retail.ts` `acceptShift` (без проводки) | Сделать **одну** функцию с проводкой расхождения и пересчётом суммы, а не `countedCash ?? expectedCash`. Таблица `cashShiftAcceptances` |
| Уведомления терминала | `B:convex/posExperience.ts`, таблица `posNotifications` | |
| Округление скидки в X-отчёте | баг sandyq | `buildXReportSnapshot` должен суммировать фактически округлённые скидки заказов |
| Баллы лояльности при возврате | баг sandyq | Сторно пропорционально |
| `salesSummary` без вычета возвратов | баг sandyq | Будет перекрыт отчётами из §3.14 |

### 3.6 Справочники розницы (`retailSettings`)

Перенести `B:convex/retail.ts` целиком:
- Таблица `retailSettings` (B:schema 475) с версиями, `status` draft/published/expired, `effectiveFrom/To`, `restaurantExternalIds`.
- Виды и валидация `validateSettingData` (`B:convex/retail.ts:398`):
  - payment-type: `processorKind` (cash/card/qr), `account`, флаги fiscal/revenue/manualEntry/externalAcceptance/combinable/allowsChange/opensCashDrawer;
  - order-type: `serviceMode`, `promptStage`, `isDefault` + **новое поле `serviceChargePercent`**;
  - discount-type: `mode` (percent/fixed/markup/service), `value`, `minimumOrder`, `priority`, `managerApprovalAbove` (**фронт bahandi игнорирует это поле, порог 10 % захардкожен, нужно исправить**), manual, automatic, combinable. Режим «fixed» (скидка суммой) реализовать в `saveDraft`, сейчас его нет;
  - deletion-reason: `expenseAccount`, `writeOff`, `requireComment`, `requireManager`;
  - cash-operation-type: `direction`, `cashAccount`, `correspondingAccount`, `cashflowCategory`, `maximumAmount`, `requireManager`.
- `listOrders` и `listShifts` для офиса. Слияние с `iikoOrders` и `iikoCashShifts` — после решения D7.
- Seed: создать опубликованные по умолчанию «Наличные», «Карта», «Kaspi QR»; «В зале» (15 %) и «С собой» (0 %); причины удаления; «Внесение размена», «Инкассация».
- Исправить баг генератора bahandi B-28 (`direction:"out"` вместо `cash-out`) — в sandyq писать seed по валидатору.

### 3.7 Кухня

Лучше, чем в обоих проектах:
- `kitchenTickets.restaurantId` + индекс `by_restaurant_status_created`. Сейчас доска и `setStatus` не изолированы по ресторану ни в одном проекте.
- `kitchenTicketLines.prepArea`. Станции берутся из `products.prepArea` (горячий цех, холодный, бар, выпечка).
- `source`: pos | delivery | kiosk (у sandyq только `"pos"`).
- `bundleComponents`, `instructions` (модификаторы «БЕЗ X»).
- Статусы: queued → preparing → ready → completed, плюс **bump-back** (на шаг назад, с аудитом) и `cancelled` при void или отмене.
- Время: `startedAt`, `readyAt`, для таймеров и отчётов «Время приготовления».
- Доступ: отдельная PIN-роль `kitchen` (или operator на кухонном терминале), чтобы кухня не открывалась через офис (как у bahandi) или из кассы (как у sandyq).
- Синхронизация со статусом доставки: `ready` → `deliveryOrders.cooked`.

### 3.8 Склад, закупки, производство

**Склад** (`B:convex/stock.ts`, `inventory.ts`):
- Таблицы: `warehouses`, `suppliers` (БИН из 12 цифр, политика отклонения цен), `units` (размерность, коэффициент), `priceLists`, `priceListLines`, `stockLots`, `receipts`, `receiptLines`, `stockDocuments`, `stockDocumentLines`.
- **Миграция sandyq:** `stockBalances` и `stockMovements` сейчас привязаны к `restaurantExternalId`. Нужно создать по одному складу на ресторан (`<restaurant>-main`) и перенести остатки и движения на `warehouseId` (§10 M-3). `inventoryItems` расширить (`unitExternalId`, `maximumStock`, `shelfLifeHours`), добавить update и деактивацию (сейчас их нет).
- Функции: `references`, группы, склады, поставщики, единицы, прайс-листы, `listBalances` (на дату), `listDocuments`/`getDocument`/`createDocument`/`saveDocument`/`postDocument`/`reverseDocument`; приход `createReceiptDraft`/`saveReceipt`/`postReceipt` с `receiptPriceChecks`.
- Исправить баги bahandi:
  - B-16: у инвентаризации знак излишка не влияет на проводку (излишек — Дт «Товары» Кт «Инвентаризационные расхождения»); перемещение удваивает сумму проводки;
  - нет сторно прихода — добавить `reverseReceipt`;
  - приход не создаёт обязательство перед поставщиком — создавать `accounts-payable`;
  - НДС не выделяется — отдельная проводка НДС к зачёту, если поставщик плательщик НДС;
  - `reverseDocument` без проверки scope.
- Уже есть в sandyq: ручные `receiveStock`, `writeOffStock`, `adjustStock`. Заменить документами: приход, акт списания, инвентаризация. Старые мутации оставить на время миграции, потом удалить.
- Отчёт «ниже минимума»: флаги `belowMinimum`, `aboveMaximum`, `negative` в `listBalances`.

**Производство** (`B:convex/production.ts`, `productionLogistics.ts`):
- Таблицы: `productionItems`, `productionMaterials`, `productionRecipes`, `productionActs`, `productionActLines`, `productionRecords` (processing-acts, assembly-acts, sales-acts, purchase-orders, internal-orders, kitchen-plan, semi-finished-sheet).
- `postAct` с двухшаговым подтверждением нехватки, `reverseAct`.
- Исправить: стоимость в снимке брать из средней себестоимости склада, а не из статичного `productionMaterials.unitCost`, иначе проводка расходится с движениями (B-17). Лучше объединить `productionRecipes` с `recipes` (заготовка — это продукт `itemType: preparation` с техкартой), чтобы не держать две модели рецептов.
- Заказ поставщику → «Создать приходную накладную» (в bahandi не связано).
- `kitchenForecast`: использовать время Алматы, а не `getHours()` сервера.

### 3.9 Финансы

- **Миграция M-4:** текущие `S:ledgerEntries` (kind revenue/expense, category, amount) перевести в двойную запись:
  - revenue «Продажи» → Дт «Денежные средства (тип оплаты)» Кт «Выручка»;
  - expense «Возврат» → Дт «Возвраты продаж» Кт «Денежные средства»;
  - expense «Закупка сырья» → Дт «Товары» Кт «Расчёты с поставщиками»;
  - ручные расходы → Дт «Расходы: <статья>» Кт «Денежные средства».
  
  Рекомендация: новая таблица `journalEntries` (B-формат + ссылка на план счетов), старую пометить legacy и сохранить только для чтения.
- `financeRecords` и модули (`B:convex/finance.ts`): cashflow-categories, chart-of-accounts, transactions, shift-acceptance, services (+ обязательства), counterparties, accounts-payable, payments (с распределением на обязательства), bank-statements (`importStatement`), payment-calendar, budgets.
- `finance.overview`. Исправить: `debitTotal` и `creditTotal` считаются одинаково.
- Seed плана счетов РК: минимальный набор счетов, на которые ссылаются проводки из §3.4, §3.5, §3.8, §3.10.
- Сопоставление выписки с платежами (нет в bahandi) — во вторую волну.

### 3.10 Персонал и зарплата

- `employees`: добавить HR-поля (`personnelNumber`, `phone`, `email`, `iin`, `positionExternalId`, `employmentDate`, `payType`, `baseRate`) как optional. **Сохранить** мост `iikoEmployeeExternalId` и `provisionPosAccess`.
- `workforceRecords`: employees, positions, shift-types, schedule (проверка пересечений), attendance, payroll (`statutory-rule`, `payroll-run`), motivation, medical-records.
- `calculateKzPayroll` (`B:convex/workforce.ts:173`) — перенести с тестами из `B:convex/expandedOfficeOperations.test.ts`. Исправить: `reversePayroll` должен сторнировать налоги работодателя; удержания сотрудника выделить в отдельные обязательства; добавить выплату зарплаты.
- `clockIn` и `clockOut` из POS, автоявка при смене.
- Исправить разрыв sandyq: PIN-пад POS ограничен 6 цифрами, а выдача разрешает 4–12. Выбрать одно правило: 4–6 цифр на сервере.
- Создание POS-сотрудника без iiko (сейчас только через seed).

### 3.11 Гости и лояльность

- `loyaltyRecords` (guests с согласиями, loyalty-programs, guest-categories, campaigns, reservations), `loyaltyAccounts` (bonus/deposit, balance, reserved), `loyaltyTransactions` (accrual, redemption, reservation, release, expiration, adjustment, reversal).
- **Миграция M-5:** `S:guests` (phone, points) → гости и счёт в программе «Базовая» с `balance = points`. `S:loyaltyTransactions` → транзакции с `accountId`.
- `quoteLoyalty`, `applyOrderLoyalty`, `reverseOrderLoyalty` (`B:convex/loyaltyCore.ts`). Исправить:
  - программа выбирается по ресторану, а не «первая опубликованная»;
  - частичное списание (UI bahandi позволяет только максимум);
  - `reserved` и `expiration` не заполняются — реализовать сгорание по сроку.
- Проводка списания бонусов: Дт «Обязательства по программе лояльности» Кт «Выручка». Начисление — оценочное обязательство (решение бухгалтера).
- Согласия (append-only журнал, `validUntil`) — требование закона РК о ПДн. Маскирование ПДн без `office.guests.pii`.
- Кампании: `enqueueCampaign` с тихими часами. Реальной отправки нет (провайдер SMS или email — вторая волна).
- Резервы и банкеты: связать с сайтом (секция «Банкеты» на `/restaurant` в `website/`) и с бронью из skill (`patterns.md` §10). Схема зала — вторая волна.

### 3.12 Доставка и курьеры

- Таблицы `deliveryOrders`, `deliveryZones`, `couriers`, `courierLocations`, `deliverySources`, `telephonyCalls` (B:schema 347-451) и `B:convex/delivery.ts`, `deliveryCore.ts`.
- **Закрыть главный разрыв bahandi (B-8):** на `delivered` или `closed` проводить оплату коммерческого заказа (тип оплаты доставки: наличные курьеру, карта онлайн, оплата агрегатором), делать проводки, списание по техкарте и начисление лояльности. Повторно использовать `checkout`-ядро (`lib/checkoutCore.ts`), а не дублировать его.
- Цены в `saveOrder` и `ingestDeliveryOrder` брать через `resolvePrice` (§3.3), а не `product.price`.
- Учитывать `cookingMinutes` зоны и `commissionPercent` источника (проводка комиссии агрегатора).
- Курьеры: поиск по индексу `by_employee_code`, а не `take(500).find`.
- Телефония: перенести журнал звонков и карточку провайдера как в bahandi (`office/63-telephony.jpg`); реальный провайдер подключается адаптером в W3 (D4).

### 3.13 Интеграции, Cloud API, платформа

- `integrationJobs` + крон `processIntegrationJobs`, `outboxEvents` + крон `publishOutboxEvents`, `listIntegrationJobs`/`retry`/`cancel` (`B:convex/office.ts`).
- `platformRecords` (`B:convex/platformOperations.ts`): organizations, restaurants, terminals (upsert в канонические таблицы), document-locks → `periodLocks`, print-templates, equipment, system-settings, карточки integration-*.
- Cloud API (`B:convex/http.ts`, `cloudApi.ts`, HMAC-SHA256, ±5 мин) — вторая волна. Меню с ценами через `resolvePrice` и модификаторами. Киоск — третья волна; авторизацию делать HMAC, а не открытым секретом в аргументе (B-3).
- Адаптеры провайдеров (1С, банк, фискальные сервисы, SMS) — отдельные проекты. Пока карточки конфигурации и dead-letter, как в bahandi.
- **Не переносить:** `office.officeRecords` / `GenericOfficeWorkspace` (устаревший реестр), `orders.legacy*` (мёртвый код без авторизации), дубли `requireCapability` в `office.ts` и `reports.ts`.

### 3.14 Отчёты

- Инфраструктура: `reportViews`, `reportSchedules` (крон `dispatchSchedules`), `reportRegistry` (`B:convex/reportRegistry.ts`), `reports.execute`/`coverage`/`drillDown`.
- **Предагрегаты:** `dailySalesFacts` (B:schema 102) в bahandi заполняет только генератор. В sandyq нужно заполнять из `checkout`, `refund` и `cancel` (инкрементально) или ночным кроном. Иначе полные сканы `collect()` упрутся в лимиты Convex. Это уже проблема sandyq (`S:convex/domains/reports/queries.ts` `salesSummary`).
- **Объём — все 190 отчётов bahandi** (паритет, D4). Каталог, названия и семейства переносятся 1:1 из `B:src/features/office-platform/model/reports.ts`, но каждый отчёт реализуется честно: упрощения и пустые отчёты из §7 B-23 исправляются, а не копируются. Пока отчёт не реализован, в каталоге у него статус «в разработке», а не заглушка с нулями. Порядок: W1 — ≈25 ключевых отчётов (список ниже), W2 — продажи, склад, меню и финансы целиком, W3 — остальные семейства (персонал, производство, доставка, лояльность, сеть, интеграции). Ключевые отчёты W1:
  - продажи: по дням, по часам, по блюдам, по категориям, по официантам и кассирам, по типам оплат, по типам заказов, чеки, средний чек, возвраты, удаления и отмены, скидки, **сервисный сбор**, смены X и Z, внесения и изъятия;
  - склад: остатки, движение товара, ниже минимума, закупки, списания по причинам, инвентаризационные расхождения;
  - меню: себестоимость и фудкост, маржинальность;
  - финансы: P&L, ДДС, журнал проводок, приёмка смен;
  - персонал: табель, зарплата;
  - лояльность: начисления и списания.
  
  Остальные id добавлять по мере реализации, без заглушек в каталоге.
- Экспорт: CSV (BOM, `;`) и XLSX на клиенте (`B:src/features/office-platform/ui/reports-workspace.tsx`), PDF через печать.
- Drill-down: в bahandi заявлен (`B:docs/iiko-office-coverage.md`), но в UI отсутствует. Реализовать клик по строке → список документов.

### 3.15 iiko (только GET)

- Сохранить `S:scripts/iiko/*` и правило «никогда не пишем в iiko».
- Добавить проекции по примеру `B:convex/iikoImport.ts` `applyStagedRecord`:

  | Эндпоинт iiko | Проекция в sandyq |
  |---|---|
  | stores | `warehouses` |
  | terminals | `posTerminals` (с анонимными терминалами аккуратно; `terminalNumber` не по хешу) |
  | measureUnits | `units` |
  | suppliers | `suppliers` |
  | products + groups | `products`, `categories` + `inventoryItems` через `iikoEntityOverlays` |
  | balance/stores | `stockBalances` (начальные остатки) |

  Для каждого — allowlist в `sanitizeRecord` и запись в `endpoint-registry.mjs`.
- Техкарты (assemblyCharts) и цены (`/v2/price`) — проекции, которых нет и в bahandi (`B:plans/recipes.md`, `plans/pricing.md`). Сделать во второй волне.
- Закрыть дыры sandyq: `iiko.mutations.saveOverlay` без авторизации, `importRun`/`endpointStates`/`mirrorCounts` без авторизации. Их нужно перевести в internal и `office.data-exchange.view`.
- `resolveDepartmentExternalId`: при неудаче выдавать ошибку, а не брать первый попавшийся (B-24).

---

## 4. Фронтенд: что добавить в sandyq

Общая архитектура фронтенда:
- **Роутинг:** в sandyq сейчас раздел офиса хранится в `useState` (`S:src/office/router.tsx:20`), из-за чего нет deep-link и F5 сбрасывает раздел. Нужен настоящий роутер (react-router или самописный `pushState`, как в bahandi `B:src/App.tsx:59-63`). Рекомендация: `react-router`, маршруты `/pos`, `/kitchen`, `/courier`, `/office/:section/:id?`.
- **Структура:** сохранить разделение sandyq `src/pos`, `src/office`, `src/shared`. Добавить `src/kitchen`, `src/courier`. Фичи bahandi (`B:src/features/*`) переносить в `src/office/features/*` и `src/pos/features/*`.
- **Слой данных:** хуки поверх `api.domains.<d>.<queries|mutations>.<fn>`. Пути API в bahandi плоские (`api.orders.saveDraft`), поэтому каждый хук переписывается. Никаких `(api as any)` (в bahandi так сделаны iiko, delivery и domain).
- **Общие примитивы, которых нет ни в одном проекте:** Input, Select, Combobox, Checkbox, Switch, Tabs, Table (с пагинацией), EmptyState, Skeleton, Toast, Tooltip, DatePicker, MoneyInput, PageHeader, Breadcrumb, StatusPill. В bahandi `Field` продублирован в 7 файлах с разными стилями. Спецификации — `POS-DESIGN.md` §5.
- **Адаптив:** убрать `body { min-width:1024px; overflow:hidden }` (`S:src/shared/styles/index.css:45-54`). Для POS ограничение ширины задать на уровне layout POS, для офиса — отдельный скролл, курьер — mobile-first.

### 4.1 POS (касса)

Уже есть в sandyq и остаётся: выбор филиала, вход по коду и PIN, открытие и закрытие смены, X-отчёт, открытые чеки (столы), каталог, карточка блюда, панель заказа с сервисным сбором, скидка, оплата со сплитом, гость, подтверждение менеджера, автоблокировка.

Добавить (файлы-источники в bahandi):

| Функция | Источник | Примечания для sandyq |
|---|---|---|
| Выбор терминала с бэкенда (подразделение → терминал) | `B:src/features/pos-operations/ui/terminal-picker.tsx` | Вместо захардкоженного списка `S:src/pos/features/session/ui/branch-picker.tsx:5-9` |
| Ввод кода и PIN с физической клавиатуры, Enter | ❌ в обоих | |
| Шапка: смена и часы, связь, уведомления, профиль | `B:src/components/pos/app-header.tsx` | Бренд Sandyq, не «Bahandi · Абая» (у bahandi захардкожено, :40) |
| Офлайн-баннер и локальный черновик | `B:src/features/pos-operations/model/use-order-draft.ts` (localStorage, 280 мс, `saveChain`, `draftGeneration`, `retiredOrderIds`) | Адаптировать под много чеков: ключ `…:<terminal>:<clientOrderId>` |
| Каталог: фото, избранное, «Популярное», сортировка, история | `B:src/components/pos/product-catalog.tsx`, `product-card.tsx` | Фото из storage или `public/images`. Казахское название на карточке оставить |
| **Диалог модификаторов и размеров** | `B:src/components/pos/modifier-dialog.tsx` | Добавить клиентскую проверку минимума группы (у bahandi её нет) |
| Тип заказа (В зале / С собой / Доставка) | `B:src/components/pos/order-panel.tsx:119` | Из справочника order-type. Сервисный сбор по типу |
| Строки с размером и модификаторами, фото 44 px | `B:order-panel.tsx` | Кнопки −/+ не меньше 44 px (у bahandi 24 px) |
| Допродажа («Добавить к заказу») | `B:order-panel.tsx:179`, `api.orders.suggestion` | Авторизовать `suggestion` |
| Панель действий: Скидка, Гость, Комментарий, Ещё | `B:order-panel.tsx:198` | Комментарий сейчас без UI (`S:use-order-draft.ts` возвращает `setComment`) |
| **Номер стола без `window.prompt`** | ❌ | Диалог «Новый стол»: номер, зал, количество гостей. Позже схема зала (§3.11) |
| **Отправить на кухню** | ❌ | Кнопка в панели заказа, отметка «отправлено» у строк (§3.5) |
| Действия с заказом: разделить, перенести, предчек, отменить с причиной | `B:src/features/pos-operations/ui/order-dialogs.tsx` `OrderActionsDialog` | Перенос между терминалами одного ресторана, плюс **перенос между столами** на одном терминале (новое) |
| История заказов, продолжить, возврат | `B:order-dialogs.tsx` `HistoryDialog` | В sandyq `orders.list` и `refund` есть на бэке, UI нет |
| Главное меню кассы | `B:order-dialogs.tsx` `MainMenuDialog` | «Новый заказ» должен реально создавать чек (у bahandi это toast-заглушка) |
| Оплата из справочника типов, пресеты сдачи, печать чека | `B:src/components/pos/payment-dialog.tsx`, `model/order-receipt.ts` | Оставить сплит sandyq на N частей (у bahandi только 2 и без сдачи). Исправить подпись «+500», которая на деле округляет (S:payment-dialog.tsx:111-114). Добавить экран успешной оплаты и чек |
| Лояльность: поиск, quote, списание | `B:src/features/pos-operations/ui/loyalty-dialog.tsx` | Частичное списание (поле суммы) |
| Смена: табы «Текущая / Внести-изъять / Закрыть», история смен, печать X и Z | `B:src/features/pos-operations/ui/shift-dialog.tsx`, `model/x-report.ts` | Z печатать нормальной формой, а не `JSON.stringify` (B:shift-dialog.tsx:576-589). Исправить баг sandyq с `countedCash = 0` (S:shift-dialog.tsx:65) |
| Уведомления, профиль | `B:order-dialogs.tsx` | |
| Явка (clock-in/out) | `B:convex/workforce.ts` clockIn/Out | Кнопка в профиле |
| Горячие клавиши, сканер штрихкодов | ❌ | Вторая волна |

### 4.2 Кухня (отдельная поверхность `/kitchen`)

- Источник: `S:src/pos/features/kitchen-display/ui/kitchen-board.tsx` и `B:src/features/pos-operations/ui/kitchen-workspace.tsx`.
- Полноэкранный режим без шапки кассы. Вход PIN-ом роли kitchen или по токену устройства.
- Фильтр по станции (`prepArea`), колонки по статусам, таймер ожидания с порогами цвета, звук на новый тикет, модификаторы «БЕЗ X» как чипы, bump-back, «Выдан» с журналом последних 20 выданных.
- Экран прибора крупный: номер заказа не меньше 32 px, строки не меньше 18 px, кнопки не меньше 56 px (кухонный экран смотрят с расстояния).

### 4.3 Офис: разделы

В sandyq сейчас 6 разделов:
- «Меню и цены» (`S:src/office/features/catalog`);
- «Склад»;
- «Финансы»;
- «Кадры»;
- «Лояльность»;
- «Отчёты».

В bahandi 91 раздел (`B:src/features/office-platform/model/navigation.ts`). Ниже целевая навигация Sandyq с волнами (W1/W2/W3, см. §9) и источником.

| Группа | Раздел (id) | Волна | Источник UI в bahandi | Что есть в sandyq |
|---|---|---|---|---|
| Главная | dashboard | W1 | `office-platform/ui/office-dashboard.tsx` | ❌ |
| | favorites | W3 | (в bahandi копия дашборда) | ❌ — сделать настоящее избранное разделов |
| Розничные продажи | orders | W1 | `retail-management/ui/retail-workspace.tsx` OrdersWorkspace | ❌ |
| | cash-shifts | W1 | RetailWorkspace CashShiftsWorkspace | ⚠️ X-отчёты в «Отчётах» |
| | payment-types, order-types, discount-types, deletion-reasons | W1 | RetailSettingsWorkspace | ❌ |
| | cash-operations | W1 | CashOperationsWorkspace | ❌ |
| Товары и склады | nomenclature | W1 | `catalog-management/ui/nomenclature-workspace.tsx` + `components/backoffice/product-editor.tsx` (6 табов) + `recipe-card-editor.tsx` | ⚠️ «Меню и цены» — перенести KZ-поле и цены по филиалам в ProductEditor |
| | product-groups | W1 | `stock-management/ui/stock-workspace.tsx` | ⚠️ категории |
| | modifiers | W1 | `modifier-management/ui/*` | ❌ |
| | size-scales | W1 | `size-scales/ui/size-scales-workspace.tsx` | ❌ |
| | price-orders | W1 | `pricing-management/ui/price-orders-workspace.tsx` | ❌ |
| | price-lists | W2 | StockWorkspace PriceListsWorkspace | ❌ |
| | warehouses, suppliers, units | W1 | StockWorkspace | ❌ |
| | stock (остатки) | W1 | BalancesWorkspace | ⚠️ матрица «товар × филиал» |
| | receipts | W1 | `inventory-costing/ui/receipts-workspace.tsx`, `receiving-workspace.tsx`, `costing-explainer.tsx` | ⚠️ ручной «Приход» |
| | outgoing-invoices, supplier-returns, inventories, transfers, writeoffs | W1 (inventories, writeoffs, transfers), W2 (остальное) | StockWorkspace DocumentsWorkspace | ⚠️ «Списать», «Инв.» в ячейке |
| Производство | production (акты приготовления) | W2 | `production-accounting/ui/*` | ❌ |
| | processing-acts, assembly-acts, sales-acts, purchase-orders, internal-orders | W2 | ProductionLogisticsWorkspace (DomainWorkspace) | ❌ |
| | kitchen-plan, semi-finished-sheet | W3 | + ForecastPanel | ❌ |
| | kitchen-board | W1 | → отдельная поверхность `/kitchen` (§4.2) | ⚠️ внутри кассы |
| Финансы | chart-of-accounts, cashflow-categories, counterparties | W1 | FinanceWorkspace (DomainWorkspace) | ❌ |
| | transactions | W1 | + FinanceOverview | ⚠️ плоский журнал |
| | shift-acceptance | W1 | + ShiftAcceptancePanel | ❌ |
| | services, accounts-payable, payments | W2 | FinanceWorkspace | ⚠️ «Добавить расход» |
| | bank-statements, payment-calendar, budgets | W3 | + BankImportPanel | ❌ |
| Сотрудники | employees | W1 | WorkforceWorkspace | ⚠️ «Кадры» — сохранить вкладку «Из iiko» и выдачу PIN |
| | positions, shift-types, schedule, attendance | W2 | + SchedulePanel | ❌ — расписание сделать календарём (в bahandi карточки) |
| | payroll | W2 | + PayrollPanel | ❌ |
| | motivation, medical-records | W3 | + ExpiryPanel | ❌ |
| Гости и лояльность | guests | W1 | LoyaltyWorkspace | ⚠️ список гостей и корректировка |
| | loyalty-programs, guest-categories | W1 | LoyaltyWorkspace | ❌ |
| | campaigns | W3 | | ❌ |
| | reservations (банкеты и резервы) | W2 | | ❌ — добавить схему зала |
| Доставка | delivery-orders, call-center | W2 | `delivery-management/ui/delivery-workspace.tsx` | ❌ |
| | delivery-zones | W2 | ZonesWorkspace | ❌ — полигон на карте, а не текстом |
| | couriers, delivery-sources | W2 | | ❌ |
| | telephony | W3 | TelephonyWorkspace | ❌ — журнал звонков как `office/63-telephony.jpg` + адаптер провайдера |
| Корпорация | organizations, restaurants, departments | W2 | CorporationWorkspace | ❌ |
| | document-locks (закрытие периода) | W1 | | ❌ |
| | data-exchange (паритет iiko) | W1 | `office-platform/ui/iiko-integration-workspace.tsx` | ❌ — прогоны импорта, матрица эндпоинтов |
| Обмен | integration-1c, -bank, -fiscal, -loyalty, -messaging, -maps, -cloud-api, external-menu, -edi | W3 | ExchangeWorkspace | ❌ |
| | integration-egais | W3 | ExchangeWorkspace | ❌ — перенести как в bahandi: экран «Недоступно для KZ» |
| Администрирование | users, roles | W1 | `office-platform/ui/access-control-workspace.tsx` | ❌ |
| | terminals | W1 | AdministrationWorkspace | ❌ |
| | equipment, print-templates, system-settings | W3 | | ❌ — шаблоны печати с превью |
| | audit-log | W1 | `enterprise-platform/ui/enterprise-workspaces.tsx:59` | ❌ |
| | integration-jobs | W2 | `office-platform/ui/integration-jobs-workspace.tsx` | ❌ |
| Отчёты | reports, report-favorites, report-schedules | W1 (каталог, вьюер, экспорт), W2 (рассылки) | `office-platform/ui/reports-workspace.tsx` | ⚠️ 2 вкладки |

**Общий движок форм `DomainWorkspace`** (`B:src/features/domain-operations/ui/domain-workspace.tsx`). В bahandi на нём держится около 53 разделов. Перенести как основу для справочников (master/publish/approval/document lifecycle), но добавить:
- пагинацию;
- типизированные хуки вместо `(api as any)[domain]`;
- серверную нумерацию (в bahandi номер генерируется на клиенте);
- специализированные экраны там, где форма не подходит: расписание (календарь), зоны (карта), банкеты (схема зала), шаблоны печати (превью).

**Оболочка офиса** (`B:src/components/backoffice/backoffice-layout.tsx`, `office-page.tsx`):
- сайдбар с поиском и сворачиваемыми группами, фильтром по правам и `localStorage` раскрытия;
- хлебные крошки, `OfficePageHeader`, `WorkspaceTabs`, `RegisterToolbar`, `StatusPill` (добавить тон «ошибка», которого нет), `RegisterLoadMore`;
- переключатель темы (в офисе sandyq его нет);
- шапка офиса **без** POS-кнопок (в bahandi шапка офиса показывает «Касса №1» и «Смена закрыта», а все кнопки дают toast).

**Исправить в текущем офисе sandyq:**
- layout без ограниченной высоты: длинные таблицы не скроллятся (`S:src/office/components/office-layout.tsx:31`);
- формат дат: использовать `S:src/shared/lib/almaty-time.ts` вместо inline `toLocaleString` (loyalty :128, stock :152);
- `OfficeAccessDenied` не используется;
- регистрация открыта всем (оставить, но с понятным экраном «нет доступа»).

### 4.4 Курьер (`/courier`, PWA)

- Источник: `B:src/features/delivery-management/ui/courier-pwa.tsx`, `B:public/manifest.webmanifest`, `B:public/sw.js`.
- Исправить: mobile-first вёрстка (без `min-width:1024px`); `icons` в манифесте (из `S:public/branding/sandyq-group-favicon-140.webp` сгенерировать 192 и 512 px); телефон гостя — ссылка `tel:`; service worker только со scope `/courier/` и без кэширования всех GET origin; автоблокировка курьера не 5 минут, а по смене.
- Экран: смена (offline/available), GPS, «Мои доставки» (адрес, время, гость, маршрут, переход статуса), оплата наличными у двери (§3.12).

---

## 5. Что в sandyq уже сделано лучше: сохранить

1. **Много открытых чеков на терминал** (`S:convex/domains/orders/queries.ts` `listOpenChecks`, `S:src/pos/features/order-taking/ui/open-checks-list.tsx`). У bahandi запрещён второй черновик на терминал.
2. **Сервисный сбор 15 %** со снятием через менеджера (`S:convex/lib/money.ts`, `policy.ts`) и строка «Қызмет ақысы · сервисный сбор 15%» в панели заказа.
3. **Двуязычный каталог** (`products.nameKk`) и **цены по филиалам** (`productPrices`).
4. **Доменная структура** `convex/domains/*` и `lib/*` вместо 45 плоских модулей.
5. **Авторизация офисных мутаций каталога.** У bahandi мутации `catalog`, `files`, `modifiers`, `sizeScales`, `pricing` вообще без проверки.
6. **Ограничение выбора филиала на старте** и реальные данные iiko Sandyq.
7. **Правило ConvexError** для немаскированных ошибок в проде.
8. **Идемпотентность и OCC** (`checkoutIdempotencyKey`, `version`) — в обоих проектах, сохранить.
9. **Тесты POS-потоков** `S:convex/posFlows.test.ts` — расширить, а не заменять.
10. **Скрипты безопасности:** `S:scripts/rotate-ci-deploy-key.sh`, seed без PIN на проде.

---

## 6. Известные баги и дыры sandyq (исправить в W0)

| # | Где | Что |
|---|---|---|
| S-1 | `S:convex/domains/iiko/mutations.ts` `saveOverlay` | Публичная мутация без авторизации (`data: any`) |
| S-2 | `S:convex/domains/iiko/queries.ts` | `importRun`, `endpointStates`, `mirrorCounts` без авторизации |
| S-3 | `S:convex/domains/auth/mutations.ts` `revoke` | Без POS-авторизации |
| S-4 | `S:convex/domains/catalog/queries.ts` | `listProducts`, `getProduct` без авторизации, принимают любой ресторан |
| S-5 | `S:convex/domains/kitchen/*` | Доска и `setStatus` видят все рестораны, без аудита |
| S-6 | `S:convex/domains/{reports,finance,stock,loyalty}/queries.ts` | Нет фильтра `restaurantScopes` |
| S-7 | `S:convex/domains/workforce/mutations.ts` | `setEmployeeActive`, `resetPin` без scope сотрудника |
| S-8 | `S:convex/domains/orders/mutations.ts` refund | Не сторнирует баллы |
| S-9 | `S:convex/domains/reports/queries.ts` salesSummary | Выручка без вычета возвратов; полный скан + N+1 |
| S-10 | `S:convex/domains/shifts/*` `buildXReportSnapshot` | Скидки не округляются |
| S-11 | `S:convex/domains/finance/mutations.ts` backfillFromPayments | Теряет сплит-платежи |
| S-12 | `S:src/pos/features/shifts/ui/shift-dialog.tsx:65` | `countedCash` инициализируется нулём |
| S-13 | `S:src/pos/features/order-taking/ui/discount-dialog.tsx:22` | Устаревший процент скидки |
| S-14 | `S:src/pos/features/session/ui/login-screen.tsx:34` | PIN до 6 цифр при выдаче 4–12 |
| S-15 | `S:src/pos/features/checkout/ui/payment-dialog.tsx:111-114` | «+500» на деле округляет |
| S-16 | `S:src/shared/styles/theme.css` night | Не переопределены destructive, success, warning (контраст 1.33:1) |
| S-17 | POS-инпуты | `outline-none` без замены: нет видимого фокуса |
| S-18 | `S:src/office/components/office-layout.tsx:31` | Таблицы офиса не скроллятся |
| S-19 | `S:src/shared/styles/index.css:45-54` | `min-width:1024px; overflow:hidden` |
| S-20 | `S:docs/03-ARCHITECTURE.md` :95, :101, :155, :161, :418, :420 | Расходится с кодом (orderDeletionEvents пишется; снимок Z не создаётся; revoke без авторизации; listCategories без авторизации; bare root больше не падает) |
| S-21 | `S:src/pos/features/loyalty/ui/guest-dialog.tsx:45-53` | Ошибка detach не ловится |
| S-22 | `S:src/pos/features/checkout/ui/payment-dialog.tsx:70` | `key={index}` у строк оплаты |

## 7. Баги bahandi, которые нельзя переносить как есть

| # | Где (B:) | Что | Как делать в sandyq |
|---|---|---|---|
| B-1 | `catalog.ts`, `files.ts`, `modifiers.ts`, `sizeScales.ts`, `pricing.ts`, `orders.legacy*`, `orders.suggestion` | Нет авторизации, в том числе у мутаций | `requireOfficeCapability` / `requireOperator` |
| B-2 | `stock.reverseDocument` | Без scope | scope ресторана и склада |
| B-3 | `orders.kioskComplete` | Открытый секрет в аргументе | HMAC, как в Cloud API |
| B-8 | `delivery.transitionOrder` | delivered/closed не оплачивают заказ | общее ядро checkout |
| B-9 | `orders.refund` | Не возвращает товар и себестоимость | сторно движений |
| B-10 | `orders.kioskComplete` | Заказ без ресторана, смены, оплат и проводок | полная продажа |
| B-12 | `stockAccounting.applyStockMovement` | Задним числом не пересчитывает `balanceAfter` | пересчёт или запрет backdating после закрытия периода |
| B-13 | `recipes` | Без версий и создания, без потерь, без модификаторов | §3.4 |
| B-14 | `pricing` | Истечение не откатывает цену; порядок недетерминирован | вычисляемая цена |
| B-15 | `workforce.reversePayroll` | Налоги работодателя не сторнируются | |
| B-16 | `stock.postDocument` | Излишек инвентаризации проводится как недостача; перемещение удваивает сумму | |
| B-17 | `production.postAct` | Проводка по статичной цене, а движения по средней | |
| B-18 | `orders.refund` | Счёт = название типа оплаты | `data.account` |
| B-20 | `loyaltyCore.quoteLoyalty` | «Первая» программа, без ресторана; без частичного списания | |
| B-21 | `retail.acceptShift` и `finance.acceptShift` | Две реализации | одна |
| B-23 | `reportCalculators` | Многие из 190 отчётов пусты или упрощены | Все 190, реализованные честно, по волнам (§3.14) |
| B-24 | `iikoImport.resolveDepartmentExternalId` | Фолбэк на первый попавшийся | ошибка |
| B-26 | `officeAccess.assertPeriodOpen` | Блокировка организации без фильтра организации; checkout не проверяет | |
| B-27 | много мест | `take(1000..10000)` + фильтр в памяти | индексы и пагинация |
| B-28 | `bahandiDataset.ts:721`, `:619` | Seed не проходит свои же валидаторы | seed по валидаторам |
| FE | `B:src/styles/index.css` | Нет `@custom-variant dark`, 17 `dark:` реагируют на ОС | `@custom-variant dark ([data-theme=night] &)` |
| FE | `B:src/components/pos/order-panel.tsx` и др. | Около 40 захардкоженных hex и `bg-white` (список в `POS-DESIGN.md` §7) | только токены |
| FE | весь B:src | 74 % текста 6–9 px | шкала `POS-DESIGN.md` §3 |
| FE | `B:src/components/pos/nav-rail.tsx`, `GenericOfficeWorkspace`, ветка `dedicatedDestinations`, `ExchangeMetrics` | Мёртвый код | не переносить |

---

## 8. Дизайн

Полная спецификация — в `docs/04-POS-DESIGN.md`. Коротко:
- Токены приложения в `S:src/shared/styles/theme.css`. Это единственное место с hex, компоненты только на семантических токенах.
- Палитра по решению D2: светлые поверхности cream, тёмная навигация ink или walnut, одно красное главное действие на экран (wine/kilim), золото только для декора и на тёмном фоне, `gold-link`/`brass-lo` для текста на светлом.
- Типографика: POS не меньше 14 px, офис не меньше 12 px (у bahandi 7–9 px). Cormorant — для цен, итогов, заголовков страниц и диалогов. Golos — для всего остального. Капс только в казахских ритуальных названиях.
- Радиусы: 2 px у контролов, 6 px у карточек, 8 px у панелей и диалогов. Убрать 12 px у lg-кнопок и `rounded-full`-чипы.
- Орнамент (`S:public/branding/ornament.svg`) — симметричная рамка на экранах входа, пустых состояниях и заголовках разделов. Не фоном.
- Фото блюд и интерьеров из `S:public/images` — в карточках POS, пустых состояниях и экране входа.
- Скриншоты шаблона bahandi для сравнения: `reference/bahandi-screenshots/` (экраны входа). Скриншоты сайта-референса: `reference/site-screenshots/`.

---

## 9. Этапы работ

Каждая волна заканчивается зелёными тестами, `tsc -b`, деплоем на dev и приёмкой на скриншотах (1440 для POS и офиса, 1920 для кухни, 390 для курьера).

### W0 — Подготовка (без новых функций)
1. CI: тесты, typecheck и `convex dev --once --typecheck` перед `convex deploy`; preview-деплой (D9).
2. Исправить S-1…S-22.
3. Роутер (`/pos`, `/kitchen`, `/courier`, `/office/:section/:id?`), убрать `min-width` с body.
4. Дизайн-основа: токены (`POS-DESIGN.md` §2–4), примитивы (`POS-DESIGN.md` §5), оболочка офиса (сайдбар с группами и поиском, хлебные крошки, заголовок страницы).
5. Поправить `S:docs/03-ARCHITECTURE.md` под фактический код.

Готово, когда: нет публичных функций без авторизации (проверка скриптом по `convex/_generated/api.d.ts` + grep на `requireOperator|requireOfficeCapability`); старые экраны работают в новом дизайне.

### W1 — Ядро ресторана
1. Платформа учёта (§3.1): движения, двойная запись, периоды, outbox, аудит.
2. Права и пользователи офиса (§3.2) + UI roles/users/audit-log.
3. Каталог+: иерархия, фото, модификаторы, размеры, приказы о ценах, избранное, стоп-лист по филиалу (§3.3) + UI nomenclature/ProductEditor/modifiers/size-scales/price-orders.
4. Техкарты и списание по продаже (§3.4) + RecipeCardEditor.
5. Справочники розницы (§3.6) + UI 5 разделов.
6. POS+: модификаторы, тип заказа, отправка на кухню, void, split, перенос, история, возврат, отмена с причиной, кассовые операции, Z-отчёт, чек, лояльность со списанием (§3.5, §4.1).
7. Кухня как отдельная поверхность (§3.7, §4.2).
8. Склад: склады, поставщики, единицы, приход, списание, инвентаризация, перемещение, остатки на дату (§3.8) + миграция M-3.
9. Финансы: план счетов, проводки, приёмка смен, P&L (§3.9) + миграция M-4.
10. Лояльность: программы и счета, списание, согласия (§3.11) + миграция M-5.
11. Отчёты: каталог из 190 отчётов (как `office/80-…`), вьюер, первые ≈25 отчётов, экспорт, `dailySalesFacts` (§3.14).
12. iiko: проекции stores/terminals/units/suppliers/products (§3.15) + экран data-exchange.
13. Дашборд офиса.

### W2 — Операции
1. Производство: акты приготовления, заготовки, логистические акты, заказы поставщикам → приход (§3.8).
2. Персонал: сотрудники с HR-полями, должности, расписание (календарь), явка, зарплата РК (§3.10).
3. Доставка, курьеры, зоны на карте, курьерское PWA, оплата при доставке (§3.12, §4.4).
4. Банкеты и резервы со схемой зала (§3.11).
5. Финансы: услуги, обязательства, платежи.
6. Корпорация: организации, рестораны, подразделения, терминалы в офисе.
7. Очередь интеграций, рассылки отчётов.
8. iiko: техкарты и цены (проекции).

### W3 — Остальное до полного паритета
Кампании и SMS, выписки банка с сопоставлением, платёжный календарь, бюджеты, мотивация, медкнижки, план кухни и прогноз, шаблоны печати с превью, оборудование, Cloud API и внешнее меню, киоск, телефония, карточки всех интеграций (1С, EDI, банк, фискальные сервисы, лояльность, SMS и email, карты, Cloud API, ЕГАИС в режиме «Недоступно для KZ»), остальные отчёты до 190, горячие клавиши и сканер, KZ и EN интерфейс.

### Критерий паритета (для каждой волны)
Экран считается перенесённым, когда выполнены все три условия:
1. В матрице §13 для него есть строка, и скриншот sandyq в `reference/app-screenshots/<wave>/` лежит рядом со скриншотом bahandi.
2. Все кнопки, вкладки, поля и колонки со скриншота bahandi есть и работают. Исключение — баги из §12.1: их исправляем, а не повторяем.
3. Экран проходит чек-лист `POS-DESIGN.md` §9.

---

## 10. Миграции данных (прод `clear-flamingo-97`)

Правило: каждая миграция — internal mutation с батчами и флагом `dryRun`. Сначала на dev (`dapper-lobster-404`), затем прод через одноразовый deploy-ключ (mint → use → delete, `S:README.md`). Схема меняется в два деплоя: сначала поля `optional`, потом заполнение данных, потом ужесточение.

| # | Что | Откуда → куда |
|---|---|---|
| M-1 | Продукты | Новые поля `itemType: "dish"`, `writeOffMethod: "ingredients"`, `prepArea` из категории, `customizable: false` |
| M-2 | Заказы | `orderType` остаётся; `orderTypeExternalId` — ссылка на seed «В зале»; `payments.paymentTypeExternalId` — по `method` |
| M-3 | Склад | Один склад `<restaurant>-main` на ресторан; `stockBalances` и `stockMovements` с `restaurantExternalId` → `warehouseId` |
| M-4 | Финансы | `ledgerEntries` (плоские) → `journalEntries` (двойная запись) по таблице §3.9; старые помечаются `legacy` |
| M-5 | Лояльность | `guests.points` → `loyaltyAccounts.balance` в программе «Базовая»; транзакции с `accountId` |
| M-6 | Права | `officeUsers` + `organizationScopes`/`warehouseScopes = ["*"]` для существующих администраторов |
| M-7 | Кухня | `kitchenTickets.restaurantId` из заказа |

---

## 11. Справочник файлов

**bahandi-pos (эталон функционала)**
- Бэкенд:
  - `convex/schema.ts`;
  - `orders.ts` (checkout :475, consumeOrderStock :1000, validateAndPriceModifiers :755);
  - `shifts.ts`, `retail.ts`, `catalog.ts`, `modifiers.ts`, `sizeScales.ts`, `pricing.ts`, `stock.ts`, `stockAccounting.ts`, `inventory.ts`, `production.ts`, `productionLogistics.ts`, `finance.ts`, `workforce.ts` (calculateKzPayroll :173), `loyalty.ts`, `loyaltyCore.ts`, `delivery.ts`, `deliveryCore.ts`, `office.ts`, `officeAccess.ts`, `platformOperations.ts`, `reports.ts`, `reportRegistry.ts`, `reportCalculators.ts`, `iiko.ts`, `iikoImport.ts`, `http.ts`, `cloudApi.ts`, `crons.ts`.
- Тесты: `convex/*.test.ts` (особенно `expandedOfficeOperations.test.ts`, `enterprisePlatform.test.ts`, `posFlows.test.ts`).
- Фронтенд:
  - `src/App.tsx`;
  - `src/features/office-platform/model/navigation.ts` (91 раздел), `model/reports.ts` (каталог отчётов);
  - `src/components/pos/*`, `src/features/pos-operations/{ui,model}/*`;
  - `src/components/backoffice/*`;
  - `src/features/*/ui/*`;
  - `src/features/domain-operations/ui/domain-workspace.tsx`;
  - `src/styles/theme.css` (токены шаблона).
- Документы: `README.md`, `CONTEXT.md` (глоссарий), `plans/*.md`, `docs/adr/0001–0004`, `docs/iiko-office-coverage.md`, `docs/video-workflow-coverage.md`.

**sandyq (цель)**
- `convex/schema.ts`, `convex/domains/*`, `convex/lib/*`, `convex/posFlows.test.ts`.
- `src/pos/*`, `src/office/*`, `src/shared/*`, `src/shared/styles/{theme,index}.css`.
- `scripts/iiko/*`, `scripts/seed-sandyq.mjs`, `.github/workflows/*`.
- `docs/03-ARCHITECTURE.md`, `docs/02-BRD.md`, `docs/06-IIKO-RUNBOOK.md`, `public/menu-data/README.md`.
- Дизайн: `docs/04-POS-DESIGN.md`, `docs/DESIGN.md`, `docs/09-WEBSITE-ASSETS.md`, `reference/site-screenshots/`, `reference/bahandi-screenshots/`, `public/branding/*`, `public/images/*`, `/Users/beket/Desktop/echo/.claude/sandyq-design.skill`.
- `website/` — начатый маркетинговый сайт (sandyqgroup-стиль, отдельный пакет). К POS не относится; по нему нужно отдельное решение: доделать или удалить.

---

## 12. Проверка на живом стенде bahandi-pos (скриншоты)

Все 90 разделов офиса, касса, экран кухни и вход курьера пройдены вживую через Claude in Chrome 2026-09-24. Индекс скриншотов: `reference/bahandi-screenshots/README.md` (132 снимка в папках `pos/`, `office/`, `office-details/`, `kitchen/`, `courier/`). Пути ниже даны относительно `reference/bahandi-screenshots/`.

Для каждого раздела из таблицы §4.3 есть скриншот `office/NN-<id>.jpg`, где `<id>` — id раздела из `navigation.ts`. Его стоит открывать рядом с планом при переносе экрана.

### 12.1 Баги, которые видны на стенде (не переносить)

| # | Где | Что видно | Скриншот | Что делать в sandyq |
|---|---|---|---|---|
| L-1 | Касса, каталог | Категории «Комбо» и «Напитки» пустые («Ничего не найдено»), хотя эти блюда есть в «Популярном». Фильтр категории сравнивает не то поле (см. `category === "combo"` против «Комбо» в сиде, B-бэкенд §2 orders) | `pos/24-category-combo-empty-bug.jpg`, `pos/25-…` | Фильтровать по `categoryExternalId`, а не по подписи; тест на каждую категорию сида |
| L-2 | Касса, каталог | При выборе категории, которая была за краем, лента чипов и весь каталог уезжают по горизонтали, шапка каталога обрезается | `pos/25-category-drinks-empty-layout-shift-bug.jpg` | `scrollIntoView({inline:"nearest"})` только внутри ленты чипов; `overflow-x: auto` на ленте, а не на колонке |
| L-3 | Касса, ночная тема | Фото блюд не отображаются (пустые белые плашки) | `pos/11-main-night-theme.jpg` | Фото на токене фона `--muted`, `object-fit: cover`, проверить загрузку в обеих темах (`POS-DESIGN.md` §2.2) |
| L-4 | Касса, «История заказов» | Панель возврата («Возврат по заказу … доступно …») рендерится под списком за нижним краем диалога, до неё нужно доскролливать | `pos/23-order-history-refund-panel-cut-off.jpg` | Возврат открывать отдельным диалогом или боковой панелью |
| L-5 | Касса и офис | После закрытия диалога первый клик часто не срабатывает (overlay Radix ещё перехватывает pointer-события во время анимации закрытия) | воспроизводилось на каждом диалоге | Анимация закрытия ≤150 мс и `pointer-events:none` у закрывающегося overlay; e2e-тест «закрыть диалог → сразу клик» |
| L-6 | Касса, вход и блокировка | Подпись «Bahandi · Абая · Касса №1» захардкожена, хотя выбран терминал «АДК · Главная касса» | `pos/02-login-empty.jpg`, `pos/28-locked.jpg` | Брать ресторан и терминал из сессии; в sandyq — «Sandyq · <филиал> · <касса>» |
| L-7 | Офис, шапка | В офисе показана кассовая шапка: «Bahandi · Абая», «Касса №1», «Смена закрыта», переключатель Касса/Офис | любой `office/*.jpg` | Отдельная шапка офиса (`POS-DESIGN.md` §6.4) |
| L-8 | Офис, «Избранное» | Показывает копию дашборда | `office/02-favorites-is-dashboard-copy.jpg` | Настоящее избранное или убрать пункт |
| L-9 | Офис, статусы | Английские статусы вперемешку с русскими: PUBLISHED, POSTED, DRAFT, AVAILABLE, COMPLETED | `office/05-payment-types.jpg`, `office/19-…`, `office/20-…`, `office/61-couriers.jpg`, `office/63-telephony.jpg` | Один словарь статусов с RU-подписями (StatusPill) |
| L-10 | Офис, общий `DomainWorkspace` | Колонка «Сумма / значение» бессмысленна для справочников: сотрудник «1 ₸», должность «1 ₸», смена в расписании «8 ₸» (это часы), план счетов «275 000 ₸», организации и терминалы «0 ₸» | `office/46-…`, `office/47-…`, `office/49-schedule-hours-shown-as-tenge-bug.jpg`, `office/36-…`, `office/65-…`, `office/76-…` | Колонки реестра задавать конфигом модуля; единица измерения у каждого числового поля |
| L-11 | Офис, финансы | Одинаковый блок KPI «Оборот по дебету / кредиту / Проводок за 30 дней» стоит на несвязанных страницах (платёжный календарь, бюджеты, задолженность), и дебет всегда равен кредиту | `office/37-…`, `office/41-…`, `office/44-…`, `office/45-…` | KPI по смыслу раздела; исправить расчёт overview (§3.9) |
| L-12 | Офис, «Принятие смен» | «Закрытые кассовые смены» пусто, хотя в «Кассовых сменах» закрытые смены есть | `office/38-shift-acceptance-empty-bug.jpg` vs `office/04-cash-shifts.jpg` | Одна приёмка смены (§3.5, B-21), источник — `shifts` со статусом closed |
| L-13 | Экран кухни | Заказ №100002 со статусом «возвращён» висит в очереди «В очереди»: возврат не трогает кухню | `kitchen/01-kitchen-board-in-office-refunded-order-still-queued.jpg` | При refund/void/cancel переводить тикет в `cancelled` (§3.7) |
| L-14 | Производство | «План на кухню»: прогноз пустой, а в «Ведомости полуфабрикатов» тот же прогноз заполнен | `office/32-kitchen-plan-forecast-empty.jpg` vs `office/34-semi-finished-sheet.jpg` | Один источник прогноза, время Алматы (§3.8) |
| L-15 | Офис, `data-exchange` и курьер | Браузер автозаполняет email и пароль офиса в поля «Код входа / Новый PIN» и в форму входа курьера | `office/68-data-exchange-iiko-browser-autofills-office-password-into-pin-bug.jpg`, `courier/01-…` | `autocomplete="off"` / `one-time-code`, `name` полей не `email`/`password`, `inputmode="numeric"` |
| L-16 | Офис, отчёты | На 1341px кнопки «В избранное / Рассылка / CSV / XLSX / PDF» налезают на заголовок отчёта, таблица обрезана справа | `office/80-reports-viewer-header-overlap-bug.jpg` | Тулбар отдельной строкой, таблица с горизонтальным скроллом внутри карточки |
| L-17 | Офис, «Заказы и чеки» | На 1341px клик по заказу не открывает карточку чека (панель «Выберите заказ для просмотра чека» остаётся) | `office-details/07-orders-row-click-no-detail-panel-bug.jpg` | Правая панель или отдельная страница `/office/orders/:id` |
| L-18 | Офис, приходная накладная | Проведённый документ показывает редактируемые поля (количество, цена, НДС, склад) | `office-details/08-receipt-posted-still-editable.jpg` | Проведённые документы только для чтения, правка через сторно |
| L-19 | Офис, приказ о ценах | Наценка 140 % у всех строк подряд — похоже на ошибку расчёта | `office-details/10-price-order-editor-markup-140-everywhere.jpg` | Наценка = (цена − себестоимость по техкарте) / себестоимость |
| L-20 | Офис, карточка товара | Вкладки не помещаются и обрезаются справа («Технолог…»); вес единицы 0,5 кг в «Единицах» против 0,08 кг в техкарте | `office-details/01-…`, `03-product-editor-units.jpg` | Вкладки со скроллом или вертикальная навигация; одно поле веса |
| L-21 | Курьер | На 400px карточка входа уезжает за правый край: страница не адаптивна (`body{min-width:1024px}`) | `courier/01-login-mobile-400px-cut-off-and-office-password-autofilled-bug.jpg` | Mobile-first (§4.4) |
| L-22 | Офис | Денежный формат плавает: «1 279 652,3 ₸», «4 375 999,84 ₸» с копейками рядом с целыми тенге | `office/41-accounts-payable.jpg`, `office/37-transactions.jpg` | Единый `formatTenge` без дробей в UI (`POS-DESIGN.md` §3.3) |
| L-23 | Офис, документы склада | Типографика реестров документов (18px, жирный) не совпадает с остальными реестрами (8–9px) | `office/19-…`–`office/23-…` vs `office/68-receipts…` | Один компонент Table (`POS-DESIGN.md` §5) |
| L-24 | Офис, зоны доставки / банкеты | Полигон зоны вводится текстом; у банкетов нет схемы зала | `office/60-delivery-zones-text-polygon.jpg`, `office/58-reservations-no-floor-plan.jpg` | Карта и схема зала (§4.3, W2) |

### 12.2 Что на стенде работает хорошо (перенести как образец поведения)

- Смена: предупреждение «Смена открыта более 24 часов», слепой пересчёт при закрытии, блокировка закрытия открытыми заказами («Открытых заказов: 2»), история смен с расхождением — `pos/06-…`–`pos/09-…`.
- Оплата: плитки способов, пресеты сдачи, отдельные экраны учёта карты и Kaspi QR, смешанная оплата — `pos/18-…`–`pos/21-…`. В sandyq сохранить сплит на N частей (§4.1).
- Модификаторы: группа «от 0 до 4 · бесплатно 0», степперы, цена в кнопке «Добавить в заказ · 3 200 ₸» — `pos/26-modifier-dialog.jpg`.
- Техкарта: KPI «Цена / Себестоимость порции / Фудкост / Выход», брутто-нетто, «Проверка техкарты» — `office-details/01-product-editor-recipe-card.jpg`.
- Приходная накладная: «Расчёт средней себестоимости» по складам и партиям — `office-details/09-receipt-costing-explainer.jpg`.
- Роли: матрица разрешений по группам, 7 системных ролей — `office/75-roles-permission-matrix.jpg`.
- Журнал событий: действия POS и офиса в одном месте (`SESSION.LOCK`, `ORDER.REFUND`, `IIKO.POS-ACCESS.CREDENTIALS-UPDATE`) — `office/78-audit-log.jpg`.
- Остатки на дату со средней ценой и стоимостью — `office/17-stock-balances.jpg`.

### 12.3 Доступы к стенду

Доступы к демо-стенду описаны в `bahandi-pos/docs/CREDENTIALS.md`: код и PIN кассы, email офиса. Файл лежит в `.gitignore`. В этот репозиторий пароли и PIN намеренно не копируются: `sandyq` пушится в GitHub (`goecho-ai/sandyq`).

---

## 13. Матрица паритета экранов: bahandi → sandyq

Шаблоны экранов офиса подробно описаны в `OFFICE-DESIGN.md` §3 (соответствие: §11.4.1 → §3.7, §11.4.2 → §3.1, §11.4.3 → §3.2, §11.4.4 → §3.3, §11.4.5 → §3.4, §11.4.6 → §3.5 + колонки §5, §11.4.7 → §3.6, §11.4.8 → §3.8).

Каждый экран bahandi со стенда получает экран в sandyq:
- с той же раскладкой и составом (кнопки, вкладки, колонки, поля);
- в стиле Sandyq по шаблону из `POS-DESIGN.md` §11.

Колонка «Сейчас в sandyq» показывает текущее состояние. Путь к скриншоту дан относительно `docs/`.

### 13.1 Касса, кухня, курьер

| Экран | Скриншот bahandi | Шаблон Sandyq | Маршрут | Волна | Сейчас в sandyq |
|---|---|---|---|---|---|
| Выбор терминала | `bahandi-screenshots/pos/01-terminal-picker.jpg` | Вход: подразделение → касса (§11.1) | `/pos` (без сессии) | W0 | ⚠️ захардкоженный список филиалов |
| Вход по коду и PIN | `bahandi-screenshots/pos/02-login-empty.jpg, pos/03-login-filled.jpg` | Вход с PIN-падом (§11.1) | `/pos` | W0 | ✅ (другой стиль) |
| Главный экран кассы | `bahandi-screenshots/pos/04-main-screen.jpg, ../image.png` | Касса (§11.2) | `/pos` | W1 | ⚠️ другая раскладка |
| Главное меню кассы | `bahandi-screenshots/pos/05-main-menu.jpg` | Диалог-плитки (§11.3) | `/pos` → меню | W1 | ❌ |
| Смена: текущая / внести-изъять / закрыть / история | `bahandi-screenshots/pos/06…09-*.jpg` | Диалог смены с табами (§11.3) | `/pos` → смена | W1 | ⚠️ открыть/закрыть/X |
| Профиль | `bahandi-screenshots/pos/10-profile.jpg` | Диалог (§11.3) | `/pos` | W1 | ❌ |
| Ночная тема | `bahandi-screenshots/pos/11-main-night-theme.jpg` | Тема night (POS-DESIGN §2.2) | — | W0 | ⚠️ неполная |
| Уведомления | `bahandi-screenshots/pos/12-notifications-night.jpg` | Диалог (§11.3) | `/pos` | W1 | ❌ |
| Действия с заказом: комментарий, разделить, перенести, предчек, отменить | `bahandi-screenshots/pos/13…15-*.jpg` | Диалог-плитки + формы (§11.3) | `/pos` | W1 | ❌ |
| Гость и лояльность | `bahandi-screenshots/pos/16-guest-loyalty.jpg` | Диалог (§11.3) | `/pos` | W1 | ⚠️ без списания |
| Скидка | `bahandi-screenshots/pos/17-discount.jpg` | Диалог (§11.3) | `/pos` | W1 | ⚠️ без справочника |
| Оплата: наличные / карта / QR / смешанная | `bahandi-screenshots/pos/18…21-*.jpg` | Диалог оплаты (§11.3) | `/pos` | W1 | ⚠️ сплит есть |
| История заказов + возврат | `bahandi-screenshots/pos/22-order-history.jpg, pos/23-*.jpg` | Диалог-реестр (§11.3) | `/pos` | W1 | ❌ |
| Каталог: категории, избранное | `bahandi-screenshots/pos/24…27-*.jpg` | Каталог (§11.2) | `/pos` | W1 | ⚠️ без фото и избранного |
| Модификаторы и размеры | `bahandi-screenshots/pos/26-modifier-dialog.jpg` | Диалог модификаторов (§11.3) | `/pos` | W1 | ❌ |
| Блокировка | `bahandi-screenshots/pos/28-locked.jpg` | Вход (§11.1) | `/pos` | W0 | ⚠️ UI не читает locked |
| Экран кухни | `bahandi-screenshots/kitchen/01-*.jpg` | Кухня (§11.5) | `/kitchen` | W1 | ⚠️ внутри кассы |
| Курьер | `bahandi-screenshots/courier/01-*.jpg, courier-00-entry.png` | Курьер PWA (§11.6) | `/courier` | W2 | ❌ |

### 13.2 Офис — все 90 разделов

| Раздел | Скриншот bahandi | Шаблон Sandyq | Маршрут | Волна | Сейчас в sandyq |
|---|---|---|---|---|---|
| Стартовая страница (`dashboard`) | [`office/01-dashboard.jpg`](bahandi-screenshots/office/01-dashboard.jpg) | Дашборд (§11.4.1) | `/office/dashboard` | W1 | ❌ |
| Избранное (`favorites`) | [`office/02-favorites-is-dashboard-copy.jpg`](bahandi-screenshots/office/02-favorites-is-dashboard-copy.jpg) | Дашборд (§11.4.1) | `/office/favorites` | W3 | ❌ |
| Заказы и чеки (`orders`) | [`office/03-orders.jpg`](bahandi-screenshots/office/03-orders.jpg) | Реестр с табами статусов (§11.4.2) | `/office/orders` | W1 | ❌ |
| Кассовые смены (`cash-shifts`) | [`office/04-cash-shifts.jpg`](bahandi-screenshots/office/04-cash-shifts.jpg) | Реестр с табами статусов (§11.4.2) | `/office/cash-shifts` | W1 | ⚠️ X-отчёты |
| Типы оплат (`payment-types`) | [`office/05-payment-types.jpg`](bahandi-screenshots/office/05-payment-types.jpg) | Справочник «список + форма публикации» (§11.4.3) | `/office/payment-types` | W1 | ❌ |
| Типы заказов (`order-types`) | [`office/06-order-types.jpg`](bahandi-screenshots/office/06-order-types.jpg) | Справочник «список + форма публикации» (§11.4.3) | `/office/order-types` | W1 | ❌ |
| Скидки и надбавки (`discount-types`) | [`office/07-discount-types.jpg`](bahandi-screenshots/office/07-discount-types.jpg) | Справочник «список + форма публикации» (§11.4.3) | `/office/discount-types` | W1 | ❌ |
| Причины удалений (`deletion-reasons`) | [`office/08-deletion-reasons.jpg`](bahandi-screenshots/office/08-deletion-reasons.jpg) | Справочник «список + форма публикации» (§11.4.3) | `/office/deletion-reasons` | W1 | ❌ |
| Внесения и изъятия (`cash-operations`) | [`office/09-cash-operations.jpg`](bahandi-screenshots/office/09-cash-operations.jpg) | Реестр с табами статусов (§11.4.2) | `/office/cash-operations` | W1 | ❌ |
| Номенклатура (`nomenclature`) | [`office/10-nomenclature.jpg`](bahandi-screenshots/office/10-nomenclature.jpg) | Реестр с табами статусов (§11.4.2) | `/office/nomenclature` | W1 | ⚠️ «Меню и цены» |
| Группы товаров (`product-groups`) | [`office/11-product-groups.jpg`](bahandi-screenshots/office/11-product-groups.jpg) | Мастер-данные «список сверху + форма снизу» → master-detail (§11.4.4) | `/office/product-groups` | W1 | ⚠️ категории |
| Модификаторы (`modifiers`) | [`office/12-modifiers.jpg`](bahandi-screenshots/office/12-modifiers.jpg) | Реестр с табами статусов (§11.4.2) | `/office/modifiers` | W1 | ❌ |
| Шкалы размеров (`size-scales`) | [`office/13-size-scales-empty.jpg`](bahandi-screenshots/office/13-size-scales-empty.jpg) | Реестр с табами статусов (§11.4.2) | `/office/size-scales` | W1 | ❌ |
| Приказы об изменении цен (`price-orders`) | [`office/14-price-orders.jpg`](bahandi-screenshots/office/14-price-orders.jpg) | Реестр с табами статусов (§11.4.2) | `/office/price-orders` | W1 | ❌ |
| Прайс-листы (`price-lists`) | [`office/15-price-lists.jpg`](bahandi-screenshots/office/15-price-lists.jpg) | Мастер-данные «список сверху + форма снизу» → master-detail (§11.4.4) | `/office/price-lists` | W2 | ❌ |
| Склады (`warehouses`) | [`office/16-warehouses.jpg`](bahandi-screenshots/office/16-warehouses.jpg) | Мастер-данные «список сверху + форма снизу» → master-detail (§11.4.4) | `/office/warehouses` | W1 | ❌ |
| Остатки (`stock`) | [`office/17-stock-balances.jpg`](bahandi-screenshots/office/17-stock-balances.jpg) | Реестр с табами статусов (§11.4.2) | `/office/stock` | W1 | ⚠️ «Склад» |
| Приходные накладные (`receipts`) | [`office/18-receipts.jpg`](bahandi-screenshots/office/18-receipts.jpg) | Реестр документов + редактор документа (§11.4.2, §11.4.5) | `/office/receipts` | W1 | ⚠️ ручной приход |
| Расходные накладные (`outgoing-invoices`) | [`office/19-outgoing-invoices.jpg`](bahandi-screenshots/office/19-outgoing-invoices.jpg) | Реестр документов + редактор документа (§11.4.2, §11.4.5) | `/office/outgoing-invoices` | W2 | ❌ |
| Возвраты поставщикам (`supplier-returns`) | [`office/20-supplier-returns.jpg`](bahandi-screenshots/office/20-supplier-returns.jpg) | Реестр документов + редактор документа (§11.4.2, §11.4.5) | `/office/supplier-returns` | W2 | ❌ |
| Инвентаризации (`inventories`) | [`office/21-inventories.jpg`](bahandi-screenshots/office/21-inventories.jpg) | Реестр документов + редактор документа (§11.4.2, §11.4.5) | `/office/inventories` | W1 | ⚠️ «Инв.» |
| Внутренние перемещения (`transfers`) | [`office/22-transfers.jpg`](bahandi-screenshots/office/22-transfers.jpg) | Реестр документов + редактор документа (§11.4.2, §11.4.5) | `/office/transfers` | W1 | ❌ |
| Акты списания (`writeoffs`) | [`office/23-writeoffs.jpg`](bahandi-screenshots/office/23-writeoffs.jpg) | Реестр документов + редактор документа (§11.4.2, §11.4.5) | `/office/writeoffs` | W1 | ⚠️ «Списать» |
| Поставщики (`suppliers`) | [`office/24-suppliers.jpg`](bahandi-screenshots/office/24-suppliers.jpg) | Мастер-данные «список сверху + форма снизу» → master-detail (§11.4.4) | `/office/suppliers` | W1 | ❌ |
| Единицы измерения (`units`) | [`office/25-units.jpg`](bahandi-screenshots/office/25-units.jpg) | Мастер-данные «список сверху + форма снизу» → master-detail (§11.4.4) | `/office/units` | W1 | ❌ |
| Приготовление (`production`) | [`office/26-production-acts-empty.jpg`](bahandi-screenshots/office/26-production-acts-empty.jpg) | Реестр документов + редактор документа (§11.4.2, §11.4.5) | `/office/production` | W2 | ❌ |
| Акты переработки (`processing-acts`) | [`office/27-processing-acts.jpg`](bahandi-screenshots/office/27-processing-acts.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/processing-acts` | W2 | ❌ |
| Акты разбора (`assembly-acts`) | [`office/28-assembly-acts.jpg`](bahandi-screenshots/office/28-assembly-acts.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/assembly-acts` | W2 | ❌ |
| Акты реализации (`sales-acts`) | [`office/29-sales-acts.jpg`](bahandi-screenshots/office/29-sales-acts.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/sales-acts` | W2 | ❌ |
| Заказы поставщикам (`purchase-orders`) | [`office/30-purchase-orders.jpg`](bahandi-screenshots/office/30-purchase-orders.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/purchase-orders` | W2 | ❌ |
| Внутренние заказы (`internal-orders`) | [`office/31-internal-orders.jpg`](bahandi-screenshots/office/31-internal-orders.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/internal-orders` | W2 | ❌ |
| План на кухню (`kitchen-plan`) | [`office/32-kitchen-plan-forecast-empty.jpg`](bahandi-screenshots/office/32-kitchen-plan-forecast-empty.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/kitchen-plan` | W3 | ❌ |
| Экран кухни (`kitchen-board`) | [`office/33-kitchen-board.jpg`](bahandi-screenshots/office/33-kitchen-board.jpg) | Экран кухни `/kitchen` (§11.5) | `/office/kitchen-board` | W1 | ⚠️ внутри кассы |
| Ведомость полуфабрикатов (`semi-finished-sheet`) | [`office/34-semi-finished-sheet.jpg`](bahandi-screenshots/office/34-semi-finished-sheet.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/semi-finished-sheet` | W3 | ❌ |
| Статьи ДДС (`cashflow-categories`) | [`office/35-cashflow-categories.jpg`](bahandi-screenshots/office/35-cashflow-categories.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/cashflow-categories` | W1 | ❌ |
| План счетов (`chart-of-accounts`) | [`office/36-chart-of-accounts-generic-form.jpg`](bahandi-screenshots/office/36-chart-of-accounts-generic-form.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/chart-of-accounts` | W1 | ❌ |
| Проводки (`transactions`) | [`office/37-transactions.jpg`](bahandi-screenshots/office/37-transactions.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/transactions` | W1 | ⚠️ плоский журнал |
| Принятие смен (`shift-acceptance`) | [`office/38-shift-acceptance-empty-bug.jpg`](bahandi-screenshots/office/38-shift-acceptance-empty-bug.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/shift-acceptance` | W1 | ❌ |
| Акты услуг (`services`) | [`office/39-services.jpg`](bahandi-screenshots/office/39-services.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/services` | W2 | ⚠️ «Добавить расход» |
| Контрагенты (`counterparties`) | [`office/40-counterparties.jpg`](bahandi-screenshots/office/40-counterparties.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/counterparties` | W1 | ❌ |
| Задолженность (`accounts-payable`) | [`office/41-accounts-payable.jpg`](bahandi-screenshots/office/41-accounts-payable.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/accounts-payable` | W2 | ❌ |
| Платежи (`payments`) | [`office/42-payments.jpg`](bahandi-screenshots/office/42-payments.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/payments` | W2 | ❌ |
| Банковские выписки (`bank-statements`) | [`office/43-bank-statements.jpg`](bahandi-screenshots/office/43-bank-statements.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/bank-statements` | W3 | ❌ |
| Платёжный календарь (`payment-calendar`) | [`office/44-payment-calendar.jpg`](bahandi-screenshots/office/44-payment-calendar.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/payment-calendar` | W3 | ❌ |
| Бюджеты (`budgets`) | [`office/45-budgets.jpg`](bahandi-screenshots/office/45-budgets.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/budgets` | W3 | ❌ |
| Сотрудники (`employees`) | [`office/46-employees-generic-amount-column.jpg`](bahandi-screenshots/office/46-employees-generic-amount-column.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/employees` | W1 | ⚠️ «Кадры» |
| Должности (`positions`) | [`office/47-positions.jpg`](bahandi-screenshots/office/47-positions.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/positions` | W2 | ❌ |
| Типы смен (`shift-types`) | [`office/48-shift-types-empty.jpg`](bahandi-screenshots/office/48-shift-types-empty.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/shift-types` | W2 | ❌ |
| Расписание (`schedule`) | [`office/49-schedule-hours-shown-as-tenge-bug.jpg`](bahandi-screenshots/office/49-schedule-hours-shown-as-tenge-bug.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/schedule` | W2 | ❌ |
| Журнал явки (`attendance`) | [`office/50-attendance.jpg`](bahandi-screenshots/office/50-attendance.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/attendance` | W2 | ❌ |
| Начисления и удержания (`payroll`) | [`office/51-payroll.jpg`](bahandi-screenshots/office/51-payroll.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/payroll` | W2 | ❌ |
| Мотивационные программы (`motivation`) | [`office/52-motivation-empty.jpg`](bahandi-screenshots/office/52-motivation-empty.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/motivation` | W3 | ❌ |
| Медкнижки и анализы (`medical-records`) | [`office/53-medical-records-empty.jpg`](bahandi-screenshots/office/53-medical-records-empty.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/medical-records` | W3 | ❌ |
| Гости (`guests`) | [`office/54-guests.jpg`](bahandi-screenshots/office/54-guests.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/guests` | W1 | ⚠️ «Лояльность» |
| Программы лояльности (`loyalty-programs`) | [`office/55-loyalty-programs.jpg`](bahandi-screenshots/office/55-loyalty-programs.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/loyalty-programs` | W1 | ❌ |
| Категории гостей (`guest-categories`) | [`office/56-guest-categories.jpg`](bahandi-screenshots/office/56-guest-categories.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/guest-categories` | W1 | ❌ |
| Рассылки и акции (`campaigns`) | [`office/57-campaigns.jpg`](bahandi-screenshots/office/57-campaigns.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/campaigns` | W3 | ❌ |
| Банкеты и резервы (`reservations`) | [`office/58-reservations-no-floor-plan.jpg`](bahandi-screenshots/office/58-reservations-no-floor-plan.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/reservations` | W2 | ❌ |
| Заказы доставки (`delivery-orders`) | [`office/59-delivery-orders.jpg`](bahandi-screenshots/office/59-delivery-orders.jpg) | Реестр с табами статусов (§11.4.2) | `/office/delivery-orders` | W2 | ❌ |
| Зоны доставки (`delivery-zones`) | [`office/60-delivery-zones-text-polygon.jpg`](bahandi-screenshots/office/60-delivery-zones-text-polygon.jpg) | Мастер-данные «список сверху + форма снизу» → master-detail (§11.4.4) | `/office/delivery-zones` | W2 | ❌ |
| Курьеры (`couriers`) | [`office/61-couriers.jpg`](bahandi-screenshots/office/61-couriers.jpg) | Мастер-данные «список сверху + форма снизу» → master-detail (§11.4.4) | `/office/couriers` | W2 | ❌ |
| Колл-центр (`call-center`) | [`office/62-call-center.jpg`](bahandi-screenshots/office/62-call-center.jpg) | Реестр с табами статусов (§11.4.2) | `/office/call-center` | W2 | ❌ |
| Телефония (`telephony`) | [`office/63-telephony.jpg`](bahandi-screenshots/office/63-telephony.jpg) | Реестр с табами статусов (§11.4.2) | `/office/telephony` | W3 | ❌ |
| Источники заказов (`delivery-sources`) | [`office/64-delivery-sources.jpg`](bahandi-screenshots/office/64-delivery-sources.jpg) | Мастер-данные «список сверху + форма снизу» → master-detail (§11.4.4) | `/office/delivery-sources` | W2 | ❌ |
| Организации (`organizations`) | [`office/65-organizations.jpg`](bahandi-screenshots/office/65-organizations.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/organizations` | W2 | ❌ |
| Рестораны (`restaurants`) | [`office/66-restaurants-generic-record.jpg`](bahandi-screenshots/office/66-restaurants-generic-record.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/restaurants` | W2 | ❌ |
| Подразделения (`departments`) | [`office/67-departments.jpg`](bahandi-screenshots/office/67-departments.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/departments` | W2 | ❌ |
| Обмен между точками (`data-exchange`) | [`office/68-data-exchange-iiko-browser-autofills-office-password-into-pin-bug.jpg`](bahandi-screenshots/office/68-data-exchange-iiko-browser-autofills-office-password-into-pin-bug.jpg) | Выделенный экран (§11.4.7) | `/office/data-exchange` | W1 | ❌ |
| Закрытие периода (`document-locks`) | [`office/69-document-locks.jpg`](bahandi-screenshots/office/69-document-locks.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/document-locks` | W1 | ❌ |
| 1С (`integration-1c`) | [`office/70-integration-1c.jpg`](bahandi-screenshots/office/70-integration-1c.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/integration-1c` | W3 | ❌ |
| ЕГАИС (`integration-egais`) | [`office/71-integration-egais-kz-disabled.jpg`](bahandi-screenshots/office/71-integration-egais-kz-disabled.jpg) | Выделенный экран (§11.4.7) | `/office/integration-egais` | W3 | ❌ |
| Фискальные сервисы (`integration-fiscal`) | [`office/72-integration-fiscal.jpg`](bahandi-screenshots/office/72-integration-fiscal.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/integration-fiscal` | W3 | ❌ |
| Внешнее меню (`external-menu`) | [`office/73-external-menu.jpg`](bahandi-screenshots/office/73-external-menu.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/external-menu` | W3 | ❌ |
| Пользователи (`users`) | [`office/74-users.jpg`](bahandi-screenshots/office/74-users.jpg) | Выделенный экран (§11.4.7) | `/office/users` | W1 | ❌ |
| Роли и права (`roles`) | [`office/75-roles-permission-matrix.jpg`](bahandi-screenshots/office/75-roles-permission-matrix.jpg) | Выделенный экран (§11.4.7) | `/office/roles` | W1 | ❌ |
| Терминалы (`terminals`) | [`office/76-terminals-generic-record.jpg`](bahandi-screenshots/office/76-terminals-generic-record.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/terminals` | W1 | ❌ |
| Шаблоны печати (`print-templates`) | [`office/77-print-templates-no-preview.jpg`](bahandi-screenshots/office/77-print-templates-no-preview.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/print-templates` | W3 | ❌ |
| Журнал событий (`audit-log`) | [`office/78-audit-log.jpg`](bahandi-screenshots/office/78-audit-log.jpg) | Реестр с табами статусов (§11.4.2) | `/office/audit-log` | W1 | ❌ |
| Очередь интеграций (`integration-jobs`) | [`office/79-integration-jobs.jpg`](bahandi-screenshots/office/79-integration-jobs.jpg) | Реестр с табами статусов (§11.4.2) | `/office/integration-jobs` | W2 | ❌ |
| Все отчёты (`reports`) | [`office/80-reports-viewer-header-overlap-bug.jpg`](bahandi-screenshots/office/80-reports-viewer-header-overlap-bug.jpg) | Каталог отчётов + вьюер (§11.4.8) | `/office/reports` | W1 | ⚠️ «Отчёты» |
| Избранные отчёты (`report-favorites`) | [`office/81-report-favorites-empty.jpg`](bahandi-screenshots/office/81-report-favorites-empty.jpg) | Каталог отчётов + вьюер (§11.4.8) | `/office/report-favorites` | W1 | ❌ |
| Рассылки отчётов (`report-schedules`) | [`office/82-report-schedules-empty.jpg`](bahandi-screenshots/office/82-report-schedules-empty.jpg) | Каталог отчётов + вьюер (§11.4.8) | `/office/report-schedules` | W2 | ❌ |
| Настройки системы (`system-settings`) | [`office/83-system-settings.jpg`](bahandi-screenshots/office/83-system-settings.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/system-settings` | W3 | ❌ |
| EDI (`integration-edi`) | [`office/84-integration-edi.jpg`](bahandi-screenshots/office/84-integration-edi.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/integration-edi` | W3 | ❌ |
| Банк-клиент (`integration-bank`) | [`office/85-integration-bank.jpg`](bahandi-screenshots/office/85-integration-bank.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/integration-bank` | W3 | ❌ |
| Лояльность (`integration-loyalty`) | [`office/86-integration-loyalty.jpg`](bahandi-screenshots/office/86-integration-loyalty.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/integration-loyalty` | W3 | ❌ |
| SMS и email (`integration-messaging`) | [`office/87-integration-messaging.jpg`](bahandi-screenshots/office/87-integration-messaging.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/integration-messaging` | W3 | ❌ |
| Карты и курьеры (`integration-maps`) | [`office/88-integration-maps.jpg`](bahandi-screenshots/office/88-integration-maps.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/integration-maps` | W3 | ❌ |
| Cloud API (`integration-cloud-api`) | [`office/89-integration-cloud-api.jpg`](bahandi-screenshots/office/89-integration-cloud-api.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/integration-cloud-api` | W3 | ❌ |
| Оборудование (`equipment`) | [`office/90-equipment.jpg`](bahandi-screenshots/office/90-equipment.jpg) | Реестр DomainWorkspace + карточка записи (§11.4.6) | `/office/equipment` | W3 | ❌ |

### 13.3 Карточки и редакторы

| Экран | Скриншот bahandi | Шаблон Sandyq | Маршрут | Волна |
|---|---|---|---|---|
| Карточка товара: 6 вкладок | `bahandi-screenshots/office-details/01…06-*.jpg` | Редактор сущности с вкладками (§11.4.5) | `/office/nomenclature/:id` | W1 |
| Карточка чека | `bahandi-screenshots/office-details/07-*.jpg` | Правая панель / страница (§11.4.2) | `/office/orders/:id` | W1 |
| Приходная накладная + расчёт себестоимости | `bahandi-screenshots/office-details/08-*.jpg, 09-*.jpg` | Редактор документа (§11.4.5) | `/office/receipts/:id` | W1 |
| Приказ о ценах | `bahandi-screenshots/office-details/10-*.jpg` | Редактор документа (§11.4.5) | `/office/price-orders/:id` | W1 |
| Заказ доставки | `bahandi-screenshots/office-details/11-*.jpg` | Редактор документа (§11.4.5) | `/office/delivery-orders/:id` | W2 |
