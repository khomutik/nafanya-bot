# Zoom Marketplace setup

Цель этого этапа - включить официальный Zoom webhook для сообщений из чата конференции. Он позволит Нафане получать команды из Zoom и передавать их в общий Worker.

## Что уже готово

- Cloudflare Worker принимает Zoom webhook по адресу:

```text
https://pochti-normalnye-bot.pochtinormalnye.workers.dev/zoom/events
```

- Worker умеет отвечать на `endpoint.url_validation`.
- Worker проверяет подпись Zoom через `ZOOM_WEBHOOK_SECRET_TOKEN`.
- Worker обрабатывает событие `meeting.chat_message_sent`.

## Что нужно сделать в Zoom

1. Открыть [Zoom App Marketplace](https://marketplace.zoom.us/).
2. Войти под аккаунтом, на котором живет постоянная конференция.
3. Нажать `Develop` -> `Build App`.
4. Создать приложение типа `General App` или открыть уже созданное приложение, если оно есть.
5. В разделе `Basic Information` заполнить обязательные поля приложения.
6. Перейти в `Features` -> `Access`.
7. Включить `Event Subscriptions`.
8. Нажать `Add New Event Subscription`.
9. В поле `Event notification endpoint URL` вставить:

```text
https://pochti-normalnye-bot.pochtinormalnye.workers.dev/zoom/events
```

10. Нажать выбор событий и добавить:

```text
In-meeting chat message received
```

В API это событие может называться `meeting.chat_message_sent` или `meeting.chat_message_received`; Worker принимает оба варианта.

11. Скопировать `Secret Token` из блока webhook.
12. Поставить этот токен в Cloudflare Worker как secret:

```bash
wrangler secret put ZOOM_WEBHOOK_SECRET_TOKEN
```

13. Вернуться в Zoom Marketplace и нажать `Validate`.
14. После успешной проверки нажать `Save`.

## Соорганизаторы

Zoom webhook точно передает `sender_type=host` для организатора. Для соорганизаторов webhook может прийти как `guest`, поэтому для служебных команд есть дополнительный список имен:

```bash
wrangler secret put ZOOM_ADMIN_NAMES
```

Значение можно указать списком через запятую или точку с запятой:

```text
Маша; Лиля; Анна
```

Это нужно только для служебных команд вроде `молитва`, `высказался`, `пропускает`, `отменить`, `добавить 111 Лиля`. Обычные команды очереди `111`, `222`, `333`, `444`, `игра 17` могут писать все.

## Важное ограничение

Официальный webhook решает входящую сторону: Zoom -> Нафаня -> Telegram/очередь.

Исходящая сторона, где Нафаня сам пишет обратно в чат конференции Zoom, пока не подключена официальным способом. Zoom Meeting SDK for Web сейчас прямо ограничен human use cases и не предназначен для ботов. Поэтому текущий серверный мост стоит в `stub`-режиме и не подтверждает исходящие сообщения как отправленные в Zoom.
