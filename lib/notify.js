'use strict';
/* Breaking-news push to Telegram + WhatsApp.
   All providers are env-configured; with no credentials the digest is logged
   to the console (so you can see exactly what WOULD be sent) instead of failing. */

const store = require('./store');

const TG_TOKEN   = () => process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHANNEL = () => process.env.TELEGRAM_CHANNEL || '';   // e.g. @levieillard_news
const WA_TOKEN   = () => process.env.WHATSAPP_TOKEN || '';
const WA_PHONE   = () => process.env.WHATSAPP_PHONE_ID || '';

function esc(s){ return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function stripHtml(s){ return String(s).replace(/<[^>]+>/g, ''); }

/* ---- providers ---- */
async function tgSend(chat_id, html){
  if (!TG_TOKEN()) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN()}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text: html, parse_mode: 'HTML', disable_web_page_preview: false })
    });
    return res.ok;
  } catch { return false; }
}

async function waSend(to, text){
  if (!WA_TOKEN() || !WA_PHONE()) return false;
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE()}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WA_TOKEN()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } })
    });
    return res.ok;
  } catch { return false; }
}

/* ---- digest formatting ---- */
function digest(items, lang){
  const L = lang === 'en'
    ? { head: '🔴 BREAKING — Le Vieillard', read: 'Read more' }
    : { head: '🔴 DERNIÈRE MINUTE — Le Vieillard', read: 'Lire la suite' };
  const body = items.slice(0, 5).map(a => {
    const c = a[lang] || a.fr;
    return `\n📰 <b>${esc(c.title)}</b>\n${esc(c.excerpt)}\n🔗 ${esc(a.url)}`;
  }).join('\n');
  return `${L.head}${body}`;
}

/* ---- push engine ---- */
const pushed = new Set();   // urls already sent this process
let primed = false;          // skip the very first batch so boot doesn't blast everyone

function isConfigured(){ return !!(TG_TOKEN() || (WA_TOKEN() && WA_PHONE())); }

async function pushBreaking(articles){
  const fresh = articles.filter(a => a.breaking && !pushed.has(a.url || a.id));
  fresh.forEach(a => pushed.add(a.url || a.id));

  if (!primed) { primed = true; return { primed: true, seeded: fresh.length }; }
  if (!fresh.length) return { sent: 0, fresh: 0 };

  const subs = store.load();
  const msgFr = digest(fresh, 'fr');
  const msgEn = digest(fresh, 'en');

  if (!isConfigured()) {
    console.log('\n[notify] No provider configured — digest that WOULD be sent:\n' + stripHtml(msgFr) + '\n');
    return { sent: 0, fresh: fresh.length, logged: true };
  }

  let sent = 0;
  // Telegram broadcast channel
  if (TG_CHANNEL()) { if (await tgSend(TG_CHANNEL(), msgFr)) sent++; }
  // Telegram direct subscribers
  for (const s of (subs.telegram || [])) {
    if (s.chat_id && await tgSend(s.chat_id, s.lang === 'en' ? msgEn : msgFr)) sent++;
  }
  // WhatsApp subscribers
  for (const s of (subs.whatsapp || [])) {
    if (await waSend(s.contact, stripHtml(s.lang === 'en' ? msgEn : msgFr))) sent++;
  }
  return { sent, fresh: fresh.length, configured: true };
}

/* Handle a Telegram webhook update: auto-subscribe chats that send /start. */
function handleTelegramUpdate(update){
  try {
    const msg = update && (update.message || update.edited_message);
    if (!msg || !msg.chat) return { ok: true };
    const text = (msg.text || '').trim();
    if (text.startsWith('/start') || text.startsWith('/subscribe')) {
      const name = [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(' ') || msg.chat.username || '';
      const added = store.addTelegramChat(msg.chat.id, name);
      tgSend(msg.chat.id, added
        ? '✅ Vous êtes abonné aux alertes <b>Le Vieillard</b>. Vous recevrez la dernière minute ici.'
        : 'ℹ️ Vous êtes déjà abonné aux alertes <b>Le Vieillard</b>.');
    }
    return { ok: true };
  } catch { return { ok: true }; }
}

module.exports = { pushBreaking, handleTelegramUpdate, isConfigured, digest };
