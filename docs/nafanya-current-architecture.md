# Текущая архитектура Нафани

## 1. Короткая схема

```text
Telegram -> Cloudflare Worker /webhook -> message_handlers.js -> queue logic -> Telegram reply

Zoom bridge -> Worker /zoom-only/webhook -> Zoom-only queue logic -> Zoom-only outbox
Zoom bridge <- Worker /zoom-only/outbox <- Zoom-only outbox

Legacy Zoom bridge -> Worker /zoom/webhook -> shared queue/meeting commands -> Telegram + legacy Zoom outbox
Legacy Zoom bridge <- Worker /zoom/outbox <- legacy Zoom outbox

Zoom App -> Worker /zoom/app/action или /zoom-only/app/action -> same command handlers -> outbox/direct response
```

Главная мысль: мозг Нафани живет в Cloudflare Worker. Старый Zoom-мост был только транспортом: читать Zoom-чат, отправлять входящие команды в Worker, забирать outbox и писать ответы обратно в Zoom.

## 2. Cloudflare Worker

Папка: `cloudflare-deploy`.

Основная точка входа: `cloudflare-deploy/worker.mjs`.

Конфиг деплоя: `cloudflare-deploy/wrangler.jsonc`.

Важные файлы:

- `worker.mjs` - главный production Worker, маршруты, Durable Objects, Zoom routes, queue engine, cron.
- `message_handlers.js` - Telegram message/update логика верхнего уровня.
- `callback_handlers.js` - Telegram inline-кнопки и панели, включая открытие очередей.
- `telegram_api.js` - отправка сообщений, редактирование, удаление, copyMessage, Telegram retry.
- `state_clients.js` - короткие клиенты к Durable Objects.
- `zoom_meeting_texts.js` - JS-каталог Zoom-текстов.
- `message_zoom.md` - Markdown-источник Zoom-текстов.
- `regression_tests.mjs` - тесты на маршруты, очереди, Zoom-only, парсинг команд.
- `speaker_questions.json` - локальная копия вопросов игры.

Деплой:

- Wrangler берет `main: "worker.mjs"` из `wrangler.jsonc`.
- Обычная команда по README: `wrangler deploy`.
- В этой задаче деплой не выполнялся.

Durable Objects:

- `QUEUE_STATE` -> `QueueStateDurableObject`: основная Telegram/shared очередь.
- `ANNOUNCEMENT_STATE` -> `AnnouncementStateDurableObject`: объявления, outbox, Zoom-only состояние, личные подписки, служебные состояния.
- `TIMER_STATE` и `LIGHT_TALK_STATE`: таймер и легкая беседа, не ядро Zoom v2.

## 3. Telegram

Где принимается Telegram update:

- `worker.mjs`, маршрут `POST /webhook`.
- Внутри `handleWebhookUpdate()` берется `callback_query` или обычное сообщение.
- Callback уходит в `callback_handlers.js`.
- Message уходит в `message_handlers.js` через `handleWebhookMessage()`.

Где парсятся команды:

- `message_handlers.js`:
  - `handleWebhookMessage()` - общий вход.
  - `handleServiceMessages()` - служебные команды, панели, Билл.
  - `handleGroupQueueAndGameMessage()` - очередь и игра.
  - `handleManualQueueAdminCommand()` - ручное админ-добавление/удаление.
  - `handleConversationMessage()` - обычные вопросы/ответы Нафани.
- `worker.mjs`:
  - `parseGameCommand()`.
  - `parseQueueEntry()`.
  - `parseBillQueueEntry()`, `parseBkQueueEntry()`, `parseRsQueueEntry()`.
  - `parseBillInput()`.

Где отправляются ответы в Telegram:

- `telegram_api.js`:
  - `sendMessage()`.
  - `editMessageText()`.
  - `deleteMessageSafe()`.
  - `copyTechMessageToGroup()` / `copyTechMessageToChat()`.
  - `callTelegram()`.

Где хранится состояние Telegram-очереди:

- `QueueStateDurableObject` в `worker.mjs`.
- Доступ к нему идет через `state_clients.js` -> `callQueueState(env, action, payload)`.
- Имя Durable Object: `QUEUE_STATE`, singleton `main`.

## 4. Очереди

Основной queue engine находится в `cloudflare-deploy/worker.mjs`.

Ключевые функции:

- `createEmptyQueueState()` - пустое состояние.
- `parseQueueEntry()` - общий вход для парсинга заявки.
- `parseBillQueueEntry()` - режим Билл.
- `parseBkQueueEntry()` - режим БК.
- `parseRsQueueEntry()` - режим рабочка / rs.
- `addQueueEntryToState()` - добавление и сортировка.
- `isDuplicatePendingQueueEntry()` и `isDuplicatePendingBillSpeechEntry()` - защита от дублей.
- `buildQueueText()` - текст очереди для Telegram.
- `buildZoomOnlyQueueText()` - текст очереди для Zoom-only.
- `applyQueueResponse()` - публикация общей очереди в Telegram.
- `applyZoomOnlyQueueResponse()` - публикация Zoom-only очереди в Zoom outbox.

Режимы:

- `bill` - Билл. Поддерживает `111`, `222`, `333`, `444`, игру и блоки очереди.
- `bk` - БК. Ловит `111 ...` и сохраняет хвост как пометку, например `111 читать`, `111 высказаться`.
- `rs` - рабочка. Использует похожую логику `111/222/333/444`, но как отдельный режим.

Команды и действия:

- `111 / 222 / 333 / 444` - распознаются через `getQueueSpeechCodeNote()`.
- `111 читать`, `111 высказаться` - сохраняются как текстовая пометка в БК/rs.
- `игра X` - распознается через `getBillQuestionNumber()` / `parseGameCommand()`, диапазон 1-500.
- `высказался` - действие `done`.
- `пропускает` - действие `skip`.
- `отменить` - действие `undo`.
- `удалить` / `убери` - ручное удаление, в том числе `remove_by_number`.
- `закрыть очередь` - действие `close`.

Отображение имени участника:

- Telegram-имя берется через `getAuthorLabel()`.
- Zoom-имя берется через `getZoomPayloadDisplayName()`.
- `cleanQueueDisplayName()` убирает Telegram handles и хвосты вроде `(Telegram)` / `(Zoom)`.
- В текущем отображении очереди `buildQueueText()` показывает `entry.author — entry.label`; источник явно не выводится в строке.

Где источник Telegram/Zoom убран или используется:

- При создании entry передается `source`, например `source: "Telegram"` или `source: "Zoom"`.
- Но `makeQueueEntry()` сейчас не сохраняет `source` в объект entry.
- Поэтому в опубликованной очереди источник фактически не показывается.
- Для Zoom v2 это важный момент: если нужна явная маркировка источника, entry-модель придется расширить.

## 5. Zoom-only

Worker-файлы:

- `worker.mjs` - вся серверная логика Zoom/Zoom-only.
- `zoom_meeting_texts.js` - тексты для команд.
- `message_zoom.md` - исходник текстов.
- `regression_tests.mjs` - проверки Zoom-only маршрутов и поведения.

Основные Zoom-only маршруты Worker:

- `GET /zoom-only/app` - Zoom-only control surface.
- `POST /zoom-only/app/action` - команды из Zoom App.
- `POST /zoom-only/webhook` - входящие сообщения из старого bridge.
- `POST /zoom-only/outbox` - bridge забирает исходящие сообщения и подтверждает доставку.
- `GET/POST /zoom-only/status` - компактный статус.
- `POST /zoom-only/reset` - очистка Zoom-only состояния.

Где лежит outbox:

- В `AnnouncementStateDurableObject`.
- Поля:
  - `zoomOnlyOutbox`.
  - `zoomOnlyOutboxNextId`.
  - legacy: `zoomOutbox`, `zoomOutboxNextId`.

Как Zoom-мост забирал исходящие сообщения:

- `zoom-bridge/src/worker-client.mjs`.
- В режиме `zoom-only` он ходит на `/zoom-only/outbox`.
- В legacy-режиме он ходит на `/zoom/outbox`.
- Запрос включает `ackIds` и `limit`.
- Worker возвращает список `{ id, text }`, bridge отправляет их в Zoom и потом подтверждает ack.

Как Zoom-мост передавал входящие сообщения:

- `zoom-bridge/src/main.mjs` получает входящее сообщение от adapter.
- Потом вызывает `workerClient.sendIncomingMessage(payload)`.
- `worker-client.mjs` отправляет payload на:
  - `/zoom-only/webhook` в Zoom-only режиме;
  - `/zoom/webhook` в legacy-режиме.

Legacy Zoom endpoints:

- `POST /zoom/webhook`.
- `POST /zoom/outbox`.
- `POST /zoom/debug`.
- `GET /zoom/app`.
- `POST /zoom/app/action`.
- `POST /zoom/events` - отдельный Zoom Marketplace webhook с проверкой подписи.

## 6. Тексты сообщений

Основные файлы:

- `cloudflare-deploy/message_zoom.md` - человекочитаемый Markdown-источник.
- `cloudflare-deploy/zoom_meeting_texts.js` - сгенерированный JS-каталог.
- В корне `AI-ПН/message_zoom.md` есть отдельный файл с похожим назначением; активный Worker импортирует именно файл из `cloudflare-deploy`.

Генератор:

- В текущей рабочей папке отдельный генератор не найден.
- В `zoom_meeting_texts.js` есть пометка: `Generated from message_zoom.md. Keep source Markdown in sync when texts change.`
- Значит генерация была, но скрипт генерации либо не сохранен в активной папке, либо лежит вне текущего deploy-surface.

Как команда связывается с текстом:

- В `worker.mjs` есть `ZOOM_MEETING_COMMANDS`.
- Примеры:
  - `молитва` -> `prayer`.
  - `темы`, `тема`, `темы собрания` -> `today_topic`.
  - `расписание` -> `meeting_schedule`.
  - `ссылки` -> `telemost_link`.
- `getZoomMeetingMessages(key)` берет текст из `ZOOM_MEETING_MESSAGE_TEXTS`.
- Для `today_topic` используется день недели:
  - `ZOOM_TOPIC_MESSAGE_KEYS_BY_WEEKDAY`.
  - `TODAY_TOPIC_MESSAGES`.

Как текст отправляется:

- В shared/legacy Zoom логике: `enqueueZoomMessages()`.
- В Zoom-only логике: `enqueueZoomOnlyMessages()`.
- Длинные тексты режутся через `splitZoomText()`.

## 7. Polling и лимиты

Старый Zoom bridge находится в `zoom-bridge`.

Главный polling исходящих сообщений:

- `zoom-bridge/src/main.mjs`.
- `setInterval(pollOnce, config.pollIntervalMs)`.
- Значение по умолчанию в `src/config.mjs`: `POLL_INTERVAL_MS = 1500`.
- На каждом тике bridge дергает Worker `/zoom-only/outbox` или `/zoom/outbox`.
- После отправки сообщений bridge второй раз дергает outbox с `ackIds`, чтобы подтвердить доставку.

Polling входящего Zoom-чата:

- `zoom-bridge/src/adapters/zoom-web-client.mjs`.
- `setInterval(pollChat, Math.max(1000, config.pollIntervalMs))`.
- Читает DOM Zoom-чата через Playwright/Chromium.
- Дедуплицирует сообщения через seen/recent keys.
- Подавляет собственные ответы через `shouldIgnoreZoomMessage()`, `looksLikeOwnZoomOutput()`, `rememberSentText()`, `hasRecentSentText()`.

Backoff:

- Для outbox polling в `main.mjs` полноценного backoff не видно: ошибка логируется, следующий тик идет по тому же интервалу.
- Для Zoom web client есть reconnect delay через `ZOOM_RECONNECT_DELAY_MS`, по умолчанию 5000 мс, но это не снижает частоту запросов к Worker outbox.

Почему это могло жрать Cloudflare request limit:

- Даже когда сообщений нет, bridge каждые ~1.5 секунды ходит в Worker за outbox.
- Это примерно 40 запросов в минуту, около 2400 в час, около 57 600 в сутки на один постоянно работающий bridge, без учета ack-запросов и входящих webhook.
- Отдельно DOM-polling Zoom-чата сам по себе Cloudflare не дергает, но при найденных входящих командах отправляет запросы в Worker.
- Главный пожиратель Cloudflare-запросов: частый outbox polling без backoff/long polling/push-механизма.

## 8. Docker/Compose

Локальная папка: `zoom-bridge`.

Серверная папка, найденная безопасным чтением: `/home/masha/nafanya-zoom-bridge`.

Compose-файл:

- Локально: `zoom-bridge/compose.example.yml`.
- На сервере: `/home/masha/nafanya-zoom-bridge/compose.example.yml`.
- Отдельный `docker-compose.yml` для bridge в найденной папке не обнаружен.

Сервис:

- `nafanya-zoom-bridge`.

Контейнер:

- `nafanya-zoom-bridge`.

Restart policy:

- `unless-stopped`.

Healthcheck:

- Команда: `node src/healthcheck.mjs`.
- Интервал: 30s.
- Timeout: 5s.
- Retries: 3.
- Start period: 20s.

Что healthcheck проверяет:

- `src/healthcheck.mjs` делает HTTP GET на локальный `/health`.
- `src/health-server.mjs` считает сервис здоровым, если:
  - `state.workerConnected === true`;
  - `state.fatalError === null`.

Что healthcheck НЕ проверяет:

- Что Нафаня реально находится в Zoom-конференции.
- Что чат Zoom открыт.
- Что Нафаня может отправить сообщение в Zoom.
- Что Нафаня читает входящие сообщения Zoom.
- Что Zoom-аккаунт залогинен.
- Что Chromium/DOM-reader не завис в промежуточном состоянии.

## 9. Что переиспользовать для Zoom v2

Хорошие кандидаты:

- Queue engine из `worker.mjs`:
  - парсеры `parseQueueEntry()`, `parseBillQueueEntry()`, `parseBkQueueEntry()`, `parseRsQueueEntry()`;
  - состояние очереди;
  - действия `open`, `add`, `done`, `skip`, `undo`, `remove`, `remove_by_number`, `close`;
  - дедупликация;
  - сортировка Билл-блоков.
- Тексты сообщений:
  - `message_zoom.md`;
  - `zoom_meeting_texts.js`;
  - `ZOOM_MEETING_COMMANDS`;
  - `getZoomMeetingMessages()`;
  - `splitZoomText()`.
- Команды:
  - `молитва`, `темы`, `расписание`, `ссылки`;
  - `111/222/333/444`;
  - `111 читать`, `111 высказаться`;
  - `игра X`;
  - админ-команды очереди.
- Тесты:
  - `cloudflare-deploy/regression_tests.mjs`;
  - `zoom-bridge/test/worker-client.test.mjs`;
  - `zoom-bridge/test/zoom-web-client.test.mjs` как исторический набор кейсов дедупликации.
- State/storage:
  - `QueueStateDurableObject` для общей очереди.
  - `AnnouncementStateDurableObject` для outbox и Zoom-only состояния, если нужна минимальная миграция.
- Outbox как идея:
  - id + text + ackIds полезны.
  - Но транспорт polling лучше заменить.
- Telegram-часть:
  - webhook/update обработка;
  - отправка ответов;
  - панели и callback-кнопки;
  - публикация очереди в Telegram.

## 10. Что заменить

Лучше не переиспользовать как есть:

- Старый `zoom-bridge` как монолит.
- DOM-reading Zoom-чата через Chromium/Playwright как основной источник событий.
- Частый outbox polling каждые ~1.5 секунды без backoff.
- Healthcheck, который проверяет только связь с Worker, но не проверяет фактическое присутствие/работоспособность Нафани в Zoom.
- Две почти параллельные модели shared Zoom и Zoom-only без четкого общего интерфейса.
- Неявное поле `source`: сейчас источник передается в парсеры, но не сохраняется в entry и не отображается.

Для Zoom v2 лучше:

- Оставить Worker как мозг.
- Выделить queue engine в более явный слой.
- Сделать Zoom adapter тонким транспортом, без DOM-археологии.
- Заменить polling на push/webhook/длинный polling/backoff, чтобы не пилить Cloudflare лимиты.
- Сделать healthcheck, который проверяет не только Worker, но и реальную Zoom-готовность.

## 11. Открытые вопросы

- Нужна ли Zoom v2 одна общая очередь с Telegram или отдельная Zoom-only очередь?
- Нужно ли явно показывать источник `Telegram` / `Zoom` в очереди? Сейчас источник не сохраняется в entry.
- Какой транспорт Zoom v2 будет основным: Zoom Marketplace events, Zoom App, Meeting SDK, Server-to-Server, другой мост?
- Нужно ли сохранять legacy `/zoom/*` маршруты или оставить только `/zoom-only/*`/новые v2 endpoints?
- Где должен жить генератор `message_zoom.md -> zoom_meeting_texts.js`, если тексты будут часто правиться?
- Какая минимальная проверка здоровья Zoom v2 считается достаточной: залогинен, в конференции, видит чат, может отправить тестовое сообщение, получает входящие?
- Нужна ли миграция существующего Zoom-only состояния или можно начать v2 с чистого состояния?
