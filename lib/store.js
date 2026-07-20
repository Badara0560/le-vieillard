'use strict';
/* Tiny JSON-file persistence for subscribers. No DB needed. */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'subscribers.json');

/* ---- optional Postgres backup (Render's disk is ephemeral: without this,
   every deploy/restart wipes the subscriber list). The JSON file stays the
   working store (synchronous API everywhere); Postgres is a mirror that is
   restored from at boot when the file is missing. Enabled by DATABASE_URL;
   degrades to file-only if the pg module or the DB is unavailable. ---- */
let pgPool = null;
if (process.env.DATABASE_URL) {
  try {
    const { Pool } = require('pg');
    pgPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2,
      ssl: { rejectUnauthorized: false } });
  } catch { console.warn('[store] module pg absent — persistance fichier uniquement'); }
}

const restored = (async () => {
  if (!pgPool) return;
  try {
    await pgPool.query(`CREATE TABLE IF NOT EXISTS levieillard_store (
      id INT PRIMARY KEY, data JSONB NOT NULL, updated TIMESTAMPTZ NOT NULL DEFAULT now())`);
    if (fs.existsSync(FILE)) return;              // local file wins if present
    const r = await pgPool.query('SELECT data FROM levieillard_store WHERE id = 1');
    if (r.rows.length) {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(r.rows[0].data, null, 2));
      console.log('[store] abonnés restaurés depuis Postgres');
    }
  } catch (e) { console.error('[store] restauration Postgres :', e.message); }
})();

function backupToPg(data){
  if (!pgPool) return;
  // after the restore, so a boot-time save can't overwrite the backup with {}
  restored.then(() => pgPool.query(
    `INSERT INTO levieillard_store (id, data, updated) VALUES (1, $1::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated = now()`,
    [JSON.stringify(data)]
  )).catch(e => console.error('[store] sauvegarde Postgres :', e.message));
}

function load(){
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return { whatsapp: [], telegram: [] }; }
}

function save(data){
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  backupToPg(data);
}

/* Add a subscriber from the web form. channel = 'email' | 'telegram' | 'whatsapp'.
   Each channel is validated for its own contact shape, so an e-mail address can
   never be silently filed as a Telegram contact (and then never reached). */
const CHANNELS = new Set(['email', 'telegram', 'whatsapp']);

function addSubscriber({ channel, contact, name, lang }){
  channel = CHANNELS.has(channel) ? channel : 'email';
  const norm = String(contact || '').trim();
  if (!norm) {
    return { ok: false, error: lang === 'en' ? 'Please enter a contact.' : 'Merci d’indiquer un contact.' };
  }
  if (channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(norm)) {
    return { ok: false, field: 'contact',
      error: lang === 'en' ? 'That e-mail address looks incomplete.' : 'Cette adresse e-mail semble incomplète.' };
  }
  if (channel === 'whatsapp' && !/^\+?\d[\d\s().-]{6,}$/.test(norm)) {
    return { ok: false, field: 'contact',
      error: lang === 'en' ? 'Enter a phone number with its country code.' : 'Indiquez un numéro avec l’indicatif du pays.' };
  }
  if (channel === 'telegram' && !/^@?[A-Za-z0-9_]{4,}$/.test(norm) && !/^\+?\d[\d\s().-]{6,}$/.test(norm)) {
    return { ok: false, field: 'contact',
      error: lang === 'en' ? 'Enter your Telegram handle (e.g. @nom) or phone number.' : 'Indiquez votre pseudo Telegram (ex. @nom) ou votre numéro.' };
  }
  const data = load();
  const list = data[channel] || (data[channel] = []);
  const key = channel === 'email' ? norm.toLowerCase() : norm;
  if (list.find(s => (channel === 'email' ? String(s.contact).toLowerCase() : s.contact) === key)) {
    return { ok: true, already: true };
  }
  list.push({ contact: key, name: name || '', lang: lang === 'en' ? 'en' : 'fr', at: new Date().toISOString() });
  save(data);
  return { ok: true, channel };
}

/* Register a Telegram chat that messaged the bot (via webhook /start). */
function addTelegramChat(chat_id, name){
  const data = load();
  data.telegram = data.telegram || [];
  if (!data.telegram.find(s => s.chat_id === chat_id)) {
    data.telegram.push({ chat_id, contact: String(chat_id), name: name || '', lang: 'fr', at: new Date().toISOString() });
    save(data);
    return true;
  }
  return false;
}

function counts(){
  const d = load();
  return { email: (d.email || []).length, whatsapp: (d.whatsapp || []).length, telegram: (d.telegram || []).length };
}

/* Small key/value meta in the same file — used to remember the last week the
   newsletter went out, so a weekly send isn't repeated within the same week even
   across process restarts. */
function getMeta(key){
  const d = load();
  return (d._meta || {})[key];
}
function setMeta(key, val){
  const d = load();
  d._meta = d._meta || {};
  d._meta[key] = val;
  save(d);
  return val;
}

/* ---- click counters (the honest engagement metric) ----
   Stored as _meta.clicks = { "2026-07-20": { tg: 3, wa: 5 } }, trimmed to 60 days.
   Channel comes from the ?c= param on brief links (tg | wa | nl | site). */
function bumpClick(channel){
  const ch = String(channel || 'site').replace(/[^a-z]/gi, '').slice(0, 8) || 'site';
  const day = new Date().toISOString().slice(0, 10);
  const d = load();
  d._meta = d._meta || {};
  const clicks = d._meta.clicks = d._meta.clicks || {};
  clicks[day] = clicks[day] || {};
  clicks[day][ch] = (clicks[day][ch] || 0) + 1;
  const days = Object.keys(clicks).sort();
  while (days.length > 60) delete clicks[days.shift()];
  save(d);
}

function getClicks(){
  const d = load();
  return (d._meta || {}).clicks || {};
}

module.exports = { load, save, addSubscriber, addTelegramChat, counts, getMeta, setMeta,
  bumpClick, getClicks };
