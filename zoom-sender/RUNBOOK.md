# Zoom Sender v2: серверный runbook

Этот файл для будущего запуска на сервере. В этой задаче сервер не трогаем.

## 1. Подготовить .env

1. Скопировать `.env.example` в `.env`.
2. Заполнить реальные значения только в `.env`.
3. Не отправлять `.env` в чат, GitHub, логи или скриншоты.

Что должна дать Маша или админ:

- адрес Worker: `WORKER_BASE_URL`;
- секрет для Zoom-only outbox: `ZOOM_ONLY_SECRET`;
- ссылку на Zoom-встречу: `ZOOM_MEETING_URL`;
- имя участника: `ZOOM_DISPLAY_NAME`;
- режим браузера: `HEADLESS`;
- порт healthcheck, если нужен не стандартный `3097`.

## 2. Собрать контейнер

```bash
docker compose -f compose.example.yml build
```

## 3. Первый запуск только dry-run

В `.env` оставить:

```bash
ZOOM_SENDER_DRY_RUN=true
```

Потом:

```bash
docker compose -f compose.example.yml up
```

Dry-run нужен, чтобы проверить упаковку, связь с Worker и `/health` без реального Zoom. Это как репетиция без микрофона: видно, где спотыкаемся, но никого в чате не пугаем.

## 4. Посмотреть логи

```bash
docker compose -f compose.example.yml logs -f zoom-sender
```

В логах не должно быть секретов. Если видишь токен или секрет - остановить и чинить.

## 5. Проверить health

```bash
curl http://127.0.0.1:3097/health
```

Как читать:

- `healthy` - Worker доступен, Zoom-страница открыта, бот в комнате, чат открыт;
- `warning` - процесс живой, но Zoom или чат еще не готовы;
- `unhealthy` - нет связи с Worker, браузером или другая ошибка.

Важно: один только доступный Worker не считается здоровьем. Health не должен врать "healthy", если Zoom/чат не готовы.

## 6. Остановить контейнер

```bash
docker compose -f compose.example.yml down
```

## 6.1. Один раз авторизовать Zoom-профиль

Если Zoom отправляет Нафаню на Sign In, нужен отдельный профиль браузера:

```bash
ZOOM_AUTH_SETUP=true
ZOOM_AUTH_WAIT_FOR_MANUAL=true
```

Также в серверный `.env` добавить `ZOOM_AUTH_EMAIL` и `ZOOM_AUTH_PASSWORD`. Реальные значения не писать в чат, README, issue, логи или скриншоты.

Запускать setup лучше отдельным одноразовым запуском контейнера, а после успешного входа вернуть:

```bash
ZOOM_AUTH_SETUP=false
```

Профиль сохраняется в volume `zoom-sender-profile:/app/profile`. Его нельзя коммитить, копировать в GitHub или отправлять куда-либо целиком: внутри могут быть cookies/session.

Если Zoom попросит 2FA, captcha или email confirmation - остановиться и пройти подтверждение вручную. Не пытаться обходить это кодом.

## 7. Отключить автозапуск

В compose поменять:

```yaml
restart: "no"
```

После этого пересоздать контейнер.

## 8. Если health warning/unhealthy

Проверить по порядку:

1. заполнен ли `.env`;
2. доступен ли Worker;
3. правильный ли `ZOOM_ONLY_SECRET`;
4. открылась ли Zoom-страница;
5. пустили ли участника из waiting room;
6. открыт ли чат;
7. не уперлись ли в ошибку Playwright/Chromium.

## 9. Чего нельзя делать

- Не запускать старый `zoom-bridge` вместе с новым sender.
- Не включать real-режим без отдельного шага и проверки.
- Не вставлять секреты в README, compose или Dockerfile.
- Не использовать sender для обработки входящего Zoom-чата без отдельной задачи.
- Не дергать Worker каждые 1.5 секунды в тишине: backoff должен уходить к 15-30 секундам.

## 10. Что делает sender

Sender-only забирает исходящие сообщения из `/zoom-only/outbox`, отправляет их в Zoom-чат и подтверждает только реально отправленные сообщения через `ackIds`.

Он не вызывает `/zoom-only/webhook`, не парсит `111/222/333/444` и не управляет очередями.

## 11. Read-only диагностика чата

Для безопасной разведки DOM чата можно временно включить:

```bash
ZOOM_SENDER_CHAT_READONLY_DIAGNOSTICS=true
```

Этот режим только записывает видимые новые сообщения в `chat-readonly-diagnostics.jsonl` внутри diagnostics-папки. Он не отправляет ответы, не кладет ничего в outbox, не вызывает webhook и не меняет очередь. После проверки вернуть:

```bash
ZOOM_SENDER_CHAT_READONLY_DIAGNOSTICS=false
```

Для ingest `111` нужен отдельный флаг:

```bash
ZOOM_SENDER_CHAT_INGEST_ENABLED=true
```

Включать его только на отдельном тесте. Он передает в Worker только атомарные `111/222/333/444` через `/zoom-only/chat-ingest`, не вызывает `/zoom-only/webhook` и не отвечает в Zoom сам. Для рабочки и БК эти коды становятся отдельными заявками и показываются как `111`; повторные реальные сообщения одного автора разрешены. Обычный текст и агрегированные DOM-строки игнорируются, дедуп идет только по `sourceFingerprint`/DOM-дублю. После проверки вернуть:

```bash
ZOOM_SENDER_CHAT_INGEST_ENABLED=false
```
