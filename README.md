# Le Vieillard — backend

Bilingual (FR/EN) Africa & Mali news app with **live RSS**, **server-side translation**, and **automatic breaking-news alerts** to WhatsApp / Telegram.

Zero npm dependencies — pure Node (`http` + built-in `fetch`). Needs **Node 18+**.

## Run

```bash
cd le-vieillard
node server.js
```

Then open **http://localhost:8132** (news app) and **http://localhost:8132/subscribe** (alerts signup).

Optional config: `cp .env.example .env` and fill in (see below). It runs fine with no `.env`.

## What it does

- **`lib/feeds.js`** fetches 14 RSS feeds server-side (no CORS), parses RSS + Atom, strips HTML and feed boilerplate (incl. the Maliactu site-name junk), categorizes by keywords, dedupes, sorts newest-first, keeps the top 60.
- **`lib/translate.js`** translates title + excerpt into the other language via Google's free endpoint (cached). Article bodies translate on demand at `/api/article/:id?lang=`.
- **`server.js`** serves the app + API and re-fetches every `REFRESH_MIN` minutes. On each refresh it calls `notify.pushBreaking`.
- **`lib/notify.js`** sends new breaking items (headline + summary + link) to Telegram (channel + direct subscribers) and WhatsApp. The first batch after boot is seeded silently (no blast). With no credentials, the digest is logged to the console.
- **`lib/store.js`** persists subscribers to `data/subscribers.json`.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/news` | Article list (title/excerpt pre-translated FR+EN) |
| GET | `/api/article/:id?lang=fr\|en` | Full body translated on demand |
| GET | `/api/status` | Health: counts, subscribers, push configured? |
| GET | `/api/config` | Telegram bot/channel + WhatsApp flag for the landing page |
| POST | `/api/subscribe` | `{channel, contact, name, lang}` |
| POST | `/api/telegram/webhook` | Auto-subscribes chats that send `/start` |

## Alerts setup (optional)

**Telegram (easiest, free):** create a bot with [@BotFather], put the token in `TELEGRAM_BOT_TOKEN`. To broadcast to a channel, create one, add the bot as admin, and set `TELEGRAM_CHANNEL=@yourchannel`. To auto-subscribe individuals, set a webhook to `/api/telegram/webhook`.

**WhatsApp (Meta Cloud API):** set `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_ID` from the Meta developer console.

[@BotFather]: https://t.me/BotFather
