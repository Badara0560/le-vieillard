'use strict';
/* Le Brief quotidien — the Phase-2 hero product.
   One finite, forwardable morning edition built from the day's clusters:
   Mali first, ~8 items, readable in two minutes, formatted for Telegram
   (HTML) and WhatsApp (plain text with * markdown). Links go through the
   site (/a/:id?c=tg|wa) so clicks are measurable — open rates are dead. */

const { clusterArticles } = require('./cluster');

const SITE = process.env.SITE_URL || 'https://le-vieillard.onrender.com';
const WINDOW_MS = 26 * 3600 * 1000;   // a bit over a day so nothing slips between sends
const MAX_ITEMS = 8;

function pick(a, lang){ return (a[lang] && a[lang].title) ? a[lang] : { title: a.title, excerpt: a.excerpt }; }
function esc(s){ return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* Compose today's edition. Mali leads, then the strongest of everything else,
   newest-first inside each group. Cluster leads only — one line per story. */
function buildDaily(articles){
  const cutoff = Date.now() - WINDOW_MS;
  const clusters = clusterArticles(articles).filter(c => c.ts >= cutoff);

  const mali = clusters.filter(c => c.cat === 'mali');
  const rest = clusters.filter(c => c.cat !== 'mali');
  const chosen = [...mali.slice(0, 5), ...rest].slice(0, MAX_ITEMS);

  const now = new Date();
  const items = chosen.map(c => ({
    id: c.lead.id,
    cat: c.cat,
    source: c.lead.source,
    url: c.lead.url,
    sources: 1 + c.others.length,
    breaking: c.breaking,
    fr: { title: pick(c.lead, 'fr').title },
    en: { title: pick(c.lead, 'en').title }
  }));

  return {
    generated: now.toISOString(),
    day: now.toISOString().slice(0, 10),
    dateFr: now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
    dateEn: now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
    items
  };
}

const T = {
  fr: {
    head: '☀️ LE BRIEF — Le Vieillard',
    sub: 'Le Mali et l’Afrique en 2 minutes',
    multi: 'sources',
    forward: '↪️ Utile ? Faites suivre ce brief à un proche.',
    join: 'Recevoir le Brief chaque matin :',
    read: 'Lire'
  },
  en: {
    head: '☀️ THE BRIEF — Le Vieillard',
    sub: 'Mali & Africa in 2 minutes',
    multi: 'sources',
    forward: '↪️ Useful? Forward this brief to someone.',
    join: 'Get the Brief every morning:',
    read: 'Read'
  }
};

function siteLink(id, channel, lang){
  const l = lang === 'en' ? '&lang=en' : '';
  return `${SITE}/a/${id}?c=${channel}${l}`;
}

/* Telegram: HTML message, numbered, each headline a link into the site. */
function formatTelegram(daily, lang){
  const t = T[lang], date = lang === 'en' ? daily.dateEn : daily.dateFr;
  let m = `<b>${t.head}</b>\n<i>${t.sub} · ${esc(date)}</i>\n`;
  daily.items.forEach((it, i) => {
    const c = it[lang] || it.fr;
    const src = it.sources > 1 ? `${esc(it.source)} +${it.sources - 1}` : esc(it.source);
    m += `\n${i + 1}. <a href="${siteLink(it.id, 'tg', lang)}">${esc(c.title)}</a> — <i>${src}</i>`;
  });
  m += `\n\n${t.forward}\n${t.join} ${SITE}/subscribe`;
  return m;
}

/* WhatsApp: plain text, *bold*, bare URLs (WA auto-links). Built to survive
   forwarding into family groups — short, numbered, no clutter. */
function formatWhatsApp(daily, lang){
  const t = T[lang], date = lang === 'en' ? daily.dateEn : daily.dateFr;
  let m = `*${t.head.replace('☀️ ', '☀️ ')}*\n_${t.sub} · ${date}_\n`;
  daily.items.forEach((it, i) => {
    const c = it[lang] || it.fr;
    m += `\n*${i + 1}.* ${c.title}\n${t.read} : ${siteLink(it.id, 'wa', lang)}\n`;
  });
  m += `\n${t.forward}\n${t.join} ${SITE}/subscribe`;
  return m;
}

module.exports = { buildDaily, formatTelegram, formatWhatsApp };
