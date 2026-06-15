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

const feeds  = require('./lib/feeds');
const store  = require('./lib/store');
const notify = require('./lib/notify');

const PORT        = +(process.env.PORT || 8132);
const REFRESH_MIN = +(process.env.REFRESH_MIN || 8);
const PUBLIC      = path.join(__dirname, 'public');

const state = { articles: [], updated: null, building: false };

async function refresh(){
  if (state.building) return;
  state.building = true;
  try {
    const articles = await feeds.build();
    if (articles.length) {
      state.articles = articles;
      state.updated = new Date().toISOString();
      const res = await notify.pushBreaking(articles);
      console.log(`[refresh] ${articles.length} articles @ ${state.updated} | push: ${JSON.stringify(res)}`);
    } else {
      console.warn('[refresh] no articles built (feeds unreachable?)');
    }
  } catch (e) {
    console.error('[refresh] error:', e.message);
  } finally {
    state.building = false;
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

  // CORS for the API (handy if the frontend is hosted separately)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  try {
    if (p === '/api/news') return sendJSON(res, 200, newsPayload());

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
      const id = +p.split('/').pop();
      const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'fr';
      const a = state.articles.find(x => x.id === id);
      if (!a) return sendJSON(res, 404, { error: 'not found' });
      const body = await feeds.translateBody(a, lang);
      return sendJSON(res, 200, { id, lang, body });
    }

    if (p === '/api/subscribe' && req.method === 'POST') {
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
    return serveStatic(res, p.replace(/^\/+/, ''));
  } catch (e) {
    console.error('[request]', e.message);
    sendJSON(res, 500, { error: 'server error' });
  }
});

server.listen(PORT, () => {
  console.log(`\n  Le Vieillard running → http://localhost:${PORT}`);
  console.log(`  News app: /   ·   Subscribe: /subscribe   ·   API: /api/news`);
  console.log(`  Push configured: ${notify.isConfigured()} | refresh every ${REFRESH_MIN} min\n`);
  refresh();
  setInterval(refresh, REFRESH_MIN * 60 * 1000);
});
