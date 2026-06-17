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

/* Like tgSend but returns the Telegram API detail — used by the test trigger
   so we can see WHY a channel post fails (e.g. bot not an admin). */
async function tgSendDetailed(chat_id, html){
  if (!TG_TOKEN()) return { ok: false, error: 'no token' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN()}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text: html, parse_mode: 'HTML', disable_web_page_preview: false })
    });
    const j = await res.json().catch(() => ({}));
    return { ok: res.ok && j.ok !== false, status: res.status, description: j.description };
  } catch (e) { return { ok: false, error: String(e) }; }
}

/* Send the latest breaking items now (ignores the prime/dedupe state). */
async function sendTest(articles){
  const items = articles.filter(a => a.breaking).slice(0, 3);
  if (!items.length) return { ok: false, error: 'no breaking items yet' };
  if (!isConfigured()) return { ok: false, error: 'not configured' };
  const msgFr = digest(items, 'fr'), msgEn = digest(items, 'en');
  const out = { channel: TG_CHANNEL() || null, channelResult: null, subscribersSent: 0 };
  if (TG_CHANNEL()) out.channelResult = await tgSendDetailed(TG_CHANNEL(), msgFr);
  const subs = store.load();
  for (const s of (subs.telegram || [])) {
    if (s.chat_id && await tgSend(s.chat_id, s.lang === 'en' ? msgEn : msgFr)) out.subscribersSent++;
  }
  out.ok = out.channelResult ? out.channelResult.ok : out.subscribersSent > 0;
  return out;
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
  const body = items.slice(0, 10).map(a => {
    const c = a[lang] || a.fr;
    return `\n📰 <b>${esc(c.title)}</b>\n${esc(c.excerpt)}\n🔗 ${esc(a.url)}`;
  }).join('\n');
  return `${L.head}${body}`;
}

/* ---- newsletter (The West Africa Brief) ---- */
/* Format a built issue (from lib/newsletter.buildIssue) as a Telegram HTML
   message. Kept well under Telegram's 4096-char limit by capping brief items. */
function newsletterMessage(issue){
  const L = issue.labels;
  const link = (t, u) => u ? `<a href="${esc(u)}">${esc(t)}</a>` : `<b>${esc(t)}</b>`;
  let m = `📊 <b>${esc(issue.title)}</b>\n<i>${esc(issue.tagline)}</i>\n${esc(issue.date)}\n`;

  if (issue.macro && issue.macro.length) {
    m += `\n<b>${esc(L.macro).toUpperCase()}</b>\n`;
    issue.macro.forEach((x, i) => { m += `${i + 1}. ${link(x.title, x.url)} — <i>${esc(x.source)}</i>\n`; });
  }

  if (issue.deep) {
    m += `\n<b>${esc(L.deep).toUpperCase()}</b>\n${link(issue.deep.title, issue.deep.url)}\n${esc(issue.deep.excerpt)}\n➡️ <i>${esc(issue.deep.why)}</i>\n`;
  }

  if (issue.briefs && issue.briefs.length) {
    m += `\n<b>${esc(L.briefs).toUpperCase()}</b>\n`;
    issue.briefs.forEach(b => {
      m += `\n<u>${esc(b.label)}</u>\n`;
      b.items.slice(0, 3).forEach(it => { m += `• ${link(it.title, it.url)} — <i>${esc(it.source)}</i>\n`; });
    });
  }
  return m.trim();
}

/* Send the weekly Brief. Takes prebuilt issues (FR + EN) so notify.js stays
   decoupled from lib/newsletter. Channel gets FR; subscribers get their lang. */
async function pushNewsletter(issueFr, issueEn){
  const msgFr = newsletterMessage(issueFr);
  const msgEn = newsletterMessage(issueEn || issueFr);

  if (!isConfigured()) {
    console.log('\n[newsletter] No provider configured — Brief that WOULD be sent:\n' + stripHtml(msgFr) + '\n');
    return { sent: 0, logged: true };
  }

  const out = { channel: TG_CHANNEL() || null, channelResult: null, subscribersSent: 0 };
  if (TG_CHANNEL()) out.channelResult = await tgSendDetailed(TG_CHANNEL(), msgFr);
  const subs = store.load();
  for (const s of (subs.telegram || [])) {
    if (s.chat_id && await tgSend(s.chat_id, s.lang === 'en' ? msgEn : msgFr)) out.subscribersSent++;
  }
  out.sent = (out.channelResult && out.channelResult.ok ? 1 : 0) + out.subscribersSent;
  out.ok = out.sent > 0;
  return out;
}

/* ---- push engine ---- */
const pushed = new Set();   // article keys already sent this process

function isConfigured(){ return !!(TG_TOKEN() || (WA_TOKEN() && WA_PHONE())); }

/* Mark the current articles as already-seen WITHOUT sending — called once at
   boot so the first scheduled digest doesn't blast the existing backlog. */
function markSeen(articles){
  for (const a of articles) pushed.add(a.url || a.id);
}

/* Send a digest of stories published within the last `windowHours` that haven't
   been sent yet. Called on a slow cadence (e.g. every 12h) — independent of how
   often the website refreshes its feeds. */
async function pushDigest(articles, windowHours){
  const cutoff = Date.now() - windowHours * 3600 * 1000;
  const fresh = articles
    .filter(a => (a.ts || 0) >= cutoff && !pushed.has(a.url || a.id))
    .sort((a, b) => b.ts - a.ts);
  fresh.forEach(a => pushed.add(a.url || a.id));
  if (!fresh.length) return { sent: 0, fresh: 0 };

  const items = fresh.slice(0, 8);
  const subs = store.load();
  const msgFr = digest(items, 'fr');
  const msgEn = digest(items, 'en');

  if (!isConfigured()) {
    console.log('\n[notify] No provider configured — digest that WOULD be sent:\n' + stripHtml(msgFr) + '\n');
    return { sent: 0, fresh: fresh.length, logged: true };
  }

  let sent = 0;
  if (TG_CHANNEL()) { if (await tgSend(TG_CHANNEL(), msgFr)) sent++; }
  for (const s of (subs.telegram || [])) {
    if (s.chat_id && await tgSend(s.chat_id, s.lang === 'en' ? msgEn : msgFr)) sent++;
  }
  for (const s of (subs.whatsapp || [])) {
    if (await waSend(s.contact, stripHtml(s.lang === 'en' ? msgEn : msgFr))) sent++;
  }
  return { sent, fresh: fresh.length, items: items.length, configured: true };
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

module.exports = { markSeen, pushDigest, handleTelegramUpdate, isConfigured, digest, sendTest,
  newsletterMessage, pushNewsletter };
