# Cloudflare deploy

This folder keeps only the live Cloudflare Worker deploy surface.

## Live files
- `worker.mjs` - current production worker bundle and single source of truth.
- `wrangler.jsonc` - Wrangler config for deploy, Durable Objects, cron, and bindings.
- `.gitignore` - local deploy-folder ignores.
- `package.json` - marks the folder as ESM for local tooling.
- `speaker_questions.json` - local copy of game questions that are also stored externally.
- `message_zoom.md` - the only editable source for Zoom meeting messages and their Markdown formatting.
- `zoom_meeting_texts.js` - generated Worker module; do not edit directly.

## Important
- Cloudflare deploys `worker.mjs` directly via `main` in `wrangler.jsonc`.
- If you edit an old copy instead of `worker.mjs`, Cloudflare will not see those changes.
- Historical files, local caches, and disabled generated data live in `BACKUPS`, not in the active deploy path.
- Google knowledge reads three live spreadsheets by file id: `FAQ`, `График служений`, and `Список служащих/ротация`.
- Program/Big Book answers are intentionally disabled for now, so those files are not part of the active deploy surface.
- After editing `message_zoom.md`, run `npm run generate:zoom-texts`; production preflight verifies the generated module is current.
- Zoom queue state and formatting remain separate: queue behavior is implemented in `core/queue-engine.js` and tested independently.

## Secrets
Set the Google service-account JSON as a Wrangler secret:

```bash
wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON
```

## Telegram identity
- Set `BOT_USERNAME` in `wrangler.jsonc` to the bot username without `@`.
- The addressing classifier also reads the bot identity from `reply_to_message.from`, but direct `@username` mentions outside replies require `BOT_USERNAME`.

## Common commands
- `wrangler deploy --dry-run`
- `wrangler deploy`
- `wrangler dev`
- `npm run test:addressing`
- `npm run test:quality`
- `npm run test:zoom-source`
