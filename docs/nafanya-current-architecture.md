# Текущая архитектура Нафани

Актуально на 11 августа 2026 года.

## Общая схема

```text
Telegram -> Cloudflare Worker -> Telegram API

Zoom App -> control agent -> Cloudflare Worker
                              |-> ZoomMeetingState -> outbox -> zoom-sender -> Zoom chat
                              `-> ZoomSharedTimerState -> общий таймер

Cloudflare Worker -> R2 -> книжная база
```

Worker хранит бизнес-логику и состояния. `zoom-sender` — тонкий транспорт: он забирает готовые сообщения из outbox, пишет их в Zoom и подтверждает `ackIds`.

Sender не читает и не толкует Zoom-чат. Старая очередь с автоматическим разбором `111/222/333/444` удалена.

## Публичная Zoom-only версия

Обезличенный комплект для других групп опубликован в открытом репозитории:

- <https://github.com/khomutik/nafanya-zoom>

В нём есть Worker, два раздельных Durable Object, R2-библиотека, Zoom App, sender, control agent, шаблоны конфигурации, инструкция установки и тесты. Telegram-кода, книжных текстов, рабочих ссылок, токенов, аккаунтов и браузерного профиля там нет.

## Активные каталоги

- `cloudflare-deploy` — production Worker, Durable Objects, R2-библиотека и регрессионные тесты.
- `zoom-sender` — Playwright-транспорт, health endpoint и control agent для Zoom App.

Старый каталог `zoom-bridge` удалён из репозитория. В production остаётся единственный транспорт — `zoom-sender`.

## Durable Objects

### `QUEUE_STATE`

Основная Telegram-очередь. Она не была удалена и не смешана с новой свободной Zoom-очередью.

### `ANNOUNCEMENT_STATE`

Объявления Telegram, ID опубликованных сообщений, личные подписки и служебные состояния рассылок. Частые Zoom-обращения сюда больше не попадают.

В нём оставлены только два внутренних export-действия для однократного переноса Zoom-состояний.

Успешная отправка Telegram-объявления больше не объявляется проваленной, если после неё временно не записался вспомогательный `message_id`: ошибка отметки сообщается отдельно, а уже отправленный текст не запускается повторно как якобы неотправленный.

### `ZOOM_MEETING_STATE`

Источник истины для:

- Zoom-outbox и счётчика ID;
- свободной очереди по дням недели;
- статусов `waiting` / `spoken`;
- дополнительных тем;
- спикерских вопросов;
- последних сформированных сообщений;
- `requestId`, защищающих от двойного нажатия.

Одинаковые записи обычной очереди разрешены. Каждая имеет свой внутренний ID.

### `ZOOM_SHARED_TIMER_STATE`

Общий таймер Zoom App: базовое время, остаток, пауза, статус, revision, однократный звук и краткая lease компьютера-исполнителя.

Панель перерисовывает цифры локально раз в 250 мс, но с сервером синхронизируется раз в 5 секунд. Это снижает нагрузку без видимых рывков отсчёта.

### Остальные

- `TIMER_STATE` — Telegram-таймер.
- `LIGHT_TALK_STATE` — краткая AI-беседа.

## Миграция Zoom-состояний

Первый вызов нового Durable Object получает `not_initialized`. Worker:

1. экспортирует соответствующую часть старого `ANNOUNCEMENT_STATE`;
2. атомарно записывает её в новый объект;
3. повторяет исходное действие.

Повторная инициализация не перезатирает живое состояние. Это проверяется отдельным регрессионным тестом.

## Активные Zoom-маршруты Worker

- `GET /zoom-only/app` — встроенный пульт.
- `POST /zoom-only/app/action` — кнопки, очередь, спикерская, литература и таймер.
- `GET /zoom-only/status` — защищённое состояние.
- `POST /zoom-only/outbox` — pull/ack для sender-а.
- `POST /zoom-only/library/import` и `GET /zoom-only/library/status` — библиотека R2.
- `POST /zoom/events` — проверяемый Marketplace webhook.

`/zoom-only/webhook` и `/zoom-only/chat-ingest` оставлены как безвредные совместимые заглушки: после авторизации они отвечают `queue_paused` и не меняют состояние.

Неудачный лабораторный мост Meeting Chat → Team Chat удалён из runtime-кода и конфигурации. Совместимые маршруты `/zoom-only/team-chat/*` временно отвечают `410 team_chat_test_retired`, чтобы старый тестовый клиент завершался явно, а не пытался участвовать в боевой работе.

Удалены и должны отвечать `404`:

- `/zoom/outbox`;
- `/zoom/debug`;
- `/zoom/app/action`;
- `/zoom-only/reset`.

## Книжная база

Опубликованная база лежит в приватном R2 как JSON. Папка Obsidian на компьютере нужна для редактирования и новых импортов; бот не читает её во время собрания.

Итоговые Zoom-сообщения ограничены 950 Unicode-символами. Текст делится по границам предложений, без служебной нумерации частей.

## Проверки перед деплоем

Из `cloudflare-deploy`:

```bash
npm run test:zoom-panel
npm run test:queue
npm run test:zoom-library
npm run test:regression-static
wrangler deploy --dry-run
```

Из `zoom-sender`:

```bash
npm test
```

После деплоя:

- Worker status отвечает;
- sender health: `status=healthy`, `zoomJoined=true`, `chatOpen=true`;
- control health: `ok=true`;
- `outboxSize=0`, если нет ожидающих сообщений;
- старые destructive-маршруты отвечают `404`;
- chat-ingest отвечает `queue_paused`.

Полный live-тест `npm test` в `cloudflare-deploy` дополнительно читает живые Google Sheets. Его ошибку из-за пустого или изменившегося расписания нельзя выдавать за регрессию Zoom-кода; для этого есть отдельный детерминированный `test:regression-static`.
