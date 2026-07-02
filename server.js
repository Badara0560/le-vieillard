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

const PORT        = +(process.env.PORT || 8132);
const REFRESH_MIN = +(process.env.REFRESH_MIN || 8);    // website feed refresh
/* Telegram digest now fires at fixed clock hours (UTC) instead of a rolling
   interval. Mali runs on GMT (UTC+0), so "8,19" = 8am & 7pm local. */
const PUSH_AT     = (process.env.PUSH_AT || '8,19').split(',')
  .map(n => +n.trim()).filter(n => Number.isInteger(n) && n >= 0 && n < 24);
const NL_DAY      = +(process.env.NEWSLETTER_DAY ?? 1);  // weekly Brief: 0=Sun … 1=Mon
const NL_HOUR     = +(process.env.NEWSLETTER_HOUR ?? 8); // hour (UTC) to send the Brief
const NL_KEY      = process.env.NEWSLETTER_KEY || '';    // secret for the manual/cron trigger
const PUBLIC      = path.join(__dirname, 'public');

/* Widest gap (hours) between two consecutive push times — the digest window, so
   nothing published between sends is missed (the per-article dedupe avoids
   repeats on overlap). E.g. [8,19] → gaps 11h & 13h → window 13h. */
const PUSH_WINDOW = (() => {
  if (PUSH_AT.length < 2) return 24;
  const h = [...PUSH_AT].sort((a, b) => a - b);
  let max = h[0] + 24 - h[h.length - 1];                 // wrap-around gap
  for (let i = 1; i < h.length; i++) max = Math.max(max, h[i] - h[i - 1]);
  return max;
})();

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

/* Push a digest to Telegram. Window covers the gap since the previous send so
   nothing is missed; per-article dedupe prevents repeats on overlap. */
async function pushCycle(){
  try {
    const res = await notify.pushDigest(state.articles, PUSH_WINDOW);
    console.log(`[push] ${new Date().toISOString()} | ${JSON.stringify(res)}`);
  } catch (e) {
    console.error('[push] error:', e.message);
  }
}

/* Fire the digest at fixed UTC hours (PUSH_AT). Guarded so it sends at most once
   per hour-slot even though the clock is checked every minute. */
let lastPushSlot = null;
async function pushCheck(){
  const now = new Date();
  if (!PUSH_AT.includes(now.getUTCHours())) return;
  const slot = now.toISOString().slice(0, 13);   // yyyy-mm-ddThh
  if (lastPushSlot === slot) return;
  lastPushSlot = slot;
  await pushCycle();
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
  if (!full.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
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

  try {
    if (p === '/api/news') return sendJSON(res, 200, newsPayload());

    if (p === '/api/newsletter') {
      const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'fr';
      return sendJSON(res, 200, newsletter.buildIssue(state.articles, lang));
    }

    if (p === '/api/worldcup/live') {
      try { return sendJSON(res, 200, await worldcup.fetchLive()); }
      catch (e) { return sendJSON(res, 200, { updated: new Date().toISOString(), events: [], error: e.message }); }
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
      const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'fr';
      const a = state.articles.find(x => x.id === id);
      if (!a) return sendJSON(res, 404, { error: 'not found' });
      const body = await feeds.translateBody(a, lang);
      return sendJSON(res, 200, { id, lang, body });
    }

    if (p === '/api/subscribe' && req.method === 'POST') {
      // prevent subscriber-list flooding
      if (!rateLimit('sub:' + clientIp(req), 5, 10 * 60000)) return sendJSON(res, 429, { error: 'too many attempts, try later' });
      const raw = await readBody(req);
      let payload = {};
      try { payload = JSON.parse(raw || '{}'); } catch { /* ignore */ }
      const result = store.addSubscriber(payload);
      return sendJSON(res, result.ok ? 200 : 400, result);
    }

    if (p === '/api/telegram/webhook' && req.method === 'POST') {
      const raw = await readBody(req);
      let update = {};
      try { update = JSON.parse(raw || '{}'); } catch { /* ignore */ }
      notify.handleTelegramUpdate(update);
      return sendJSON(res, 200, { ok: true });
    }

    // ---- static / pages ----
    if (p === '/' || p === '/index.html') return serveStatic(res, 'index.html');
    if (p === '/subscribe' || p === '/landing' || p === '/subscribe.html') return serveStatic(res, 'landing.html');
    if (p === '/newsletter' || p === '/brief' || p === '/newsletter.html') return serveStatic(res, 'newsletter.html');
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
  console.log(`  Telegram digest at ${PUSH_AT.map(h => h + ':00').join(' & ')} UTC (window ${PUSH_WINDOW}h)`);
  console.log(`  Weekly Brief: ${dayNames[NL_DAY]} ${NL_HOUR}:00 UTC | cron trigger ${NL_KEY ? 'enabled' : 'disabled (set NEWSLETTER_KEY)'}\n`);
  refresh();
  setInterval(refresh, REFRESH_MIN * 60 * 1000);
  /* One clock tick a minute drives both schedulers (digest at PUSH_AT hours,
     weekly Brief on its day/hour) — accurate to within a minute of the hour. */
  setInterval(() => { pushCheck(); newsletterCheck(); }, 60 * 1000);
});
