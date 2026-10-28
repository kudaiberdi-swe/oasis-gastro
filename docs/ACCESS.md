# Доступы и ссылки

Окружения: **production** (реальные данные, открыт из интернета), **демо-стенд** (показ клиенту, работает на dev-деплое Convex) и **локальная машина** разработчика.

Команды поддержки, которых нет в интерфейсе: `README.md` и `docs/01-ONBOARDING.md` §6. Ключи по именам: [TOKENS.md](../TOKENS.md).

## Production

| Что | Адрес |
| --- | --- |
| **Офис** | https://thankful-moss-04c3d4a0f.4.azurestaticapps.net/office |
| **Касса (POS)** | https://thankful-moss-04c3d4a0f.4.azurestaticapps.net/pos |
| **Кухня (KDS)** | https://thankful-moss-04c3d4a0f.4.azurestaticapps.net/kitchen (старый адрес `/pos/kitchen` открывает тот же экран) |
| Бэкенд: деплой Convex Cloud | `clear-flamingo-97` |
| Хостинг фронтенда | Azure Static Web App `sandyq-frontend`, группа ресурсов `sandyq-prod` |
| Исходный код | GitHub `goecho-ai/sandyq` |

Касса конкретного филиала открывается параметром `?terminal=`: `sandyq-almaty-01`, `sandyq-shymkent-01`, `sandyq-turkistan-01` (`README.md` § Environments).

Где хранятся данные: Convex Cloud (данные вне РК, `TODO.md` §4), фронтенд — Azure Static Web Apps. TODO(echo): указать регион деплоя Convex `clear-flamingo-97` и регион SWA `sandyq-frontend`. Правила по месту хранения данных клиент не дал (`CLAUDE.md`): TODO(client): подтвердить, что хранение вне РК допустимо.

Команда CLI против production — только по правилу mint → use → delete для ключа деплоя (`docs/01-ONBOARDING.md` §6):

```bash
npx convex env list --prod
```

**Что уже есть на production:** реальный каталог и зеркало подразделений и сотрудников iiko (`README.md` § Environments).

**Чего нет намеренно:** своего домена (адрес `*.azurestaticapps.net`, `TODO.md` §1); `SITE_URL` стоит заглушкой до домена. Сотрудников с PIN и пользователей офиса владелец заводит сам (`TODO.md` §5): регистрация офиса на адрес `OFFICE_BOOTSTRAP_EMAIL`, PIN — в «Корпорация → Обмен данными с iiko → Доступ сотрудников к Sandyq POS».

**Что похоже на сбой, но им не является:** письма (сброс пароля, рассылки), SMS, карты 2GIS и телефония не подключены — ключи ещё не выданы (`TOKENS.md`, раздел «Not issued yet»); задания этих интеграций уходят в dead-letter. Cloud API для sandyq.kz без `CLOUD_API_SECRET` отвечает 503 «Cloud API не настроен».

Учётные записи и пароли production передаются только отдельным каналом. В этом файле их нет.

## Демо-стенд

Тот же фронтенд, собранный с `VITE_DEMO_MODE=true`, против dev-деплоя Convex (`docs/01-ONBOARDING.md` § Демо-фронтенд).

| Что | Адрес |
| --- | --- |
| **Офис** | https://jolly-pebble-06ed4d30f.1.azurestaticapps.net/office |
| **Касса (POS)** | https://jolly-pebble-06ed4d30f.1.azurestaticapps.net/pos |
| **Кухня (KDS)** | https://jolly-pebble-06ed4d30f.1.azurestaticapps.net/kitchen |
| Бэкенд: деплой Convex Cloud | `dapper-lobster-404` (dev) |
| Хостинг фронтенда | Azure Static Web App `sandyq-demo`, группа ресурсов `sandyq-dev` |

Касса и кухня демо сразу открывают терминал `shafran-09-01` (филиал «Шафран · пр. Абылай хана, 62»). Данные dev — синтетическая демо-сеть «Шафран» (`npm run seed:shafran`): адреса и часы работы филиалов публичные, меню, цены, сотрудники, гости и продажи вымышлены. Демо-доступ есть у любого, кто знает адрес.

### Демо-учётки

На экранах входа демо-стенда — кнопки ролей: вход по клику, вводить код и пароль не нужно. Учётки создаёт `npm run demo:logins`, только на dev. Пароль и PIN здесь не пишем.

| Роль | Где | Вход | Пароль / PIN | Что видит |
| --- | --- | --- | --- | --- |
| Кассир | Касса | код `70001` | `<PIN>` | Заказы, столы, оплата и смена |
| Менеджер | Касса | код `70002` | `<PIN>` | Касса плюс подтверждение отмен и скидок |
| Администратор | Касса | код `70003` | `<PIN>` | Полный доступ к кассе и её настройкам |
| Кухня | Кухня | код `70004` | `<PIN>` | Экран заказов для поваров |
| Администратор | Офис | `demo-admin@demo.oasis.kz` | `<password>` | Весь офис: меню, склад, финансы, отчёты, доступы |
| Управляющий рестораном | Офис | `demo-manager@demo.oasis.kz` | `<password>` | Один филиал: заказы, смены, склад, персонал, отчёты |

На production демо-учёток нет и быть не должно.

## Локальная машина

```bash
npm install
npx convex dev        # dev-деплой dapper-lobster-404
npm run seed          # данные для разработки, только dev
npm run dev           # фронтенд
```

Как получить доступ к офису и PIN кассы локально: `docs/01-ONBOARDING.md` и `docs/10-TESTING-GUIDE.md` §0.2.

## CI

GitHub Actions в `goecho-ai/sandyq`: `deploy-frontend.yml` (prod-фронтенд), `deploy-backend.yml` (`npx convex deploy` в prod), `deploy-demo-frontend.yml` (демо-фронтенд). Деплой — только push в `main` после зелёного `verify`; pull request только проверяется. Все три workflow работают на self-hosted раннерах `azure-linux` (Azure: AKS + Actions Runner Controller); минуты GitHub не расходуются.

## Где лежат настоящие секреты

В репозитории их нет. Имена и назначение — в [TOKENS.md](../TOKENS.md).

- Переменные окружения Convex, в дашборде Convex: деплой `dapper-lobster-404` (dev) и `clear-flamingo-97` (prod).
- Секреты репозитория GitHub `goecho-ai/sandyq` (Settings → Secrets and variables → Actions).
- Локальные файлы вне git: `.env`, `.env.local`, `iiko-credentials.md`.
- Токены развёртывания Azure Static Web Apps: портал Azure, приложения `sandyq-frontend` и `sandyq-demo`.

Доступ к дашбордам (Convex, GitHub, Azure): TODO(echo): перечислить, у кого он есть.
