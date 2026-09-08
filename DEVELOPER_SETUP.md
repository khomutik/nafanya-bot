# Нафаня: инструкция разработчику

Эта ветка содержит весь исходный код проекта. Рабочая задача для локальной проверки — Zoom-only стенд; боевой Worker, PMI и Telegram в него подключать нельзя.

## 1. Скачать проект

```powershell
git clone -b codex/developer-full-access https://github.com/khomutik/nafanya-bot.git
cd nafanya-bot
```

Открыть папку можно в Visual Studio или Visual Studio Code. Терминал ниже — обычный PowerShell.

## 2. Установить зависимости

Нужен Node.js 20+ и npm:

```powershell
node --version
npm --version
cd zoom-sender
npm install
cd ..\cloudflare-deploy
npm install
cd ..\zoom-sender
```

## 3. Подготовить локальный Zoom-стенд

```powershell
Copy-Item .env.local.example .env.local
notepad .env.local
```

В `.env.local` указать отдельную тестовую конференцию Zoom. Нельзя указывать PMI или production-ссылку Нафани: запуск остановится автоматически.

Первый вход выполняется вручную в отдельном браузерном профиле `.local-profile`. Пароли, cookies, токены и этот профиль не добавлять в Git.

## 4. Запуск

Из папки `zoom-sender`:

```powershell
npm run debug:all
```

Команда поднимает:

- локальный Worker: `http://127.0.0.1:8787`;
- локальный control-agent: `http://127.0.0.1:3098`;
- локальные Durable Objects и R2-библиотеку;
- настоящий Zoom sender после нажатия кнопки запуска.

Открыть пульт:

```text
http://127.0.0.1:3098/app?token=local-control-token
```

Нажать «Включить Нафаню». Библиотека с тестовыми отрывками загружается автоматически.

Остановить стенд:

```powershell
npm run debug:stop
```

или нажать Ctrl+C в окне `debug:all`.

## 5. Проверки

```powershell
cd zoom-sender
npm test
cd ..\cloudflare-deploy
npm run test:regression-static
npm run test:zoom-panel
```

Минимальный ручной сценарий: оставить Нафаню в комнате ожидания на 2–5 минут, допустить, отправить тему и отрывок, добавить/удалить две записи очереди, проверить очистку, таймер и восстановление после закрытия Chromium.

## Секреты и production

Реальные доступы передаются владельцем отдельно и не записываются в README, GitHub, логи или `.env.example`. Production-деплой выполняется только после согласования и проверки diff. Локальный Worker должен оставаться на `127.0.0.1`.
