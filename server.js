'use strict';
/* Le Vieillard — zero-dependency Node backend.
   Serves the news app + landing page, exposes a JSON news API,
   refreshes feeds on a schedule, and auto-pushes breaking news. */

const http = require('http');
const fs = require('fs');
const path = require('path');

/* ---- minimal .env loader (no dependency) ---- */
(function loadEnv(){
  try {
    const txt = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m || (m[1] in process.env)) continue;
      let val = m[2];
      if (/^["']/.test(val)) val = val.replace(/^(['"])(.*?)\1.*$/, '$2');   // quoted value
      else val = val.replace(/\s+#.*$/, '').trim();                          // strip inline comment
      process.env[m[1]] = val;
    }
  } catch { /* no .env — fine */ }
})();

const feeds      = require('./lib/feeds');
const store      = require('./lib/store');
const notify     = require('./lib/notify');
const newsletter = require('./lib/newsletter');
const worldcup   = require('./lib/worldcup');
const render     = require('./lib/render');
const dailybrief = require('./lib/dailybrief');
const email      = require('./lib/email');

const PORT        = +(process.env.PORT || 8132);
const REFRESH_MIN = +(process.env.REFRESH_MIN || 8);    // website feed refresh
/* Phase 2: ONE daily Brief at a fixed morning hour (UTC = Bamako time).
   Fixed time is the habit mechanic — same hour every day, no surprises. */
const BRIEF_AT    = +(process.env.BRIEF_AT ?? 7);        // 7:00 Bamako
const NL_DAY      = +(process.env.NEWSLETTER_DAY ?? 1);  // weekly Brief: 0=Sun … 1=Mon
const NL_HOUR     = +(process.env.NEWSLETTER_HOUR ?? 8); // hour (UTC) to send the Brief
const NL_KEY      = process.env.NEWSLETTER_KEY || '';    // secret for the manual/cron trigger
const PUBLIC      = path.join(__dirname, 'public');

const state = { articles: [], updated: null, building: false, seeded: false };

/* Refresh the feeds for the WEBSITE (frequent — keeps the site current).
   This does NOT push to Telegram; that's on its own slow cadence below. */
async function refresh(){
  if (state.building) return;
  state.building = true;
  try {
    const articles = await feeds.build();
    if (articles.length) {
      state.articles = articles;
      state.updated = new Date().toISOString();
      // On first successful build, mark everything seen so the first digest
      // doesn't blast the existing backlog.
      if (!state.seeded) { notify.markSeen(articles); state.seeded = true; }
      console.log(`[refresh] ${articles.length} articles @ ${state.updated}`);
    } else {
      console.warn('[refresh] no articles built (feeds unreachable?)');
    }
  } catch (e) {
    console.error('[refresh] error:', e.message);
  } finally {
    state.building = false;
  }
}

/* Build + send the daily Brief. Once-per-day guard persists in the store, so a
   process restart can't cause a duplicate send. `force` bypasses the guard
   (manual/cron trigger). */
async function sendDaily(force){
  if (!state.articles.length) return { ok: false, error: 'no articles yet' };
  const day = new Date().toISOString().slice(0, 10);
  if (!force && store.getMeta('lastDailyBriefDay') === day) return { ok: false, skipped: 'already sent today' };
  const daily = dailybrief.buildDaily(state.articles);
  if (!daily.items.length) return { ok: false, error: 'no fresh items' };
  const res = await notify.sendDailyBrief({
    tgFr: dailybrief.formatTelegram(daily, 'fr'),
    tgEn: dailybrief.formatTelegram(daily, 'en'),
    waFr: dailybrief.formatWhatsApp(daily, 'fr'),
    waEn: dailybrief.formatWhatsApp(daily, 'en')
  });
  // E-mail subscribers get the same edition through Brevo.
  const mailRes = await email.sendBriefEmails(store.load().email || [], daily, daily);
  store.setMeta('lastDailyBriefDay', day);
  store.setMeta('lastDailyBriefAt', new Date().toISOString());
  return { ...res, email: mailRes, day, items: daily.items.length };
}

/* Fire the Brief at the fixed hour (checked every minute). */
async function briefCheck(){
  try {
    const now = new Date();
    if (now.getUTCHours() !== BRIEF_AT) return;
    if (store.getMeta('lastDailyBriefDay') === now.toISOString().slice(0, 10)) return;
    const res = await sendDaily(false);
    console.log(`[brief] daily send → ${JSON.stringify(res)}`);
  } catch (e) {
    console.error('[brief] check error:', e.message);
  }
}

/* ISO-8601 week key (e.g. "2026-W25") — used so the weekly Brief fires at most
   once per calendar week, even if the process restarts mid-week. */
function isoWeek(d = new Date()){
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;            // Mon=1 … Sun=7
  t.setUTCDate(t.getUTCDate() + 4 - day);    // nearest Thursday
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}

/* Build both language issues and push the Brief; records the week so it won't
   repeat. `force` (manual/cron trigger) bypasses the once-per-week guard. */
async function sendBrief(force){
  if (!state.articles.length) return { ok: false, error: 'no articles yet' };
  const week = isoWeek();
  if (!force && store.getMeta('lastBriefWeek') === week) return { ok: false, skipped: 'already sent this week' };
  const issueFr = newsletter.buildIssue(state.articles, 'fr');
  const issueEn = newsletter.buildIssue(state.articles, 'en');
  const res = await notify.pushNewsletter(issueFr, issueEn);
  store.setMeta('lastBriefWeek', week);
  store.setMeta('lastBriefAt', new Date().toISOString());
  return { ...res, week };
}

/* Best-effort weekly scheduler: on each tick, send if it's the configured
   day/hour (UTC) and we haven't sent this week. Reliable delivery on a sleepy
   host should use the key-guarded /api/newsletter/send trigger via an external
   weekly cron. */
async function newsletterCheck(){
  try {
    const now = new Date();
    if (now.getUTCDay() !== NL_DAY || now.getUTCHours() !== NL_HOUR) return;
    if (store.getMeta('lastBriefWeek') === isoWeek()) return;
    const res = await sendBrief(false);
    console.log(`[newsletter] weekly send → ${JSON.stringify(res)}`);
  } catch (e) {
    console.error('[newsletter] check error:', e.message);
  }
}

/* ---- helpers ---- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png' };

function sendJSON(res, code, obj){
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveStatic(res, file){
  const full = path.join(PUBLIC, file);
  // + path.sep: without it, a sibling dir like ".../publicX" would pass the check
  if (full !== PUBLIC && !full.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
}

function readBody(req){
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}

/* ---- simple in-memory rate limiting ---- */
const rl = new Map();   // key -> { count, reset }
function clientIp(req){
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress || 'unknown';
}
/* Returns true if the request is allowed, false if over the limit. */
function rateLimit(key, max, windowMs){
  const now = Date.now();
  const e = rl.get(key);
  if (!e || now > e.reset) { rl.set(key, { count: 1, reset: now + windowMs }); return true; }
  if (e.count >= max) return false;
  e.count++;
  return true;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of rl) if (now > v.reset) rl.delete(k); }, 60000).unref();

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net data:",
    "img-src 'self' https: http: data:",
    "connect-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "object-src 'none'"
  ].join('; ')
};

/* News list shaped for the frontend (computes age at request time). */
function newsPayload(){
  const now = Date.now();
  return {
    updated: state.updated,
    count: state.articles.length,
    articles: state.articles.map(a => ({
      id: a.id, cat: a.cat, img: a.img, source: a.source, url: a.url,
      srcLang: a.srcLang, ageMin: Math.max(1, Math.round((now - a.ts) / 60000)),
      breaking: !!a.breaking, lead: !!a.lead,
      fr: a.fr, en: a.en, body: a.body
    }))
  };
}

/* ---- request router ---- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  // Security headers on every response
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);

  // CORS for the API (handy if the frontend is hosted separately)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  /* Requested language — one declaration for every route below. */
  const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'fr';

  try {
    if (p === '/api/news') return sendJSON(res, 200, newsPayload());

    if (p === '/api/newsletter') {
      return sendJSON(res, 200, newsletter.buildIssue(state.articles, lang));
    }

    if (p === '/api/worldcup/live') {
      try { return sendJSON(res, 200, await worldcup.fetchLive()); }
      catch (e) { return sendJSON(res, 200, { updated: new Date().toISOString(), events: [], error: e.message }); }
    }

    /* ---- Phase 2: daily Brief endpoints ---- */
    if (p === '/api/brief/daily') {
      const daily = dailybrief.buildDaily(state.articles);
      return sendJSON(res, 200, { ...daily, lang });
    }
    /* WhatsApp-formatted text for manual channel posting (copy-paste ready). */
    if (p === '/api/brief/whatsapp') {
      if (!NL_KEY) return sendJSON(res, 404, { error: 'not enabled' });
      if (url.searchParams.get('key') !== NL_KEY) return sendJSON(res, 403, { error: 'forbidden' });
      const txt = dailybrief.formatWhatsApp(dailybrief.buildDaily(state.articles), lang);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(txt);
    }
    /* Manual/cron trigger for the daily Brief (external cron beats in-process
       timers on a sleepy free host). force=1 bypasses the once-per-day guard. */
    if (p === '/api/brief/send') {
      if (!NL_KEY) return sendJSON(res, 404, { error: 'not enabled' });
      if (url.searchParams.get('key') !== NL_KEY) return sendJSON(res, 403, { error: 'forbidden' });
      return sendJSON(res, 200, await sendDaily(url.searchParams.get('force') === '1'));
    }
    /* Click metrics — the honest engagement number. */
    if (p === '/api/metrics') {
      if (!NL_KEY) return sendJSON(res, 404, { error: 'not enabled' });
      if (url.searchParams.get('key') !== NL_KEY) return sendJSON(res, 403, { error: 'forbidden' });
      const clicks = store.getClicks();
      const days = Object.keys(clicks).sort();
      const last7 = days.slice(-7).reduce((acc, d) => {
        for (const [ch, n] of Object.entries(clicks[d])) acc[ch] = (acc[ch] || 0) + n;
        return acc;
      }, {});
      return sendJSON(res, 200, { subscribers: store.counts(), clicksLast7Days: last7,
        clicksByDay: Object.fromEntries(days.slice(-14).map(d => [d, clicks[d]])),
        lastBrief: store.getMeta('lastDailyBriefAt') || null });
    }

    /* Key-guarded trigger so an external weekly cron can push the Brief
       reliably (in-process timers reset when a sleepy free host restarts). */
    if (p === '/api/newsletter/send') {
      if (!NL_KEY) return sendJSON(res, 404, { error: 'not enabled' });
      if (url.searchParams.get('key') !== NL_KEY) return sendJSON(res, 403, { error: 'forbidden' });
      const force = url.searchParams.get('force') === '1';
      return sendJSON(res, 200, await sendBrief(force));
    }

    if (p === '/api/status') {
      return sendJSON(res, 200, { updated: state.updated, articles: state.articles.length,
        subscribers: store.counts(), pushConfigured: notify.isConfigured() });
    }

    if (p === '/api/config') {
      return sendJSON(res, 200, {
        telegramBot: process.env.TELEGRAM_BOT_USERNAME || '',
        telegramChannel: (process.env.TELEGRAM_CHANNEL || '').replace(/^@/, ''),
        whatsappEnabled: !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID)
      });
    }

    if (p.startsWith('/api/article/')) {
      // translation can hit an external service — cap per IP
      if (!rateLimit('art:' + clientIp(req), 60, 60000)) return sendJSON(res, 429, { error: 'slow down' });
      const id = +p.split('/').pop();
      const a = state.articles.find(x => x.id === id);
      if (!a) return sendJSON(res, 404, { error: 'not found' });
      const body = await feeds.translateBody(a, lang);
      return sendJSON(res, 200, { id, lang, body });
    }

    /* One-click unsubscribe (linked from every e-mail). */
    if (p === '/unsubscribe') {
      const addr = (url.searchParams.get('e') || '').trim().toLowerCase();
      let removed = false;
      if (addr) {
        const d = store.load();
        const before = (d.email || []).length;
        d.email = (d.email || []).filter(s => String(s.contact).toLowerCase() !== addr);
        if (d.email.length !== before) { store.save(d); removed = true; }
      }
      const html = render.unsubscribed(lang, removed);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }

    if (p === '/api/subscribe' && req.method === 'POST') {
      // prevent subscriber-list flooding
      if (!rateLimit('sub:' + clientIp(req), 5, 10 * 60000)) return sendJSON(res, 429, { error: 'too many attempts, try later' });
      const raw = await readBody(req);
      let payload = {};
      try { payload = JSON.parse(raw || '{}'); } catch { /* ignore */ }
      const result = store.addSubscriber(payload);
      /* Be honest: if e-mail delivery isn't wired yet, say "you're on the list",
         not "it's done" — the confirmation must match what will actually happen. */
      if (result.ok && result.channel === 'email' && !email.configured()) result.pending = true;
      return sendJSON(res, result.ok ? 200 : 400, result);
    }

    if (p === '/api/telegram/webhook' && req.method === 'POST') {
      /* If TELEGRAM_WEBHOOK_SECRET is set (pass secret_token to setWebhook),
         reject updates that don't carry it — otherwise anyone can forge /start
         updates and flood the subscriber list. Unset = legacy open behaviour. */
      const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
      if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
        return sendJSON(res, 403, { error: 'forbidden' });
      }
      const raw = await readBody(req);
      let update = {};
      try { update = JSON.parse(raw || '{}'); } catch { /* ignore */ }
      notify.handleTelegramUpdate(update);
      return sendJSON(res, 200, { ok: true });
    }

    // ---- server-rendered pages (« Le Fil ») ----
    if (p === '/' || p === '/index.html') {
      const html = render.home(state.articles, lang, dailybrief.buildDaily(state.articles));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=120' });
      return res.end(html);
    }
    if (/^\/a\/\d+$/.test(p)) {
      // Brief links carry ?c=tg|wa|nl — count the click (fire-and-forget)
      const ch = url.searchParams.get('c');
      if (ch) { try { store.bumpClick(ch); } catch { /* never block the page */ } }
      const html = render.story(state.articles, +p.split('/').pop(), lang);
      if (!html) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Article introuvable'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
      return res.end(html);
    }

    if (p === '/subscribe' || p === '/landing' || p === '/subscribe.html') {
      const html = render.subscribe(lang, {
        telegramBot: process.env.TELEGRAM_BOT_USERNAME || '',
        telegramChannel: (process.env.TELEGRAM_CHANNEL || '').replace(/^@/, ''),
        waChannel: process.env.WHATSAPP_CHANNEL_URL || ''
      });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=600' });
      return res.end(html);
    }
    if (p === '/newsletter' || p === '/brief' || p === '/newsletter.html') {
      const html = render.brief(newsletter.buildIssue(state.articles, lang), lang);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
      return res.end(html);
    }

    // ---- static / legacy pages ----
    if (p === '/ancien' || p === '/legacy') return serveStatic(res, 'index.html');
    if (p === '/worldcup' || p === '/coupe-du-monde' || p === '/mondial' || p === '/worldcup.html') return serveStatic(res, 'worldcup.html');
    return serveStatic(res, p.replace(/^\/+/, ''));
  } catch (e) {
    console.error('[request]', e.message);
    sendJSON(res, 500, { error: 'server error' });
  }
});

server.listen(PORT, () => {
  console.log(`\n  Le Vieillard running → http://localhost:${PORT}`);
  console.log(`  News app: /   ·   Subscribe: /subscribe   ·   API: /api/news`);
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  console.log(`  Push configured: ${notify.isConfigured()} | feed refresh ${REFRESH_MIN} min`);
  console.log(`  Daily Brief at ${BRIEF_AT}:00 UTC (Bamako time) | cron trigger ${NL_KEY ? 'enabled' : 'disabled (set NEWSLETTER_KEY)'}`);
  console.log(`  Weekly Point: ${dayNames[NL_DAY]} ${NL_HOUR}:00 UTC\n`);
  refresh();
  setInterval(refresh, REFRESH_MIN * 60 * 1000);
  /* One clock tick a minute drives both schedulers (daily Brief at BRIEF_AT,
     weekly Point on its day/hour) — accurate to within a minute of the hour. */
  setInterval(() => { briefCheck(); newsletterCheck(); }, 60 * 1000);
});
