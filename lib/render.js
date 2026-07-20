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
    briefTitle: 'Le Brief — chaque matin à 7 h',
    briefText: 'Le Mali et l’Afrique en 2 minutes, chaque matin à 7 h. Gratuit, par e-mail ou sur Telegram.',
    briefCta: 'Recevoir le Brief', minute: 'min', hour: 'h', day: 'j',
    tabHome: 'À la une', tabBrief: 'Le Point', tabCup: 'Mondial', tabAlerts: 'Alertes',
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
    briefTitle: 'The Brief — every morning at 7',
    briefText: 'Mali & Africa in 2 minutes, every morning at 7. Free, by e-mail or on Telegram.',
    briefCta: 'Get the Brief', minute: 'min', hour: 'h', day: 'd',
    tabHome: 'Top', tabBrief: 'The Point', tabCup: 'World Cup', tabAlerts: 'Alerts',
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

/* Badge discipline — a signal that fires on everything signals nothing.
   URGENT is reserved for events several outlets picked up (that is what makes
   something actually breaking, rather than merely recent). */
function isUrgent(cluster){ return !!cluster.breaking && cluster.others.length >= 2; }

/* "L'essentiel" must be a real sentence, not a truncated feed fragment.
   No gist reads as restraint; a cut-off one reads as broken. */
function usableGist(excerpt){
  if (!excerpt) return '';
  const s = String(excerpt).trim();
  if (s.length < 80) return '';
  if (!/[.!?»"]$/.test(s)) return '';
  return s;
}

/* ---------- stylesheet (single inline block, both themes) ---------- */
const CSS = `
:root{--paper:#faf6ee;--ink:#1d1a14;--ink-2:#5d5748;--line:#e6dfd0;--card:#ffffff;
--accent:#1b6b46;--urgent:#b8121b;--on-accent:#fff;--on-urgent:#fff;
--sat:62%;--lit:34%;--tile-l:88%;
--ease:cubic-bezier(.22,1,.36,1)}
[data-th=dark]{--paper:#141310;--ink:#f0ece2;--ink-2:#a8a08f;--line:#2c2921;--card:#1c1a16;
--accent:#4fae7e;--urgent:#ff6b71;--on-accent:#08160f;--on-urgent:#2b0a0c;
--sat:45%;--lit:66%;--tile-l:22%}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
@view-transition{navigation:auto}
body{background:var(--paper);color:var(--ink);font:17px/1.6 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
padding-bottom:76px;-webkit-tap-highlight-color:transparent}
.serif,h1,h2,h3{font-family:Charter,'Bitstream Charter',Georgia,'Times New Roman',serif}
h1,h2,h3{text-wrap:balance}
::selection{background:var(--accent);color:#fff}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:2px}
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
min-height:44px;min-width:44px;padding:6px 14px;display:inline-flex;align-items:center;justify-content:center;
font-size:.8rem;font-weight:700;cursor:pointer;font-family:inherit}
.kicker{display:inline-flex;align-items:center;gap:8px;font-size:.72rem;font-weight:800;
letter-spacing:.09em;text-transform:uppercase;color:hsl(var(--h) var(--sat) var(--lit))}
.kicker::before{content:"";width:8px;height:8px;border-radius:2px;background:hsl(var(--h) var(--sat) var(--lit))}
.urgent{background:var(--urgent);color:var(--on-urgent);border-radius:4px;padding:2px 8px;font-size:.66rem;
font-weight:800;letter-spacing:.08em;animation:pulse 1.6s ease-in-out 6}
@keyframes pulse{50%{opacity:.58}}
.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.back{display:inline-flex;align-items:center;min-height:44px;font-size:.88rem;font-weight:600;color:var(--ink-2)}
.back:hover{color:var(--accent)}
main{padding:24px 0 34px}
/* Entrance: one gentle rise on load, staggered down the river.
   NOTE: animation-fill-mode backwards holds each row at opacity:0 until its
   delay elapses. Safe here only because this stylesheet is inline (no blocking
   fetch) and every delay is under 0.45s; reduced-motion disables it below. */
@keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
main .wrap>*{animation:rise .65s var(--ease) backwards}
main .wrap>*:nth-child(1){animation-delay:.03s}
main .wrap>*:nth-child(2){animation-delay:.09s}
main .wrap>*:nth-child(3){animation-delay:.15s}
main .wrap>*:nth-child(4){animation-delay:.21s}
main .wrap>*:nth-child(5){animation-delay:.27s}
main .wrap>*:nth-child(6){animation-delay:.33s}
main .wrap>*:nth-child(7){animation-delay:.38s}
main .wrap>*:nth-child(n+8){animation-delay:.42s}
.lead-item{padding:10px 0 24px;border-bottom:1px solid var(--line)}
.lead-item h2{font-size:clamp(1.7rem,5.5vw,2.35rem);line-height:1.08;letter-spacing:-.02em;margin:10px 0 10px}
.lead-item p{color:var(--ink-2);font-size:1.02rem;max-width:62ch;text-wrap:pretty}
.item{display:flex;gap:14px;padding:17px 0;border-bottom:1px solid var(--line)}
.item .txt{flex:1;min-width:0}
.item h3{font-size:1.14rem;line-height:1.24;margin:5px 0 4px;font-weight:700}
.item h3,.lead-item h2{transition:color .45s var(--ease)}
.item:hover h3,.lead-item:hover h2{text-decoration:underline;text-underline-offset:4px;text-decoration-thickness:1.5px;text-decoration-color:var(--accent)}
.mono{flex:none;width:52px;height:52px;border-radius:10px;display:grid;place-items:center;
font-family:Charter,Georgia,serif;font-weight:800;font-size:1.35rem;
background:hsl(var(--h) 42% var(--tile-l));color:hsl(var(--h) var(--sat) var(--lit));margin-top:6px;
transition:transform .5s var(--ease)}
.item:hover .mono{transform:scale(1.06) rotate(-2deg)}
.meta{font-size:.78rem;color:var(--ink-2);display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-variant-numeric:tabular-nums}
.meta b{color:var(--ink);font-weight:600}
.chips{margin-top:5px;font-size:.74rem;color:var(--ink-2)}
.chips span{border:1px solid var(--line);border-radius:999px;padding:1px 8px;margin-right:4px;white-space:nowrap}
.band{margin-top:38px}
.band-head{display:flex;align-items:center;gap:10px;padding-bottom:7px;border-bottom:2px solid var(--ink);position:relative}
.band-head::after{content:"";position:absolute;left:0;right:0;bottom:-5px;border-bottom:1px solid var(--line)}
.band-head h2{font-size:1.15rem}
.band-head .rule{flex:1}
.brief-box{margin:26px 0 4px;border:1.5px solid var(--accent);border-radius:14px;padding:20px;background:var(--card)}
.brief-box h2{color:var(--accent);font-size:1.2rem;margin-bottom:6px}
.brief-box p{font-size:.92rem;color:var(--ink-2);margin-bottom:12px}
.brief-peek{list-style:none;margin:0 0 14px;counter-reset:bp}
.brief-peek li{counter-increment:bp;display:flex;gap:10px;align-items:baseline;padding:7px 0;border-top:1px solid var(--line);font-size:.95rem;line-height:1.35}
.brief-peek li::before{content:counter(bp);font-family:Charter,Georgia,serif;font-weight:800;color:var(--accent);min-width:16px}
.brief-peek a{font-weight:600}
.brief-peek a:hover{text-decoration:underline;text-underline-offset:3px}
.bp-src{font-size:.72rem;color:var(--ink-2);white-space:nowrap}
.btn.wa{background:#25d366;box-shadow:none}
.btn:disabled{opacity:.62;cursor:progress}
.chan{border:0;padding:0;margin:0 0 18px;display:flex;gap:10px;flex-wrap:wrap}
.chan legend{font-size:.8rem;font-weight:700;color:var(--ink-2);margin-bottom:8px;padding:0}
.chan-opt{flex:1 1 140px;min-height:52px;display:flex;align-items:center;gap:9px;
border:1.5px solid var(--line);border-radius:12px;padding:12px 14px;cursor:pointer;
background:var(--card);font-weight:700;font-size:.95rem;transition:border-color .3s var(--ease),background .3s var(--ease)}
.chan-opt input{accent-color:var(--accent);width:18px;height:18px;flex:none}
.chan-opt:has(input:checked){border-color:var(--accent);background:color-mix(in srgb,var(--accent) 8%,var(--card))}
.chan-opt:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:2px}
.fld{display:block;font-size:.8rem;font-weight:700;color:var(--ink-2);margin-bottom:6px}
.inp{width:100%;min-height:52px;padding:14px;border:1px solid var(--line);border-radius:12px;
background:var(--card);color:var(--ink);font:inherit;margin-bottom:16px}
.inp::placeholder{color:var(--ink-2);opacity:.85}
.inp:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-color:var(--accent)}
.btn{display:inline-block;background:var(--accent);color:var(--on-accent);border-radius:10px;padding:11px 20px;
font-weight:700;font-size:.95rem;transition:transform .4s var(--ease),filter .4s var(--ease)}
.btn:hover{transform:translateY(-1px);filter:brightness(1.06)}
.btn:active{transform:translateY(0) scale(.98)}
.btn.big{display:block;text-align:center;padding:15px;font-size:1.05rem;margin:18px 0}
.pill{transition:transform .4s var(--ease),border-color .4s var(--ease)}
.pill:hover{border-color:var(--ink)}
.pill:active{transform:scale(.95)}
footer{border-top:2px solid var(--ink);margin-top:34px;padding:22px 0 30px;font-size:.82rem;color:var(--ink-2)}
footer p{margin-bottom:8px;max-width:60ch}
.weight{font-variant-numeric:tabular-nums}
nav.tabs{position:fixed;left:0;right:0;bottom:0;background:var(--card);border-top:1px solid var(--line);
display:flex;padding:0 4px calc(4px + env(safe-area-inset-bottom));z-index:10}
nav.tabs .wrap{display:flex;justify-content:space-around;padding:0;width:100%}
nav.tabs a{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
font-size:.66rem;font-weight:700;color:var(--ink-2);flex:1;min-height:50px;padding:5px 6px}
nav.tabs a.on{color:var(--accent)}
nav.tabs .ic{font-size:1.15rem;line-height:1}
.skip{position:absolute;left:-9999px;top:0;background:var(--accent);color:var(--on-accent);
padding:12px 18px;font-weight:700;border-radius:0 0 10px 0;z-index:99}
.skip:focus{left:0}
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
article.story h1{font-size:clamp(1.7rem,5.5vw,2.3rem)}
/* Desktop: the tab bar is the ONLY nav, so it must not fall to the bottom of the
   document. Pin it under the masthead as a real horizontal nav. */
@media(min-width:720px){
body{padding-bottom:0}
nav.tabs{position:sticky;top:0;z-index:5;border-top:0;border-bottom:1px solid var(--line);
justify-content:flex-start;gap:6px;padding:0;background:var(--paper)}
nav.tabs .wrap{display:flex;gap:6px;max-width:680px;margin:0 auto;padding:0 18px;width:100%}
nav.tabs a{flex-direction:row;gap:8px;font-size:.84rem;min-width:0;padding:11px 14px;
border-bottom:2px solid transparent}
nav.tabs a.on{border-bottom-color:var(--accent)}
.item h3{font-size:1.2rem}}
@media(max-width:380px){.lead-item h2{font-size:1.55rem}}
@media(prefers-reduced-motion:reduce){
html{scroll-behavior:auto}
main .wrap>*{animation:none}
.urgent{animation:none}
.btn,.pill,.mono,.item h3,.lead-item h2{transition:none}}`;

/* Tiny inline script: theme toggle only (stored preference, defaults to system). */
const JS = `(function(){var d=document.documentElement,k='lv-th',s;try{s=localStorage.getItem(k)}catch(e){}
if(s)d.dataset.th=s;else if(matchMedia('(prefers-color-scheme: dark)').matches)d.dataset.th='dark';
function label(b){if(!b)return;var dark=d.dataset.th==='dark';b.setAttribute('aria-pressed',dark?'true':'false');
b.setAttribute('aria-label',document.documentElement.lang==='en'
?(dark?'Switch to light mode':'Switch to dark mode')
:(dark?'Basculer en mode clair':'Basculer en mode sombre'));}
window.lvTheme=function(b){var n=d.dataset.th==='dark'?'light':'dark';d.dataset.th=n;
try{localStorage.setItem(k,n)}catch(e){}label(b);};
document.addEventListener('DOMContentLoaded',function(){label(document.querySelector('.ctrl .pill[aria-pressed]'));});})();`;

/* ---------- shared chrome ---------- */
function page({ lang, title, desc, canonical, body, active }){
  const t = L[lang];
  /* World Cup 2026 is over — tab retired; /worldcup stays reachable by URL. */
  const tabs = [
    ['/', t.tabHome, '▤', 'home'],
    ['/brief', t.tabBrief, '✉', 'brief'],
    ['/subscribe', t.tabAlerts, '🔔', 'alerts']
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
<a class="skip" href="#main">${lang === 'en' ? 'Skip to the news' : 'Aller à l’actualité'}</a>
<header class="top"><div class="wrap">
  <a class="brand serif" href="/${lang === 'en' ? '?lang=en' : ''}">Le <em>Vieillard</em><small>${esc(t.tagline)}</small></a>
  <div class="ctrl">
    <a class="pill" href="?lang=${t.other}" hreflang="${t.other}" aria-label="${lang === 'fr' ? 'Read in English' : 'Lire en français'}">${t.otherLabel}</a>
    <button class="pill" onclick="lvTheme(this)" aria-pressed="false"
      aria-label="${lang === 'fr' ? 'Basculer en mode sombre' : 'Switch to dark mode'}">◑</button>
  </div>
</div></header>
<nav class="tabs" aria-label="${lang === 'fr' ? 'Sections' : 'Sections'}"><div class="wrap">
${tabs.map(([href, label, ic, key]) =>
  `<a href="${href}${lang === 'en' ? (href.includes('?') ? '&' : '?') + 'lang=en' : ''}"${key === active ? ' class="on" aria-current="page"' : ''}><span class="ic" aria-hidden="true">${ic}</span>${esc(label)}</a>`).join('\n')}
</div></nav>
${body}
<footer><div class="wrap">
  <p>${esc(t.footNote)}</p>
  <p class="weight">${esc(t.weight)}</p>
  <p>© 2026 Le Vieillard</p>
</div></footer>
<script>if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(function(){});</script>
</body></html>`;
  // Fill in the real page weight (the {kb} placeholder is inside t.weight)
  const kb = Math.round(Buffer.byteLength(html, 'utf8') / 1024);
  return html.replace('{kb}', String(kb));
}

/* ---------- homepage: the river ---------- */
/* `inBand` = the section this row is rendered under. Inside a labelled band the
   per-row kicker just repeats the band title five times, so it's suppressed. */
function itemHTML(c, lang, t, isLead, inBand){
  const a = c.lead;
  const d = pick(a, lang);
  const title = esc(frTypo(d.title, lang));
  const kicker = inBand === c.cat ? ''
    : `<span class="kicker" style="--h:${CAT_HUE[c.cat] ?? 210}">${esc(t.sections[c.cat] || c.cat)}</span>`;
  const urgent = isLead && isUrgent(c) ? ` <span class="urgent">${t.urgent}</span>` : '';
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

function home(articles, lang, daily){
  const t = L[lang];
  const clusters = clusterArticles(articles);
  if (!clusters.length) {
    return page({ lang, title: t.title, desc: t.desc, canonical: 'https://le-vieillard.onrender.com/', active: 'home',
      body: `<main id="main"><div class="wrap"><p style="padding:40px 0;color:var(--ink-2)">Chargement des sources… réessayez dans une minute.</p></div></main>` });
  }
  /* Editorial lead: among the 12 freshest clusters, a story covered by several
     sources (a real event) beats "whatever arrived last"; hard news (mali,
     breaking) beats sport/culture trivia. Recency breaks ties. */
  const pool = clusters.slice(0, 12);
  const leadScore = c => c.others.length * 4 + (c.breaking ? 2 : 0)
    + (c.cat === 'mali' ? 2 : 0) + (c.cat === 'sport' || c.cat === 'culture' ? -2 : 0);
  const lead = pool.reduce((best, c) => leadScore(c) > leadScore(best) ? c : best, pool[0]);
  const rest = clusters.filter(c => c !== lead);
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

  /* "Here's the product, want it delivered?" — today's actual Brief inline,
     not a blind signup box. Converts far better (benchmark research). */
  const dailyItems = (daily && daily.items ? daily.items.slice(0, 3) : []);
  const briefPreview = dailyItems.length
    ? `<ol class="brief-peek">${dailyItems.map(it => {
        const c = it[lang] || it.fr;
        return `<li><a href="/a/${it.id}?c=site${lang === 'en' ? '&lang=en' : ''}">${esc(frTypo(c.title, lang))}</a>
          <span class="bp-src">${esc(it.source)}</span></li>`;
      }).join('')}</ol>`
    : '';
  const briefBox = `<div class="brief-box">
    <h2 class="serif">${esc(t.briefTitle)}</h2>
    <p>${esc(frTypo(t.briefText, lang))}</p>
    ${briefPreview}
    <a class="btn" href="/subscribe${lang === 'en' ? '?lang=en' : ''}">${esc(t.briefCta)}</a>
  </div>`;

  const body = `<main id="main"><div class="wrap">
    ${itemHTML(lead, lang, t, true)}
    ${top.map(c => itemHTML(c, lang, t, false)).join('\n')}
    ${briefBox}
    ${bands.map(b => `<section class="band">
      <div class="band-head"><span class="kicker" style="--h:${CAT_HUE[b.cat] ?? 210}">${esc(t.sections[b.cat])}</span><span class="rule"></span></div>
      ${b.items.map(c => itemHTML(c, lang, t, false, b.cat)).join("\n")}
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

  const gistText = usableGist(d.excerpt);
  const gist = gistText
    ? `<div class="gist"><span class="lbl">${esc(t.why)}</span>${esc(frTypo(gistText, lang))}</div>` : '';
  const sib = siblings.length
    ? `<div class="chips" style="margin:10px 0 0">${esc(t.alsoOn)} ${siblings.slice(0, 4).map(o => `<span>${esc(o.source)}</span>`).join('')}</div>` : '';

  const body = `<main id="main"><div class="wrap"><article class="story">
    <a href="/${lang === 'en' ? '?lang=en' : ''}" class="back">${esc(t.backHome)}</a>
    <div style="margin-top:14px"><span class="kicker" style="--h:${CAT_HUE[a.cat] ?? 210}">${esc(t.sections[a.cat] || a.cat)}</span>
    ${mine && isUrgent(mine) ? ` <span class="urgent">${t.urgent}</span>` : ''}</div>
    <h1 class="serif">${esc(frTypo(d.title, lang))}</h1>
    <div class="src-card">${monogram(a.source)}
      <div class="who"><b>${esc(a.source)}</b>${esc(t.sourceLabel)} · ${esc(t.publishedAgo)} ${timeAgo(a.ts, t)}</div>
    </div>
    ${gist}${sib}
    <a class="btn big" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(t.readOn)} ${esc(a.source)} <span aria-hidden="true">↗</span><span class="sr">${lang === 'fr' ? ' (nouvel onglet)' : ' (opens in a new tab)'}</span></a>
    ${related.length ? `<section class="rel"><div class="band-head"><h2 class="serif">${esc(t.related)}</h2><span class="rule"></span></div>
      ${related.map(c => itemHTML(c, lang, t, false)).join('\n')}</section>` : ''}
  </article></div></main>`;

  return page({ lang, title: `${d.title} — Le Vieillard`, desc: d.excerpt || d.title,
    canonical: `https://le-vieillard.onrender.com/a/${a.id}`, body, active: 'home' });
}

/* ---------- subscribe page: /subscribe ---------- */
const SUB = {
  fr: {
    title: 'Recevoir Le Brief — Le Vieillard',
    h1: 'Recevoir Le Brief',
    sub: 'Le Mali, le Sahel et l’Afrique en 2 minutes : les titres qui comptent, avec leurs sources. Un seul envoi, chaque matin à 7 h.',
    join: 'Rejoindre sur Telegram →', soon: 'La chaîne Telegram ouvre très bientôt.',
    choose: 'Comment voulez-vous le recevoir ?',
    byEmail: 'Par e-mail', byTg: 'Sur Telegram',
    emailLabel: 'Votre adresse e-mail', emailPh: 'vous@exemple.com',
    tgLabel: 'Votre pseudo Telegram ou numéro', tgPh: '@pseudo ou +223…',
    name: 'Prénom (optionnel)', namePh: 'Aïssata',
    submit: 'Recevoir Le Brief', sending: 'Envoi…',
    ok: '✅ C’est fait. Le prochain Brief arrive demain à 7 h.',
    okPending: '✅ Vous êtes sur la liste. Nous vous écrirons dès l’ouverture des envois.',
    already: 'ℹ️ Vous êtes déjà inscrit.',
    err: 'Une erreur est survenue. Réessayez.',
    p1: 'Gratuit', p2: 'Un envoi par jour, à 7 h', p3: 'Désabonnement en un clic'
  },
  en: {
    title: 'Get The Brief — Le Vieillard',
    h1: 'Get The Brief',
    sub: 'Mali, the Sahel and Africa in 2 minutes: the headlines that matter, with their sources. One send, every morning at 7.',
    join: 'Join on Telegram →', soon: 'The Telegram channel opens very soon.',
    choose: 'How would you like to receive it?',
    byEmail: 'By e-mail', byTg: 'On Telegram',
    emailLabel: 'Your e-mail address', emailPh: 'you@example.com',
    tgLabel: 'Your Telegram handle or number', tgPh: '@handle or +223…',
    name: 'First name (optional)', namePh: 'Aïssata',
    submit: 'Get The Brief', sending: 'Sending…',
    ok: '✅ Done. Your next Brief arrives tomorrow at 7.',
    okPending: '✅ You are on the list. We will write as soon as sending opens.',
    already: 'ℹ️ You are already subscribed.',
    err: 'Something went wrong. Please try again.',
    p1: 'Free', p2: 'One send a day, at 7am', p3: 'One-click unsubscribe'
  }
};

function subscribe(lang, config){
  const t = L[lang], s = SUB[lang];
  const tgHref = config.telegramChannel ? `https://t.me/${esc(config.telegramChannel)}`
    : (config.telegramBot ? `https://t.me/${esc(config.telegramBot)}?start=subscribe` : '');
  const body = `<main id="main"><div class="wrap"><article class="story">
    <div><span class="kicker" style="--h:145">${lang === 'fr' ? 'Alertes' : 'Alerts'}</span></div>
    <h1 class="serif">${esc(frTypo(s.h1, lang))}</h1>
    <p style="color:var(--ink-2);max-width:56ch">${esc(frTypo(s.sub, lang))}</p>
    ${tgHref ? `<a class="btn big" href="${tgHref}" rel="noopener">${esc(s.join)}</a>`
             : `<div class="gist"><span class="lbl">Info</span>${esc(s.soon)}</div>`}
    ${config.waChannel ? `<a class="btn big wa" href="${esc(config.waChannel)}" rel="noopener">${lang === 'fr' ? 'Rejoindre la chaîne WhatsApp →' : 'Join the WhatsApp Channel →'}</a>` : ''}

    <form id="f" style="margin-top:22px" novalidate>
      <fieldset class="chan">
        <legend>${esc(frTypo(s.choose, lang))}</legend>
        <label class="chan-opt"><input type="radio" name="channel" value="email" checked><span>✉︎ ${esc(s.byEmail)}</span></label>
        <label class="chan-opt"><input type="radio" name="channel" value="telegram"><span>✈︎ ${esc(s.byTg)}</span></label>
      </fieldset>

      <label class="fld" id="contactLabel" for="contact">${esc(s.emailLabel)}</label>
      <input class="inp" id="contact" name="contact" type="email" inputmode="email"
             autocomplete="email" autocapitalize="none" autocorrect="off" spellcheck="false"
             placeholder="${esc(s.emailPh)}" required aria-describedby="msg">

      <label class="fld" for="sname">${esc(s.name)}</label>
      <input class="inp" id="sname" name="name" type="text" autocomplete="given-name" placeholder="${esc(s.namePh)}">

      <button class="btn" id="sub" type="submit" style="border:0;cursor:pointer;font:inherit;font-weight:700;width:100%">${esc(s.submit)}</button>
      <p id="msg" role="status" aria-live="polite" style="margin-top:12px;font-weight:600;display:none"></p>
    </form>
    <p style="margin-top:20px;font-size:.85rem;color:var(--ink-2)">✓ ${esc(s.p1)} · ✓ ${esc(frTypo(s.p2, lang))} · ✓ ${esc(frTypo(s.p3, lang))}</p>
  </article></div></main>
<script>(function(){
var S=${JSON.stringify({ ok: s.ok, okPending: s.okPending, already: s.already, err: s.err,
  emailLabel: s.emailLabel, emailPh: s.emailPh, tgLabel: s.tgLabel, tgPh: s.tgPh,
  submit: s.submit, sending: s.sending })};
var f=document.getElementById('f'),m=document.getElementById('msg'),
    c=document.getElementById('contact'),lab=document.getElementById('contactLabel'),btn=document.getElementById('sub');
function chan(){var r=f.querySelector('input[name=channel]:checked');return r?r.value:'email';}
function sync(){
  if(chan()==='telegram'){lab.textContent=S.tgLabel;c.placeholder=S.tgPh;c.type='text';
    c.setAttribute('inputmode','text');c.setAttribute('autocomplete','username');}
  else{lab.textContent=S.emailLabel;c.placeholder=S.emailPh;c.type='email';
    c.setAttribute('inputmode','email');c.setAttribute('autocomplete','email');}
  c.setAttribute('autocapitalize','none');
}
f.querySelectorAll('input[name=channel]').forEach(function(r){r.addEventListener('change',sync);});
sync();
f.addEventListener('submit',async function(e){e.preventDefault();
  if(btn.disabled)return;
  btn.disabled=true;btn.dataset.t=btn.textContent;btn.textContent=S.sending;
  m.style.display='none';
  var fd=new FormData(f);
  try{
    var r=await fetch('/api/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({channel:chan(),contact:fd.get('contact'),name:fd.get('name'),lang:${JSON.stringify(lang)}})});
    var j=await r.json();m.style.display='block';
    if(j.ok){m.style.color='var(--accent)';
      m.textContent=j.already?S.already:(j.pending?S.okPending:S.ok);f.reset();sync();}
    else{m.style.color='var(--urgent)';m.textContent=j.error||S.err;c.focus();}
  }catch(err){m.style.display='block';m.style.color='var(--urgent)';m.textContent=S.err;}
  btn.disabled=false;btn.textContent=btn.dataset.t;
});})();</script>`;
  return page({ lang, title: s.title, desc: s.sub,
    canonical: 'https://le-vieillard.onrender.com/subscribe', body, active: 'alerts' });
}

/* ---------- weekly Brief page: /brief ---------- */
function brief(issue, lang){
  const t = L[lang];
  const link = (id, extra) => `/a/${id}${lang === 'en' ? '?lang=en' : ''}${extra || ''}`;
  const li = it => `<a class="item" href="${link(it.id)}">${monogram(it.source)}
    <div class="txt"><h3>${esc(frTypo(it.title, lang))}</h3>
    <div class="meta"><b>${esc(it.source)}</b></div></div></a>`;

  const deep = issue.deep ? `
    <div style="margin-top:18px"><span class="kicker" style="--h:${CAT_HUE[issue.deep.cat] ?? 262}">${lang === 'fr' ? 'Le dossier' : 'Deep dive'}</span></div>
    <a class="lead-item" style="display:block" href="${link(issue.deep.id)}">
      <h2 class="serif">${esc(frTypo(issue.deep.title, lang))}</h2>
      ${issue.deep.excerpt ? `<p>${esc(frTypo(issue.deep.excerpt, lang))}</p>` : ''}
      <div class="meta"><b>${esc(issue.deep.source)}</b></div></a>
    ${issue.deep.why ? `<div class="gist"><span class="lbl">${lang === 'fr' ? 'Pourquoi ça compte' : 'Why it matters'}</span>${esc(frTypo(issue.deep.why, lang))}</div>` : ''}` : '';

  const macro = issue.macro.length ? `
    <section class="band"><div class="band-head"><span class="kicker" style="--h:210">${lang === 'fr' ? 'En trois titres' : 'In three headlines'}</span><span class="rule"></span></div>
    ${issue.macro.map(li).join('\n')}</section>` : '';

  const briefs = issue.briefs.map(sec => `
    <section class="band"><div class="band-head"><span class="kicker" style="--h:${CAT_HUE[sec.key] ?? 32}">${esc(sec.label)}</span><span class="rule"></span></div>
    ${sec.items.map(li).join('\n')}</section>`).join('\n');

  const body = `<main id="main"><div class="wrap"><article class="story" style="padding-bottom:6px">
    <div><span class="kicker" style="--h:145">${esc(issue.tagline)}</span></div>
    <h1 class="serif">${esc(issue.title)}</h1>
    <p style="color:var(--ink-2)">${esc(issue.date)}</p>
    ${deep}${macro}${briefs}
    <div class="brief-box" style="margin-top:30px">
      <h2 class="serif">${esc(L[lang].briefTitle)}</h2>
      <p>${esc(frTypo(L[lang].briefText, lang))}</p>
      <a class="btn" href="/subscribe${lang === 'en' ? '?lang=en' : ''}">${esc(L[lang].briefCta)}</a>
    </div>
  </article></div></main>`;

  return page({ lang, title: `${issue.title} — Le Vieillard`, desc: issue.tagline,
    canonical: 'https://le-vieillard.onrender.com/brief', body, active: 'brief' });
}

/* ---------- unsubscribe confirmation: /unsubscribe ---------- */
function unsubscribed(lang, removed){
  const T = lang === 'en'
    ? { title: 'Unsubscribed — Le Vieillard',
        ok: 'You are unsubscribed.', okSub: 'You will not receive The Brief again. You can come back any time.',
        no: 'Address not found.', noSub: 'That address is not on our list — you may already have unsubscribed.',
        back: 'Back to the news →', again: 'Subscribe again' }
    : { title: 'Désabonnement — Le Vieillard',
        ok: 'Vous êtes désabonné.', okSub: 'Vous ne recevrez plus Le Brief. Vous pouvez revenir quand vous voulez.',
        no: 'Adresse introuvable.', noSub: 'Cette adresse n’est pas dans notre liste — vous êtes peut-être déjà désabonné.',
        back: 'Retour à l’actualité →', again: 'Se réabonner' };
  const body = `<main id="main"><div class="wrap"><article class="story">
    <div><span class="kicker" style="--h:145">${lang === 'fr' ? 'Le Brief' : 'The Brief'}</span></div>
    <h1 class="serif">${esc(removed ? T.ok : T.no)}</h1>
    <p style="color:var(--ink-2);max-width:56ch">${esc(removed ? T.okSub : T.noSub)}</p>
    <a class="btn big" href="/${lang === 'en' ? '?lang=en' : ''}">${esc(T.back)}</a>
    <p style="margin-top:14px"><a href="/subscribe${lang === 'en' ? '?lang=en' : ''}" style="color:var(--accent);font-weight:700">${esc(T.again)}</a></p>
  </article></div></main>`;
  return page({ lang, title: T.title, desc: T.okSub,
    canonical: 'https://le-vieillard.onrender.com/unsubscribe', body, active: 'alerts' });
}

module.exports = { home, story, subscribe, brief, unsubscribed };
