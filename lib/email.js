'use strict';
/* E-mail delivery via Brevo (Badara's standard provider).
   Zero-dependency: global fetch, Node >= 18.
   The API key is NEVER stored in this repo — it is read from the environment
   (BREVO_API_KEY / BREVO_FROM), pasted by Badara into the host's env vars.
   Sending is fire-and-forget: a Brevo outage must never break the Brief. */

const KEY  = () => process.env.BREVO_API_KEY || '';
const FROM = () => process.env.BREVO_FROM || '';            // must be verified at Brevo
const SITE = () => process.env.SITE_URL || 'https://le-vieillard.onrender.com';

function configured(){ return !!(KEY() && FROM()); }

/* Send one transactional e-mail. Returns true/false, never throws. */
async function send({ to, subject, text, html }){
  if (!configured()) return false;
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': KEY(), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: FROM(), name: 'Le Vieillard' },
        to: [{ email: to }],
        subject,
        textContent: text,
        ...(html ? { htmlContent: html } : {})
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[email] Brevo ${res.status}: ${body.slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[email] send failed:', e.message);
    return false;
  }
}

function esc(s){
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* Render the daily Brief as an e-mail. Plain text is the source of truth;
   the HTML part mirrors the site's editorial voice with inline styles only
   (mail clients strip <style>), and stays small for metered connections. */
function briefEmail(daily, lang){
  const L = lang === 'en'
    ? { subject: 'The Brief', sub: 'Mali & Africa in 2 minutes', read: 'Read',
        forward: 'Useful? Forward this brief to someone.',
        unsub: 'Unsubscribe', site: 'Read everything on Le Vieillard' }
    : { subject: 'Le Brief', sub: 'Le Mali et l’Afrique en 2 minutes', read: 'Lire',
        forward: 'Utile ? Faites suivre ce brief à un proche.',
        unsub: 'Se désabonner', site: 'Toute l’actualité sur Le Vieillard' };
  const date = lang === 'en' ? daily.dateEn : daily.dateFr;

  const text = [
    `${L.subject} — ${L.sub} · ${date}`, '',
    ...daily.items.map((it, i) => {
      const c = it[lang] || it.fr;
      return `${i + 1}. ${c.title} — ${it.source}\n   ${SITE()}/a/${it.id}?c=em${lang === 'en' ? '&lang=en' : ''}`;
    }),
    '', L.forward, `${L.site} : ${SITE()}/`
  ].join('\n');

  const rows = daily.items.map((it, i) => {
    const c = it[lang] || it.fr;
    const url = `${SITE()}/a/${it.id}?c=em${lang === 'en' ? '&lang=en' : ''}`;
    return `<tr><td style="padding:12px 0;border-bottom:1px solid #e6dfd0">
      <span style="color:#1b6b46;font-weight:700;font-size:13px">${i + 1}</span>
      <a href="${esc(url)}" style="color:#1d1a14;text-decoration:none;font-family:Georgia,serif;font-size:17px;font-weight:700"> ${esc(c.title)}</a>
      <div style="color:#5d5748;font-size:12px;padding-top:3px">${esc(it.source)}</div></td></tr>`;
  }).join('');

  const html = `<div style="background:#faf6ee;padding:22px 14px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
<div style="max-width:600px;margin:0 auto">
  <div style="border-bottom:2px solid #1d1a14;padding-bottom:10px">
    <div style="font-family:Georgia,serif;font-size:24px;font-weight:800;color:#1d1a14">Le <span style="color:#1b6b46">Vieillard</span></div>
    <div style="color:#5d5748;font-size:12px;letter-spacing:.18em;text-transform:uppercase;padding-top:3px">${esc(L.sub)} · ${esc(date)}</div>
  </div>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${rows}</table>
  <p style="color:#5d5748;font-size:13px;padding-top:18px">${esc(L.forward)}</p>
  <p style="padding-top:6px"><a href="${esc(SITE())}/" style="color:#1b6b46;font-weight:700;text-decoration:none">${esc(L.site)} →</a></p>
  <p style="color:#8a8272;font-size:11px;padding-top:18px;border-top:1px solid #e6dfd0;margin-top:18px">
    <a href="${esc(SITE())}/unsubscribe?e={{contact}}" style="color:#8a8272">${esc(L.unsub)}</a>
  </p>
</div></div>`;

  return { subject: `${L.subject} — ${date}`, text, html };
}

/* Send the Brief to every e-mail subscriber, in their language. */
async function sendBriefEmails(subscribers, dailyFr, dailyEn){
  if (!configured()) {
    console.log(`[email] Brevo not configured — would send to ${subscribers.length} subscriber(s)`);
    return { sent: 0, skipped: subscribers.length, logged: true };
  }
  let sent = 0;
  for (const s of subscribers) {
    const daily = s.lang === 'en' ? dailyEn : dailyFr;
    const mail = briefEmail(daily, s.lang === 'en' ? 'en' : 'fr');
    const html = mail.html.replace('{{contact}}', encodeURIComponent(s.contact));
    if (await send({ to: s.contact, subject: mail.subject, text: mail.text, html })) sent++;
  }
  return { sent, total: subscribers.length };
}

module.exports = { configured, send, briefEmail, sendBriefEmails };
