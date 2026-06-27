# Le Vieillard — backend

Bilingual (FR/EN) Africa & Mali news app with **live RSS**, **server-side translation**, and **automatic breaking-news alerts** to WhatsApp / Telegram.

Zero npm dependencies — pure Node (`http` + built-in `fetch`). Needs **Node 18+**.

## Run

```bash
cd le-vieillard
node server.js
```

Then open **http://localhost:8132** (news app), **http://localhost:8132/newsletter** (The West Africa Brief), and **http://localhost:8132/subscribe** (alerts signup).

Optional config: `cp .env.example .env` and fill in (see below). It runs fine with no `.env`.

## What it does

- **`lib/feeds.js`** fetches 15 RSS feeds server-side (no CORS) — incl. the francophone business wire Financial Afrik for the economy/FDI beat — parses RSS + Atom, strips HTML and feed boilerplate (incl. the Maliactu site-name junk), categorizes by keywords, dedupes, sorts newest-first, keeps the top 60.
- **`lib/newsletter.js`** assembles **The West Africa Brief** (`Le Point Afrique de l'Ouest`) — a weekly business & geopolitics issue (ECOWAS + Sahel angle) auto-built from the live pool into an executive-scannable structure: **Macro Overview → Deep Dive (with a "why it matters" FDI lens) → Regional Briefs** (Markets & Currency, Sahel & Security, Tech & Telecoms, Mali). No fabricated analysis — it curates and groups real headlines, gated to West-Africa-relevant stories. Served bilingually at `/newsletter` (print-friendly).
- **`lib/translate.js`** translates title + excerpt into the other language via Google's free endpoint (cached). Article bodies translate on demand at `/api/article/:id?lang=`.
- **`server.js`** serves the app + API and re-fetches every `REFRESH_MIN` minutes. A per-minute clock tick pushes the Telegram digest at the fixed `PUSH_AT` hours (UTC; default `8,19` = 8am & 7pm Mali time) and sends the weekly Brief on its scheduled day/hour.
- **`lib/notify.js`** sends new breaking items (headline + summary + link) to Telegram (channel + direct subscribers) and WhatsApp. The first batch after boot is seeded silently (no blast). With no credentials, the digest is logged to the console.
- **`lib/store.js`** persists subscribers to `data/subscribers.json`.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/news` | Article list (title/excerpt pre-translated FR+EN) |
| GET | `/api/article/:id?lang=fr\|en` | Full body translated on demand |
| GET | `/api/newsletter?lang=fr\|en` | The West Africa Brief issue (macro, deep dive, regional briefs) |
| GET | `/api/newsletter/send?key=…&force=1` | Push the weekly Brief to Telegram (key-guarded; `force=1` bypasses the once-per-week guard) |
| GET | `/api/status` | Health: counts, subscribers, push configured? |
| GET | `/api/config` | Telegram bot/channel + WhatsApp flag for the landing page |
| POST | `/api/subscribe` | `{channel, contact, name, lang}` |
| POST | `/api/telegram/webhook` | Auto-subscribes chats that send `/start` |

## Alerts setup (optional)

**Telegram (easiest, free):** create a bot with [@BotFather], put the token in `TELEGRAM_BOT_TOKEN`. To broadcast to a channel, create one, add the bot as admin, and set `TELEGRAM_CHANNEL=@yourchannel`. To auto-subscribe individuals, set a webhook to `/api/telegram/webhook`.

**WhatsApp (Meta Cloud API):** set `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_ID` from the Meta developer console.

## Weekly newsletter delivery

The Brief goes to the same Telegram channel + subscribers as the alerts. It sends FR to the channel and each subscriber's chosen language to direct subscribers.

- **Schedule:** `NEWSLETTER_DAY` (0=Sun … 1=Mon, default Mon) + `NEWSLETTER_HOUR` (UTC, default 8). An in-process timer checks every 10 min and sends once per ISO week (`store.getMeta('lastBriefWeek')` guards against repeats across restarts).
- **Reliable delivery (recommended):** in-process timers reset whenever a sleepy free host restarts, so set a long random `NEWSLETTER_KEY` and have an external weekly cron (e.g. [cron-job.org](https://cron-job.org)) GET `https://YOUR_DOMAIN/api/newsletter/send?key=YOUR_KEY` once a week. Add `&force=1` for a manual test.
- With no Telegram credentials, the Brief is printed to the console (so you can preview exactly what would be sent) instead of failing.

[@BotFather]: https://t.me/BotFather
