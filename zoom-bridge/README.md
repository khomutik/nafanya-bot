# Nafanya Zoom Bridge

Мост между Zoom и Cloudflare Worker Нафани.

Сейчас это Docker-сервис с безопасной связью с Worker и двумя режимами Zoom:

- `stub` - проверяет связь с Worker, но не подтверждает исходящие сообщения как отправленные в Zoom.
- `meeting-sdk-process` - запускает отдельный процесс на базе Zoom Meeting SDK. Этот процесс входит в конференцию как участник и отправляет сообщения в чат. Именно этот режим нужен для настоящей автоматической отправки в Zoom без ручного копирования.

## Настройка

1. Скопировать `.env.example` в `.env` на сервере.
2. Вписать в `.env` реальный `ZOOM_BRIDGE_SECRET`.
3. Оставить `ZOOM_ADAPTER=stub`, пока нет собранного Zoom Meeting SDK-бота.
4. Запустить:

```bash
docker compose up -d --build
```

Порты наружу публиковать не нужно. Контейнер сам ходит к Worker, а healthcheck доступен только внутри контейнера.

## Zoom Marketplace

Покнопочная настройка Zoom webhook лежит в [ZOOM_MARKETPLACE_SETUP.md](ZOOM_MARKETPLACE_SETUP.md).

## Переменные окружения

- `WORKER_BASE_URL` - адрес Cloudflare Worker.
- `ZOOM_BRIDGE_SECRET` - секрет для заголовка `x-nafanya-zoom-secret`.
- `ZOOM_MEETING_URL` - постоянная ссылка Zoom.
- `ZOOM_BOT_NAME` - имя участника в Zoom.
- `ZOOM_ADAPTER` - `stub` или `meeting-sdk-process`.
- `ZOOM_SDK_BOT_COMMAND` - путь к исполняемому файлу Meeting SDK-бота для режима `meeting-sdk-process`.
- `ZOOM_SDK_BOT_ARGS` - аргументы Meeting SDK-бота, если нужны.
- `ZOOM_SDK_READY_TIMEOUT_MS` - сколько ждать входа SDK-бота в конференцию.
- `ZOOM_SDK_SEND_TIMEOUT_MS` - сколько ждать подтверждения отправки сообщения в чат.
- `POLL_INTERVAL_MS` - как часто забирать исходящие сообщения из Worker.
- `OUTBOX_LIMIT` - сколько сообщений брать за один запрос.
- `ZOOM_MESSAGE_LIMIT` - безопасный лимит длины одного сообщения.

## Проверки

```bash
npm run check
npm test
docker compose -f compose.example.yml config
```

## Протокол Meeting SDK процесса

Node-мост общается с SDK-ботом через `stdin/stdout`, по одной JSON-строке на сообщение.

Node отправляет:

```json
{"id":1,"type":"start","meetingUrl":"https://...","botName":"Нафаня (домовой бот)"}
{"id":2,"type":"sendMessage","text":"текст для чата Zoom"}
{"id":3,"type":"stop"}
```

SDK-бот отвечает:

```json
{"id":1,"type":"ready","ok":true}
{"id":2,"type":"sent","ok":true}
```

Если SDK-бот читает входящий чат Zoom, он может прислать:

```json
{"type":"message","text":"111","senderName":"Анна","senderRole":"guest"}
```

Такие сообщения мост передаст в Worker как входящие Zoom-команды.
