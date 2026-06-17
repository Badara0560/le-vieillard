'use strict';
/* Tiny JSON-file persistence for subscribers. No DB needed. */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'subscribers.json');

function load(){
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return { whatsapp: [], telegram: [] }; }
}

function save(data){
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

/* Add a subscriber from the web form. channel = 'whatsapp' | 'telegram'. */
function addSubscriber({ channel, contact, name, lang }){
  channel = channel === 'telegram' ? 'telegram' : 'whatsapp';
  const norm = String(contact || '').trim();
  if (!norm) return { ok: false, error: 'Contact is required' };
  if (channel === 'whatsapp' && !/^\+?\d[\d\s().-]{6,}$/.test(norm)) {
    return { ok: false, error: 'Enter a valid phone number with country code' };
  }
  const data = load();
  const list = data[channel] || (data[channel] = []);
  if (list.find(s => s.contact === norm)) return { ok: true, already: true };
  list.push({ contact: norm, name: name || '', lang: lang === 'en' ? 'en' : 'fr', at: new Date().toISOString() });
  save(data);
  return { ok: true };
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
  return { whatsapp: (d.whatsapp || []).length, telegram: (d.telegram || []).length };
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

module.exports = { load, save, addSubscriber, addTelegramChat, counts, getMeta, setMeta };
