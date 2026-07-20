'use strict';
/* Server-side renderer — « Le Fil » design system.
   Everything renders to plain HTML on the server: no client framework,
   no client-side data fetching, one inline stylesheet, ≤200 KB budget.
   Design doc: ~/.gstack/projects/Badara0560-le-vieillard/badaradiallo-main-design-20260720-070710.md */

const { clusterArticles } = require('./cluster');

/* ---------- i18n ---------- */
const L = {
  fr: {
    lang: 'fr', other: 'en', otherLabel: 'EN',
    title: 'Le Vieillard — L’actualité du Mali et de l’Afrique, en clair',
    desc: 'Le moyen le plus rapide et le plus propre de savoir ce qui se passe au Mali, au Sahel et en Afrique. Sans publicité, sans fouillis.',
    tagline: 'L’Afrique au quotidien',
    urgent: 'URGENT', topStories: 'À la une', alsoOn: 'aussi sur',
    readOn: 'Lire sur', why: 'L’essentiel', related: 'À lire aussi',
    briefTitle: 'Le Brief — chaque semaine',
    briefText: 'Les 10 infos qui comptent au Mali et au Sahel, résumées et vérifiables. Gratuit, par Telegram ou e-mail.',
    briefCta: 'Recevoir le Brief', minute: 'min', hour: 'h', day: 'j',
    tabHome: 'À la une', tabBrief: 'Le Brief', tabCup: 'Mondial', tabAlerts: 'Alertes',
    footNote: 'Le Vieillard lit la presse malienne, africaine et internationale pour vous — chaque article renvoie vers sa source.',
    weight: 'Cette page pèse ~{kb} Ko — conçue pour les connexions maliennes.',
    sections: { mali: 'Mali', sahel: 'Sahel', world: 'Afrique & Monde', politics: 'Politique', economy: 'Économie', sport: 'Sport', culture: 'Culture', tech: 'Tech' },
    backHome: '← Toute l’actualité', sourceLabel: 'Source', publishedAgo: 'publié il y a'
  },
  en: {
    lang: 'en', other: 'fr', otherLabel: 'FR',
    title: 'Le Vieillard — Mali & Africa news, made clear',
    desc: 'The fastest, cleanest way to know what is happening in Mali, the Sahel and Africa. No ads, no clutter.',
    tagline: 'Africa, daily',
    urgent: 'BREAKING', topStories: 'Top stories', alsoOn: 'also on',
    readOn: 'Read on', why: 'The gist', related: 'Related',
    briefTitle: 'The Brief — weekly',
    briefText: 'The 10 stories that matter in Mali and the Sahel, summarised and sourced. Free, on Telegram or e-mail.',
    briefCta: 'Get the Brief', minute: 'min', hour: 'h', day: 'd',
    tabHome: 'Top', tabBrief: 'The Brief', tabCup: 'World Cup', tabAlerts: 'Alerts',
    footNote: 'Le Vieillard reads the Malian, African and international press for you — every story links to its source.',
    weight: 'This page weighs ~{kb} KB — built for Malian connections.',
    sections: { mali: 'Mali', sahel: 'Sahel', world: 'Africa & World', politics: 'Politics', economy: 'Economy', sport: 'Sport', culture: 'Culture', tech: 'Tech' },
    backHome: '← All the news', sourceLabel: 'Source', publishedAgo: 'published'
  }
};

/* Section hues (H in HSL) — WCAG-checked against both grounds. */
const CAT_HUE = { mali: 145, sahel: 32, world: 210, politics: 355, economy: 262, sport: 200, culture: 320, tech: 190 };

/* ---------- helpers ---------- */
function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* French typographic polish: NNBSP before double punctuation, real guillemets. */
function frTypo(s, lang){
  if (lang !== 'fr') return s;
  return String(s)
    .replace(/\s*([;:!?»])/g, ' $1')
    .replace(/(«)\s*/g, '« ')
    .replace(/"([^"]+)"/g, '« $1 »');
}

function timeAgo(ts, t){
  const min = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (min < 60) return `${min} ${t.minute}`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ${t.hour}`;
  return `${Math.round(h / 24)} ${t.day}`;
}

/* Deterministic monogram tile for a source (no images needed). */
function hue(str){
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}
function monogram(source){
  const initial = esc((source || '?').replace(/^(le|la|les|the)\s+/i, '').charAt(0).toUpperCase());
  return `<span class="mono" style="--h:${hue(source || '')}" aria-hidden="true">${initial}</span>`;
}

function pick(a, lang){ return (a[lang] && a[lang].title) ? a[lang] : { title: a.title, excerpt: a.excerpt }; }

/* ---------- stylesheet (single inline block, both themes) ---------- */
const CSS = `
:root{--paper:#faf6ee;--ink:#1d1a14;--ink-2:#6b6455;--line:#e6dfd0;--card:#ffffff;
--accent:#1b6b46;--urgent:#b8121b;--sat:62%;--lit:34%;--tile-l:88%}
[data-th=dark]{--paper:#141310;--ink:#f0ece2;--ink-2:#a39b8a;--line:#2c2921;--card:#1c1a16;
--accent:#4fae7e;--urgent:#ff6b71;--sat:45%;--lit:66%;--tile-l:22%}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{background:var(--paper);color:var(--ink);font:17px/1.6 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
padding-bottom:76px}
.serif,h1,h2,h3{font-family:Charter,'Bitstream Charter',Georgia,'Times New Roman',serif}
a{color:inherit;text-decoration:none}
.wrap{max-width:680px;margin:0 auto;padding:0 18px}
header.top{border-bottom:2px solid var(--ink);padding:14px 0 10px}
header.top .wrap{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.brand{font-weight:800;font-size:1.7rem;letter-spacing:-.02em}
.brand em{font-style:normal;color:var(--accent)}
.brand small{display:block;font-family:ui-sans-serif,system-ui,sans-serif;font-weight:500;font-size:.68rem;
letter-spacing:.28em;text-transform:uppercase;color:var(--ink-2);margin-top:2px}
.ctrl{display:flex;gap:8px;align-items:center}
.pill{border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:999px;
padding:5px 12px;font-size:.78rem;font-weight:700;cursor:pointer;font-family:inherit}
.kicker{display:inline-flex;align-items:center;gap:8px;font-size:.72rem;font-weight:800;
letter-spacing:.09em;text-transform:uppercase;color:hsl(var(--h) var(--sat) var(--lit))}
.kicker::before{content:"";width:8px;height:8px;border-radius:2px;background:hsl(var(--h) var(--sat) var(--lit))}
.urgent{background:var(--urgent);color:#fff;border-radius:4px;padding:2px 8px;font-size:.66rem;
font-weight:800;letter-spacing:.08em;animation:pulse 1.6s infinite}
@keyframes pulse{50%{opacity:.55}}
main{padding:20px 0 30px}
.lead-item{padding:6px 0 20px;border-bottom:1px solid var(--line)}
.lead-item h2{font-size:1.85rem;line-height:1.12;letter-spacing:-.015em;margin:8px 0 8px}
.lead-item p{color:var(--ink-2);font-size:1rem;max-width:60ch}
.item{display:flex;gap:14px;padding:16px 0;border-bottom:1px solid var(--line)}
.item .txt{flex:1;min-width:0}
.item h3{font-size:1.14rem;line-height:1.22;margin:5px 0 4px;font-weight:700}
.item:hover h3,.lead-item:hover h2{text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1.5px}
.mono{flex:none;width:52px;height:52px;border-radius:10px;display:grid;place-items:center;
font-family:Charter,Georgia,serif;font-weight:800;font-size:1.35rem;
background:hsl(var(--h) 42% var(--tile-l));color:hsl(var(--h) var(--sat) var(--lit));margin-top:6px}
.meta{font-size:.78rem;color:var(--ink-2);display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.meta b{color:var(--ink);font-weight:600}
.chips{margin-top:5px;font-size:.74rem;color:var(--ink-2)}
.chips span{border:1px solid var(--line);border-radius:999px;padding:1px 8px;margin-right:4px;white-space:nowrap}
.band{margin-top:26px}
.band-head{display:flex;align-items:center;gap:10px;padding-bottom:6px;border-bottom:2px solid var(--ink)}
.band-head h2{font-size:1.15rem}
.band-head .rule{flex:1}
.brief-box{margin:26px 0 4px;border:1.5px solid var(--accent);border-radius:14px;padding:20px;background:var(--card)}
.brief-box h2{color:var(--accent);font-size:1.2rem;margin-bottom:6px}
.brief-box p{font-size:.92rem;color:var(--ink-2);margin-bottom:12px}
.btn{display:inline-block;background:var(--accent);color:#fff;border-radius:10px;padding:11px 20px;
font-weight:700;font-size:.95rem}
.btn.big{display:block;text-align:center;padding:15px;font-size:1.05rem;margin:18px 0}
footer{border-top:2px solid var(--ink);margin-top:34px;padding:22px 0 30px;font-size:.82rem;color:var(--ink-2)}
footer p{margin-bottom:8px;max-width:60ch}
.weight{font-variant-numeric:tabular-nums}
nav.tabs{position:fixed;left:0;right:0;bottom:0;background:var(--card);border-top:1px solid var(--line);
display:flex;justify-content:space-around;padding:7px 4px calc(7px + env(safe-area-inset-bottom));z-index:10}
nav.tabs a{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:.66rem;font-weight:700;
color:var(--ink-2);min-width:64px;padding:4px 6px}
nav.tabs a.on{color:var(--accent)}
nav.tabs .ic{font-size:1.15rem;line-height:1}
article.story{padding:26px 0}
article.story h1{font-size:1.9rem;line-height:1.13;letter-spacing:-.015em;margin:10px 0 10px}
.src-card{display:flex;align-items:center;gap:12px;border:1px solid var(--line);background:var(--card);
border-radius:12px;padding:12px 14px;margin:16px 0}
.src-card .mono{width:44px;height:44px;margin:0;font-size:1.15rem}
.src-card .who{font-size:.85rem;color:var(--ink-2)}
.src-card .who b{display:block;color:var(--ink);font-size:1rem}
.gist{border-left:3px solid var(--accent);padding:2px 0 2px 14px;margin:16px 0;color:var(--ink);font-size:1.02rem}
.gist .lbl{display:block;font-size:.72rem;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--accent);margin-bottom:3px}
.rel{margin-top:26px}
@media(min-width:720px){nav.tabs{position:static;border:0;justify-content:flex-start;gap:18px;
background:none;padding:10px 0 0}
nav.tabs a{flex-direction:row;font-size:.8rem}.item h3{font-size:1.2rem}}
@media(max-width:380px){.lead-item h2{font-size:1.55rem}}`;

/* Tiny inline script: theme toggle only (stored preference, defaults to system). */
const JS = `(function(){var d=document.documentElement,k='lv-th',s;try{s=localStorage.getItem(k)}catch(e){}
if(s)d.dataset.th=s;else if(matchMedia('(prefers-color-scheme: dark)').matches)d.dataset.th='dark';
window.lvTheme=function(){var n=d.dataset.th==='dark'?'light':'dark';d.dataset.th=n;try{localStorage.setItem(k,n)}catch(e){}}})();`;

/* ---------- shared chrome ---------- */
function page({ lang, title, desc, canonical, body, active }){
  const t = L[lang];
  const tabs = [
    ['/', t.tabHome, '▤', 'home'],
    ['/brief', t.tabBrief, '✉', 'brief'],
    ['/worldcup', t.tabCup, '⚽', 'cup'],
    ['/subscribe', t.tabAlerts, '♪'.replace('♪','🔔'), 'alerts']
  ];
  const html = `<!doctype html>
<html lang="${lang}" data-th="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#1b6b46">
<style>${CSS}</style>
<script>${JS}</script>
</head>
<body>
<header class="top"><div class="wrap">
  <a class="brand serif" href="/${lang === 'en' ? '?lang=en' : ''}">Le <em>Vieillard</em><small>${esc(t.tagline)}</small></a>
  <div class="ctrl">
    <a class="pill" href="?lang=${t.other}">${t.otherLabel}</a>
    <button class="pill" onclick="lvTheme()" aria-label="theme">◑</button>
  </div>
</div></header>
${body}
<footer><div class="wrap">
  <p>${esc(t.footNote)}</p>
  <p class="weight">${esc(t.weight)}</p>
  <p>© 2026 Le Vieillard</p>
</div></footer>
<nav class="tabs"><div class="wrap" style="display:contents">
${tabs.map(([href, label, ic, key]) =>
  `<a href="${href}${lang === 'en' ? (href.includes('?') ? '&' : '?') + 'lang=en' : ''}"${key === active ? ' class="on"' : ''}><span class="ic">${ic}</span>${esc(label)}</a>`).join('\n')}
</div></nav>
<script>if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(function(){});</script>
</body></html>`;
  // Fill in the real page weight (the {kb} placeholder is inside t.weight)
  const kb = Math.round(Buffer.byteLength(html, 'utf8') / 1024);
  return html.replace('{kb}', String(kb));
}

/* ---------- homepage: the river ---------- */
function itemHTML(c, lang, t, isLead){
  const a = c.lead;
  const d = pick(a, lang);
  const title = esc(frTypo(d.title, lang));
  const kicker = `<span class="kicker" style="--h:${CAT_HUE[c.cat] ?? 210}">${esc(t.sections[c.cat] || c.cat)}</span>`;
  const urgent = c.breaking && isLead ? ` <span class="urgent">${t.urgent}</span>` : '';
  const meta = `<div class="meta"><b>${esc(a.source)}</b><span>·</span><span>${timeAgo(c.ts, t)}</span></div>`;
  const chips = c.others.length
    ? `<div class="chips">${esc(t.alsoOn)} ${c.others.slice(0, 3).map(o => `<span>${esc(o.source)}</span>`).join('')}</div>`
    : '';
  if (isLead) {
    const ex = d.excerpt ? `<p>${esc(frTypo(d.excerpt, lang))}</p>` : '';
    return `<a class="lead-item" style="display:block" href="/a/${a.id}${lang === 'en' ? '?lang=en' : ''}">
      <div>${kicker}${urgent}</div><h2>${title}</h2>${ex}${meta}${chips}</a>`;
  }
  return `<a class="item" href="/a/${a.id}${lang === 'en' ? '?lang=en' : ''}">
    ${monogram(a.source)}<div class="txt">${kicker}<h3>${title}</h3>${meta}${chips}</div></a>`;
}

function home(articles, lang){
  const t = L[lang];
  const clusters = clusterArticles(articles);
  if (!clusters.length) {
    return page({ lang, title: t.title, desc: t.desc, canonical: 'https://le-vieillard.onrender.com/', active: 'home',
      body: `<main><div class="wrap"><p style="padding:40px 0;color:var(--ink-2)">Chargement des sources… réessayez dans une minute.</p></div></main>` });
  }
  const [lead, ...rest] = clusters;
  const top = rest.slice(0, 6);
  const after = rest.slice(6);

  // Section bands from the remainder, fixed order, 4 items max each
  const order = ['mali', 'sahel', 'politics', 'economy', 'world', 'sport', 'culture', 'tech'];
  const used = new Set();
  const bands = order.map(cat => {
    const items = after.filter(c => c.cat === cat && !used.has(c)).slice(0, 4);
    items.forEach(c => used.add(c));
    return items.length ? { cat, items } : null;
  }).filter(Boolean);

  const briefBox = `<div class="brief-box">
    <h2 class="serif">${esc(t.briefTitle)}</h2>
    <p>${esc(frTypo(t.briefText, lang))}</p>
    <a class="btn" href="/subscribe${lang === 'en' ? '?lang=en' : ''}">${esc(t.briefCta)}</a>
  </div>`;

  const body = `<main><div class="wrap">
    ${itemHTML(lead, lang, t, true)}
    ${top.map(c => itemHTML(c, lang, t, false)).join('\n')}
    ${briefBox}
    ${bands.map(b => `<section class="band">
      <div class="band-head"><span class="kicker" style="--h:${CAT_HUE[b.cat] ?? 210}">${esc(t.sections[b.cat])}</span><span class="rule"></span></div>
      ${b.items.map(c => itemHTML(c, lang, t, false)).join('\n')}
    </section>`).join('\n')}
  </div></main>`;

  return page({ lang, title: t.title, desc: t.desc, canonical: 'https://le-vieillard.onrender.com/', body, active: 'home' });
}

/* ---------- outlink page: /a/:id ---------- */
function story(articles, id, lang){
  const t = L[lang];
  const a = articles.find(x => x.id === id);
  if (!a) return null;
  const d = pick(a, lang);
  const clusters = clusterArticles(articles);
  const mine = clusters.find(c => c.lead.id === id || c.others.some(o => o.id === id));
  const siblings = mine ? [mine.lead, ...mine.others].filter(x => x.id !== id) : [];
  const related = clusters.filter(c => c.cat === a.cat && c.lead.id !== id).slice(0, 3);

  const gist = d.excerpt
    ? `<div class="gist"><span class="lbl">${esc(t.why)}</span>${esc(frTypo(d.excerpt, lang))}</div>` : '';
  const sib = siblings.length
    ? `<div class="chips" style="margin:10px 0 0">${esc(t.alsoOn)} ${siblings.slice(0, 4).map(o => `<span>${esc(o.source)}</span>`).join('')}</div>` : '';

  const body = `<main><div class="wrap"><article class="story">
    <a href="/${lang === 'en' ? '?lang=en' : ''}" class="meta" style="display:inline-flex">${esc(t.backHome)}</a>
    <div style="margin-top:14px"><span class="kicker" style="--h:${CAT_HUE[a.cat] ?? 210}">${esc(t.sections[a.cat] || a.cat)}</span>
    ${a.breaking ? ` <span class="urgent">${t.urgent}</span>` : ''}</div>
    <h1 class="serif">${esc(frTypo(d.title, lang))}</h1>
    <div class="src-card">${monogram(a.source)}
      <div class="who"><b>${esc(a.source)}</b>${esc(t.sourceLabel)} · ${esc(t.publishedAgo)} ${timeAgo(a.ts, t)}</div>
    </div>
    ${gist}${sib}
    <a class="btn big" href="${esc(a.url)}" rel="noopener">${esc(t.readOn)} ${esc(a.source)} →</a>
    ${related.length ? `<section class="rel"><div class="band-head"><h2 class="serif">${esc(t.related)}</h2><span class="rule"></span></div>
      ${related.map(c => itemHTML(c, lang, t, false)).join('\n')}</section>` : ''}
  </article></div></main>`;

  return page({ lang, title: `${d.title} — Le Vieillard`, desc: d.excerpt || d.title,
    canonical: `https://le-vieillard.onrender.com/a/${a.id}`, body, active: 'home' });
}

module.exports = { home, story };
