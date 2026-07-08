# Zoom Sender v2

Zoom Sender v2 - отдельный отправитель сообщений из Нафаниного Zoom-only outbox в чат Zoom.

## Что он делает

1. забрать сообщения из `/zoom-only/outbox`;
2. отправить их в Zoom-чат;
3. подтвердить доставленные сообщения через `ackIds`;
4. показать честный `/health`.

## Чего он НЕ делает

- не читает входящие сообщения из Zoom;
- не вызывает `/zoom-only/webhook`;
- не парсит `111`, `222`, `333`, `444`;
- не управляет очередью;
- не смешивает Telegram и Zoom;
- не заменяет старый Worker.

То есть это не старый `zoom-bridge` в новом пальто. Это маленький отправитель: взял письмо, отнес в Zoom, отметился.

## Почему он не жрет лимиты Worker

Если outbox пустой, sender не ходит к Worker каждые 1.5 секунды бесконечно. Он увеличивает паузу и в тишине уходит к 15-30 секундам. После новых сообщений снова ускоряется.

## Как запустить тесты

```bash
npm test
```

## Как запустить dry-run локально

Dry-run ничего не отправляет в реальный Zoom.

```bash
copy .env.example .env
npm run dry-run
```

В dry-run можно использовать mock-outbox, чтобы вообще не ходить в Worker:

```bash
set ZOOM_SENDER_DRY_RUN=true
set ZOOM_SENDER_MOCK_OUTBOX=true
node src/main.mjs
```

## Как собрать Docker-образ локально

```bash
docker build -t nafanya-zoom-sender-v2 .
```

## Как запустить через Docker Compose локально в dry-run

1. Скопировать `.env.example` в `.env`.
2. Оставить `ZOOM_SENDER_DRY_RUN=true`.
3. Запустить:

```bash
docker compose -f compose.example.yml up --build
```

## Почему real-режим пока не запускать без отдельного шага

Real-режим открывает браузер, заходит в Zoom и реально пишет в чат. Это уже действие в живой встрече, поэтому сначала нужен отдельный шаг: проверить `.env`, доступы, waiting room, имя участника, health и только потом включать.

## Health

Проверка:

```bash
curl http://127.0.0.1:3097/health
```

Как читать:

- `healthy` - Worker доступен, Zoom-страница открыта, бот вошел, чат открыт;
- `warning` - процесс жив, но Zoom/чат еще не готовы;
- `unhealthy` - связи с Worker или Zoom нет, либо была ошибка.

Health не должен показывать `healthy`, если готов только Worker. Это была бы не диагностика, а бодрый самообман с бейджиком.

## Docker/Compose

- `Dockerfile` собирает контейнер с Node.js, Playwright и Chromium.
- `compose.example.yml` показывает будущий сервис `zoom-sender`, healthcheck и volume для браузерного профиля.
- `.env.example` содержит только безопасные пустые примеры. Секреты живут только в `.env`.

Подробный серверный порядок лежит в `RUNBOOK.md`.
