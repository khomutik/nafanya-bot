# Zoom Sender v2: боевой runbook

Эта инструкция описывает безопасный запуск Нафани на реальном Zoom-собрании. Все команды выполняются на сервере из папки:

```bash
cd /home/masha/nafanya-zoom-sender
```

Секреты, Zoom-ссылку, `.env`, cookies и browser profile нельзя печатать в отчётах, логах, скриншотах или отправлять в GitHub.

## 1. Safe-mode по умолчанию

Когда sender не используется, в `.env` должны стоять:

```bash
ZOOM_SENDER_DRY_RUN=true
ZOOM_SENDER_MOCK_OUTBOX=true
ZOOM_SENDER_CHAT_READONLY_DIAGNOSTICS=false
ZOOM_SENDER_CHAT_INGEST_ENABLED=false
ZOOM_AUTH_SETUP=false
```

Файл `.env` хранится только на сервере. Значения переменных не показывать командой `cat .env` и не копировать в чат.

## 2. Pre-flight перед собранием

### 2.1. Проверить контейнеры

```bash
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
docker inspect -f 'restart={{.HostConfig.RestartPolicy.Name}} status={{.State.Status}}' nafanya-zoom-bridge
```

Нужно убедиться:

- старый `nafanya-zoom-bridge` не запущен;
- у старого bridge `restart=no`;
- `nafanya-zoom-sender-v2` не запущен второй копией.

Старый bridge и новый sender нельзя запускать одновременно.

Не запускать старый `zoom-bridge`: боевой Zoom обслуживает только `zoom-sender-v2`.

### 2.2. Проверить Chromium и browser profile

```bash
pgrep -a -f 'chromium|chrome|playwright' || true
docker run --rm \
  -v nafanya-zoom-sender_zoom-sender-profile:/profile:ro \
  alpine sh -c 'find /profile -maxdepth 1 -name "Singleton*" -print'
```

Если sender остановлен, Chromium-процессов быть не должно. Lock-файлы удалять можно только после проверки, что ни sender, ни Chromium не работают:

```bash
docker run --rm \
  -v nafanya-zoom-sender_zoom-sender-profile:/profile \
  alpine sh -c 'rm -f /profile/SingletonLock /profile/SingletonSocket /profile/SingletonCookie'
```

Профиль должен существовать, быть доступен на запись и содержать ранее сохранённую Zoom-сессию. Сам profile, cookies и storage state никуда не копировать.

### 2.3. Проверить Worker

Через защищённый `/zoom-only/status` или живую Zoom-only panel проверить:

- `queueOpen` — очередь закрыта либо находится в ожидаемом состоянии;
- `outboxSize=0` перед новым собранием;
- `entriesCount=0` перед чистым запуском;
- нет старых тестовых сообщений.

Если состояние неожиданное, не продолжать вслепую. Штатный `/zoom-only/reset` допустим только до собрания и только когда точно можно удалить тестовый хвост. Storage руками не редактировать.

## 3. Подготовить боевой режим

Перед реальным собранием сделать резервную копию `.env`:

```bash
cp .env ".env.backup-before-meeting-$(date +%Y%m%d-%H%M%S)"
```

Для боевой работы:

```bash
ZOOM_SENDER_DRY_RUN=false
ZOOM_SENDER_MOCK_OUTBOX=false
ZOOM_SENDER_CHAT_READONLY_DIAGNOSTICS=false
ZOOM_SENDER_CHAT_INGEST_ENABLED=true
ZOOM_AUTH_SETUP=false
```

`ZOOM_SENDER_CHAT_INGEST_ENABLED=true` включать только тогда, когда нужна очередь из Zoom-чата. Read-only diagnostics включать лишь для диагностики: они создают локальные файлы и для обычного собрания не нужны.

## 4. Запустить sender

```bash
docker compose -f compose.example.yml up -d
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

Посмотреть последние безопасные строки логов:

```bash
docker compose -f compose.example.yml logs --tail=100 zoom-sender
```

В логах не должно быть секретов, полной Zoom-ссылки или бесконечного цикла запросов. В тишине polling должен уходить к 15–30 секундам.

## 5. Проверить health

```bash
curl http://127.0.0.1:3097/health
```

Перед открытием очереди обязательно получить:

- `status=healthy`;
- `zoomJoined=true`;
- `chatOpen=true`;
- `lastError=null`.

Если `chatOpen=false`, очередь не открывать и участников не просить писать коды. Сначала восстановить вход или чат.

## 6. Восстановить Zoom-авторизацию

Если Zoom показывает Sign In, обычный sender остановить:

```bash
docker compose -f compose.example.yml down
```

Временно включить setup:

```bash
ZOOM_AUTH_SETUP=true
ZOOM_AUTH_WAIT_FOR_MANUAL=true
```

Запустить auth/setup одноразово, без restart-loop. Вручную пройти captcha, подтверждение по почте, 2FA или security prompt, если Zoom их запросил. Пароль, коды и cookies не печатать.

Успешное завершение выглядит так:

```text
Zoom auth profile setup completed.
```

После этого вернуть `ZOOM_AUTH_SETUP=false`, остановить setup и снова запустить обычный sender. Повторно проверить `/health`.

## 7. Открыть очередь

Открывать очередь только через живую защищённую Zoom-only panel:

- `open_rs` — рабочка;
- `open_bk` — БК;
- `close_queue` — закрыть очередь.

После открытия проверить в panel/status:

- action принят;
- сообщение об открытии ушло в Zoom;
- sender отправил `ackIds`;
- `outboxSize=0`;
- `queueOpen=true`;
- выбран правильный `mode`;
- `entriesCount` соответствует реальному состоянию.

Токен панели не вставлять в runbook, команды, отчёты или скриншоты.

## 8. Штатная работа очереди

Для режимов `rs` и `bk`:

- отдельные сообщения `111`, `222`, `333`, `444` из Zoom-чата становятся заявками;
- в опубликованной очереди все они отображаются как `111`;
- повторное реальное `111` того же участника создаёт новую заявку;
- `привет`, произвольный текст и агрегаты вроде `111 222 333` игнорируются;
- публикации Нафани и DOM-клоны не должны создавать заявки.

Dedup использует настоящий Zoom message ID вида `1-{GUID}` из `data-id`/`id`. Один реальный message ingest-ится один раз, даже если Zoom показывает много DOM-клонов. `chat-message-content-N` настоящим message ID не считается.

Sender передаёт входящие коды только в `/zoom-only/chat-ingest` и не вызывает `/zoom-only/webhook`.

## 9. Смотреть состояние во время собрания

Проверять два независимых состояния.

Sender:

```bash
curl http://127.0.0.1:3097/health
docker compose -f compose.example.yml logs --tail=100 zoom-sender
```

Worker через защищённый `/zoom-only/status` или panel:

- `queueOpen`;
- `mode`;
- `entriesCount`;
- `outboxSize`.

Нормальное состояние: sender healthy, чат открыт, outbox после отправки возвращается к нулю, а число заявок меняется только после реальных сообщений участников.

## 10. Закрыть собрание

1. Нажать `close_queue` в Zoom-only panel.
2. Дождаться сообщения о закрытии в Zoom и `ackIds`.
3. Проверить `queueOpen=false` и `outboxSize=0`.
4. Остановить sender:

```bash
docker compose -f compose.example.yml down
```

5. Вернуть `.env` в safe-mode:

```bash
ZOOM_SENDER_DRY_RUN=true
ZOOM_SENDER_MOCK_OUTBOX=true
ZOOM_SENDER_CHAT_READONLY_DIAGNOSTICS=false
ZOOM_SENDER_CHAT_INGEST_ENABLED=false
ZOOM_AUTH_SETUP=false
```

6. Проверить, что контейнер удалён/остановлен и старый bridge не запустился.

`/zoom-only/reset` после собрания использовать только по явному решению администратора: reset очищает состояние очереди, а не просто закрывает её.

## 11. Аварийные ситуации

### Zoom открыл Sign In

Не открывать очередь. Остановить обычный sender и пройти auth/setup по разделу 6.

### `chatOpen=false`

Не просить писать `111/222/333/444`. Проверить waiting room, авторизацию, открытие чата и `lastError`.

### Outbox не пустой

Не перезапускать sender вслепую: старое сообщение может уйти после рестарта. Проверить health, логи отправки и ack. Очищать outbox только штатным ack/reset и только когда понятен смысл каждого сообщения.

### Неожиданный `entriesCount`

Не продолжать тест или собрание вслепую. Проверить режим, status и последние реальные сообщения. Reset допустим только если собрание ещё не идёт либо администратор явно разрешил очистку.

### Подозрение на self-ingest или дубли

Закрыть очередь, остановить sender и сохранить только обезличенный диагностический фрагмент. Не включать старый bridge и не править Worker на живом собрании.

### Падает Worker regression на Google Sheets

Пустой ответ живого расписания Google Sheets нужно проверять отдельно. Он не доказывает сбой Zoom Sender, message-ID dedup или chat ingest.

## 12. Git hygiene

Перед commit проверить `git status`. Никогда не добавлять:

- `.env` и его backup;
- diagnostics;
- screenshots;
- logs;
- browser profile, cookies и storage state;
- `node_modules`;
- временные файлы и реальные секреты.

В Git можно добавлять только намеренно изменённые RUNBOOK/README, код и тесты.
