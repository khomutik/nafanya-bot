# Nafanya Zoom Bridge

Мост между Zoom и Cloudflare Worker Нафани.

Сейчас это готовый Docker-сервис с безопасной связью с Worker и stub-адаптером Zoom. Stub-режим нужен до настройки Zoom Marketplace / SDK: контейнер уже проверяет связь с Worker и видит исходящие сообщения, но не подтверждает их как отправленные в Zoom, чтобы не потерять сообщения в пустоту.

## Настройка

1. Скопировать `.env.example` в `.env` на сервере.
2. Вписать в `.env` реальный `ZOOM_BRIDGE_SECRET`.
3. Оставить `ZOOM_ADAPTER=stub`, пока нет Zoom SDK-ключей.
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
- `ZOOM_ADAPTER` - сейчас поддерживается только `stub`.
- `POLL_INTERVAL_MS` - как часто забирать исходящие сообщения из Worker.
- `OUTBOX_LIMIT` - сколько сообщений брать за один запрос.
- `ZOOM_MESSAGE_LIMIT` - безопасный лимит длины одного сообщения.

## Проверки

```bash
npm run check
npm test
docker compose -f compose.example.yml config
```
