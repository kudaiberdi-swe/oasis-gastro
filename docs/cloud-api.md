# Cloud API — контракт для сайта sandyq.kz

W3-INT-03 / W3-INT-04, решение владельца Г-9: первый и пока единственный потребитель — сайт sandyq.kz
(меню, стоп-лист, заказы доставки). Код: `convex/http.ts`, `convex/lib/hmac.ts`,
`convex/domains/integrations/{cloudApi,externalMenu}.ts`, `convex/domains/integrations/adapters/cloudApiWebhook.ts`.
Секретов в этом документе нет и быть не должно.

## Адрес

`https://<деплой>.convex.site` — HTTP-домен Convex-деплоя (не `.convex.cloud`). Для прода — домен деплоя
`clear-flamingo-97`.

## Переменные окружения деплоя

| Переменная | Назначение | Если не задана |
| --- | --- | --- |
| `CLOUD_API_SECRET` | Общий секрет HMAC для входящих запросов и исходящих вебхуков | Все маршруты `/api/v1/*` отвечают **503** `{"error":"Cloud API не настроен"}` — API закрыт, а не открыт |
| `CLOUD_API_WEBHOOK_URL` | Адрес сайта для вебхуков (статусы заказов, публикация меню) | Задания вебхуков в очереди интеграций падают с причиной «Вебхук Cloud API не настроен» и уходят в dead-letter |

Секрет хранится только в env, не в базе и не в Office (карточка Cloud API показывает лишь «задан / не задан»).
Ротация: `scripts/rotate-cloud-api-secret.sh --prod` (новый секрет в локальный файл `.cloud-api-secret.txt`,
в терминал не печатается; файл передать администратору сайта по защищённому каналу и удалить).

## Подпись запроса

Каждый запрос несёт заголовки:

- `x-sandyq-timestamp` — Unix-время в **миллисекундах** (13 цифр);
- `x-sandyq-signature` — hex HMAC-SHA256 (можно с префиксом `sha256=`) от строки

```
<timestamp>.<METHOD>.<path и query>.<тело>
```

Например, для `GET /api/v1/menu?restaurant=almaty` с пустым телом подписывается
`1790000000000.GET./api/v1/menu?restaurant=almaty.`. Метод и путь входят в подпись, чтобы подпись одного
запроса нельзя было применить к другому ресторану или маршруту.

Проверки по порядку:

1. тело не больше 256 КБ — иначе **413**;
2. секрет задан — иначе **503**;
3. заголовки есть и время в окне **±5 минут** от часов сервера — иначе **401**;
4. подпись верна (сравнение за постоянное время) — иначе **401**;
5. подпись ещё не использовалась — иначе **409** «Повтор запроса». Каждая подпись принимается один раз
   (таблица `apiNonces`, чистится кроном каждые 30 минут). Повтор запроса = новая подпись с новым временем.

Пример (shell, секрет берётся из окружения выполняющего):

```sh
TS=$(($(date +%s) * 1000))
PATH_Q='/api/v1/menu?restaurant=<ресторан>&channel=website'
SIG=$(printf '%s' "$TS.GET.$PATH_Q." | openssl dgst -sha256 -hmac "$CLOUD_API_SECRET" -hex | sed 's/^.* //')
curl -s "https://<деплой>.convex.site$PATH_Q" -H "x-sandyq-timestamp: $TS" -H "x-sandyq-signature: $SIG"
```

Ошибки всегда JSON `{"error": "<текст>"}` без стека; тексты — те же, что видит оператор в Office.

## Маршруты

### `GET /api/v1/menu?restaurant=<externalId>&channel=website`

Меню ресторана. `channel`: `website` (по умолчанию), `mobile-app`, `aggregators`, `all`.

- Ресторан должен быть активен и обслуживаться источником «Сайт sandyq.kz» (`source-website`,
  раздел «Источники заказов») — иначе **404**.
- Если у канала есть опубликованная запись «Внешнего меню» в режиме «Опубликованная версия» — отдаётся её
  последний снимок для ресторана (`source: "published"`). Иначе (режим «Живое меню», ничего не опубликовано,
  публикация снята) — текущий каталог (`source: "live"`).

```json
{
  "restaurant": { "externalId": "almaty", "name": "…" },
  "channel": "website",
  "source": "published",
  "menuExternalId": "external-menu-…",
  "version": "3f9c0a1b2c3d4e5f",
  "publishedAt": 1790000000000,
  "generatedAt": 1790000000000,
  "currency": "KZT",
  "categories": [{ "externalId": "hot", "name": "Горячее", "nameKk": null, "parentExternalId": null, "sortOrder": 1 }],
  "items": [{
    "externalId": "…", "name": "Бешбармак", "nameKk": "Бешбармақ", "description": null,
    "categoryExternalId": "hot", "price": 3200, "imageUrl": null,
    "sizes": [{ "externalId": "…", "name": "Большой", "nameKk": null, "price": 4200, "isDefault": false, "available": true }],
    "modifierGroups": [{ "externalId": "…", "name": "…", "nameKk": null, "required": false, "minQuantity": 0, "maxQuantity": 3, "freeQuantity": 0,
      "options": [{ "externalId": "…", "name": "…", "nameKk": null, "price": 300, "minQuantity": 0, "maxQuantity": 2, "defaultQuantity": 0, "freeQuantity": 0, "available": true }] }]
  }]
}
```

- Только позиции, включённые для кассы (`enabled`); выключенной позиции в меню нет.
- Цены — целые тенге, через то же правило, что на кассе (`resolvePrice`: цена iiko-оверлея → действующий
  приказ о ценах → цена филиала → базовая × коэффициент размера). Живое меню = цены кассы в тот же момент.
  Опубликованный снимок хранит цены на момент публикации; при оформлении заказа цена всегда пересчитывается
  сервером, итог приходит в ответе на заказ.
- `version` — хеш содержимого: тот же каталог и цены дают ту же версию.

### `GET /api/v1/stop-lists?restaurant=<externalId>`

Стоп-лист ресторана сейчас: `{"restaurantExternalId": "almaty", "generatedAt": …, "items": [{"productExternalId": "…", "until": null}]}`.
`until` — до какого момента (мс) позиция недоступна, `null` — до снятия вручную.

### `POST /api/v1/delivery/orders`

```json
{
  "orderId": "site-1001",
  "restaurantExternalId": "almaty",
  "customerName": "Айгерим",
  "phone": "+7 701 123 45 67",
  "email": "guest@example.kz",
  "address": "Абая 10, кв. 5",
  "latitude": 43.25, "longitude": 76.9,
  "expectedAt": 1790003600000,
  "comment": "Позвонить за 10 минут",
  "lines": [{ "productExternalId": "…", "quantity": 2, "sizeExternalId": "…", "modifierSelections": [{ "modifierExternalId": "…", "quantity": 1 }] }]
}
```

- Создаёт заказ доставки той же функцией, что форма Office (`writeDeliveryOrder`, W2-DLV-02): цены из каталога,
  стоп-лист, модификаторы, зона по координатам (минимальная сумма, стоимость доставки), номер `DEL-…`,
  статус «Не обработан», аудит от имени `api:source-website`. Оплата — при получении (онлайн-оплаты пока нет).
- `orderId` — id заказа на стороне сайта (1–64 символа: буквы, цифры, `.`, `:`, `-`, `_`), ключ идемпотентности:
  первый запрос → **201**, повтор с тем же `orderId` → **200** с тем же заказом и `"duplicate": true`.
- `sourceExternalId` — необязательно, по умолчанию `source-website`; допускаются только источники типа
  «Сайт», «Приложение», «Агрегатор».
- Ответ: `{"orderId": "site-1001", "externalId": "delivery-…", "number": "DEL-000001", "status": "unprocessed", "total": 2500, "duplicate": false}`.
- Ошибки проверки → **400** с текстом: «Минимальная сумма для зоны «Центр»: 1500 ₸», ««Бешбармак» сейчас нет в
  наличии», «Время доставки уже прошло», «Некорректное поле lines[0]» и т. п.

### `POST /api/v1/webhooks/<провайдер>`

Входящее событие (`<провайдер>` — `a-z0-9-`, 2–40 символов). Тело — JSON с `eventId` (или заголовок
`x-idempotency-key`) и необязательным `type`. Событие становится входящим заданием очереди интеграций
(`/office/integration-jobs`) один раз на `eventId`: **202** — принято, **200** — уже было. Обработчиков
входящих событий пока нет — задание честно уходит в dead-letter «Адаптер не настроен».

## Вебхуки на сайт

События из транзакционного outbox превращаются в задания очереди интеграций с провайдером `cloud-api`
(повторы с экспоненциальной задержкой, 5 попыток, затем dead-letter; видно в «Очереди интеграций»).
Запрос: `POST <CLOUD_API_WEBHOOK_URL>` с телом JSON и заголовками `x-sandyq-timestamp`,
`x-sandyq-signature` (та же схема подписи и тот же секрет; путь — путь из `CLOUD_API_WEBHOOK_URL`),
`x-sandyq-event-id`. Сайт отвечает 2xx — задание завершено; иначе — повтор.

- `delivery-order.status` — смена статуса заказа, пришедшего через API:
  `{"event": "delivery-order.status", "eventId": "…", "orderId": "site-1001", "externalId": "delivery-…", "number": "DEL-000001", "status": "waiting", "previousStatus": "unprocessed", "occurredAt": …}`.
  Статусы: `unprocessed`, `unconfirmed`, `waiting`, `ready-to-cook`, `cooking`, `cooked`, `awaiting-dispatch`,
  `on-way`, `delivered`, `closed`, `cancelled`.
- `external-menu.published` — новая версия меню канала `website` или `all` для ресторана:
  `{"event": "external-menu.published", "eventId": "…", "menuExternalId": "…", "channel": "website", "version": "…", "restaurantExternalId": "almaty", "publishedAt": …}`.

## Внешнее меню (Office → «Обмен и интеграции» → «Внешнее меню»)

Запись: название, канал, режим («Опубликованная версия» / «Живое меню»), рестораны («Все рестораны» — только
пользователю сети). «Опубликовать меню» (право `office.external-menu.approve`) снимает меню каждого ресторана;
если каталог и цены не менялись, версия (хеш) та же и новая строка истории не появляется. «Снять с
публикации» возвращает канал на живое меню.
