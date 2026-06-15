'use strict';
/* Fetch + parse RSS/Atom feeds server-side (no CORS), clean text,
   categorize, and translate title/excerpt into both FR and EN. */

const { clean, dedupeTitle, collapseRepeats } = require('./clean');
const { translate, translatePair } = require('./translate');

/* Branded fallback shown when a feed item has no image (served from /public). */
const PLACEHOLDER = '/placeholder.svg';
const isPlaceholder = url => url === PLACEHOLDER;

/* lang = source language. strip = feed-specific boilerplate regexes. */
const FEEDS = [
  { source: 'RFI Afrique',       cat: 'world', lang: 'fr', url: 'https://www.rfi.fr/fr/afrique/rss' },
  { source: 'France 24 Afrique', cat: 'world', lang: 'fr', url: 'https://www.france24.com/fr/afrique/rss' },
  { source: 'Jeune Afrique',     cat: 'world', lang: 'fr', url: 'https://www.jeuneafrique.com/feed/' },
  { source: 'Le Soft Post',      cat: 'world', lang: 'fr', url: 'https://lesoftpost.com/feed/' },
  { source: 'BBC Africa',        cat: 'world', lang: 'en', url: 'https://feeds.bbci.co.uk/news/world/africa/rss.xml' },
  { source: 'AllAfrica',         cat: 'world', lang: 'en', url: 'https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf' },
  { source: 'Al Jazeera',        cat: 'world', lang: 'en', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { source: 'Maliweb',           cat: 'mali',  lang: 'fr', url: 'https://www.maliweb.net/feed' },
  { source: 'Studio Tamani',     cat: 'mali',  lang: 'fr', url: 'https://studiotamani.org/feed' },
  { source: 'Bamada.net',        cat: 'mali',  lang: 'fr', url: 'https://bamada.net/feed' },
  { source: 'Maliactu',          cat: 'mali',  lang: 'fr', url: 'https://maliactu.net/feed/',
    strip: [/Mali Actu\s*-\s*maliactu\.net[\s\S]*?Informations sur le Mali\s*(?:Mali Actu)?/i, /\bMali Actu\b/g] },
  { source: 'Journal du Mali',   cat: 'mali',  lang: 'fr', url: 'https://www.journaldumali.com/feed/' },
  { source: 'Malijet',           cat: 'mali',  lang: 'fr', url: 'https://malijet.com/feed' },
  { source: 'aBamako',           cat: 'mali',  lang: 'fr', url: 'https://news.abamako.com/rss/rss.xml' }
];

async function fetchText(url){
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeVieillardBot/1.0; +https://levieillard.news)' } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

/* ---- tiny XML helpers (RSS + Atom) ---- */
function blocks(xml, tag){
  const re = new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, 'gi');
  return xml.match(re) || [];
}
function unwrapCdata(s){
  const m = s.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return (m ? m[1] : s).trim();
}
function tagText(block, names){
  for (const n of names) {
    const m = block.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i'));
    if (m) return unwrapCdata(m[1]);
  }
  return '';
}
function attrUrl(block, tag){
  const m = block.match(new RegExp(`<${tag}[^>]*\\b(?:url|href)=["']([^"']+)["']`, 'i'));
  return m ? m[1] : '';
}
function linkOf(block){
  let l = tagText(block, ['link']);
  if (!l) { const m = block.match(/<link[^>]*\bhref=["']([^"']+)["']/i); l = m ? m[1] : ''; }
  return l.trim();
}
function imageOf(block, descHtml){
  let u = attrUrl(block, 'enclosure') || attrUrl(block, 'media:content') || attrUrl(block, 'media:thumbnail');
  if (!u && descHtml) { const m = descHtml.match(/<img[^>]+src=["']([^"']+)["']/i); if (m) u = m[1]; }
  return (u || '').trim();
}

function categorize(text, feed){
  const s = text.toLowerCase();
  if (feed.cat === 'mali' || /\bmali\b|bamako|malien|malienne|kayes|sikasso|s[ée]gou|mopti|tombouctou|\bgao\b|kidal/.test(s)) return 'mali';
  if (/football|\bfoot\b|\bcan\b|coupe d'afrique|\bmatch\b|sport|joueur|aigles|basket|athl[ée]|olympique/.test(s)) return 'sport';
  if (/[ée]conomie|franc cfa|\bcfa\b|banque|march[ée]|bourse|\bor\b|coton|prix|inflation|investiss|\bfmi\b|croissance|budget|dette|commerce/.test(s)) return 'economy';
  if (/num[ée]rique|\btech\b|startup|mobile money|internet|\bia\b|intelligence artificielle|application|fintech|digital/.test(s)) return 'tech';
  if (/musique|festival|\bfilm\b|cin[ée]ma|culture|patrimoine|\blivre\b|artiste|\bdanse\b/.test(s)) return 'culture';
  if (/sahel|\bniger\b|burkina|\baes\b|tchad|mauritanie/.test(s)) return 'sahel';
  if (/pr[ée]sident|ministre|gouvernement|[ée]lection|accord|diploma|sommet|parlement|\bcoup\b|junte|s[ée]curit[ée]/.test(s)) return 'politics';
  return feed.cat || 'world';
}

/* Truncate at a word boundary (no mid-word cuts). */
function truncate(s, n){
  if (s.length <= n) return s;
  let cut = s.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  if (sp > n * 0.6) cut = cut.slice(0, sp);
  return cut.replace(/[\s,;:–—-]+$/, '').trim() + '…';
}

function paragraphs(text){
  if (!text) return [];
  if (text.length < 320) return [text];
  const sents = text.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý0-9«"])/);
  const out = []; let buf = '';
  for (const s of sents) {
    buf += (buf ? ' ' : '') + s;
    if (buf.length > 240) { out.push(buf); buf = ''; }
  }
  if (buf) out.push(buf);
  return out.slice(0, 8);
}

function parseFeed(xml, feed){
  let items = blocks(xml, 'item');
  if (!items.length) items = blocks(xml, 'entry');
  return items.slice(0, 15).map(b => {
    const rawTitle = tagText(b, ['title']);
    let title = collapseRepeats(clean(rawTitle, feed.strip));
    if (!title) return null;
    title = truncate(title, 150);
    const link = linkOf(b) || feed.url;
    const descHtml = tagText(b, ['content:encoded', 'description', 'summary', 'content']);
    let full = collapseRepeats(clean(descHtml || rawTitle, feed.strip));
    full = dedupeTitle(full, title);
    const dateStr = tagText(b, ['pubDate', 'published', 'updated', 'dc:date']);
    const ts = dateStr ? Date.parse(dateStr) : Date.now();
    const cat = categorize(title + ' ' + full, feed);
    const img = imageOf(b, descHtml) || PLACEHOLDER;
    return {
      key: link || title, cat, img, source: feed.source, url: link,
      ts: isNaN(ts) ? Date.now() : ts, srcLang: feed.lang || 'fr',
      title, excerpt: truncate(full, 220), body: paragraphs(full)
    };
  }).filter(Boolean);
}

/* Fill a[fr] and a[en] for title+excerpt (source kept as-is, other translated). */
async function translateList(all){
  let i = 0;
  const worker = async () => {
    while (i < all.length) {
      const a = all[i++];
      const other = a.srcLang === 'fr' ? 'en' : 'fr';
      a[a.srcLang] = { title: a.title, excerpt: a.excerpt };
      const pair = await translatePair(a.title, a.excerpt, other);
      a[other] = pair ? { title: pair.title, excerpt: pair.excerpt }
                      : { title: a.title, excerpt: a.excerpt };
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));
}

/* Translate an article body into `lang` on demand (cached in translate.js). */
async function translateBody(article, lang){
  if (!article) return [];
  if (lang === article.srcLang) return article.body;
  const out = await Promise.all(article.body.map(async p => (await translate(p, lang)) || p));
  return out;
}

/* Build the full, translated article set. */
async function build(){
  const lists = await Promise.all(FEEDS.map(async f => {
    const xml = await fetchText(f.url);
    if (!xml) return [];
    try { return parseFeed(xml, f); } catch { return []; }
  }));
  let all = lists.flat();

  const seen = new Set();
  all = all.filter(a => (seen.has(a.key) ? false : (seen.add(a.key), true)));
  all.sort((a, b) => b.ts - a.ts);
  all = all.slice(0, 60);

  await translateList(all);

  all.forEach((a, idx) => { a.id = idx + 1; });
  const lead = all.find(a => !isPlaceholder(a.img)) || all[0];
  if (lead) lead.lead = true;

  const now = Date.now();
  all.forEach(a => { a.breaking = (now - a.ts) < 6 * 3600 * 1000; }); // < 6h
  if (!all.some(a => a.breaking)) all.slice(0, 6).forEach(a => { a.breaking = true; });

  return all;
}

module.exports = { FEEDS, build, translateBody };
