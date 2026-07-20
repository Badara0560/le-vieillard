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

/* ---------- stylesheet (single inline block, both themes) ----------
   Design2 × liquid glass: navy structure, white frosted cards, pill controls,
   translucent blurred header + floating dock (Apple-style). */
const CSS = `
:root{--paper:#eef1f6;--wash1:rgba(27,107,70,.10);--wash2:rgba(23,42,84,.12);
--ink:#141a26;--ink-2:#5b6474;--line:rgba(20,30,60,.10);
--glass:rgba(255,255,255,.62);--glass-strong:rgba(255,255,255,.72);--glass-brd:rgba(255,255,255,.65);
--navy:rgba(16,26,51,.86);--navy-ink:#e8ecf6;
--accent:#1b6b46;--urgent:#b8121b;--sat:62%;--lit:34%;--tile-l:88%;
--shadow:0 1px 2px rgba(16,26,51,.05),0 10px 30px rgba(16,26,51,.09)}
[data-th=dark]{--paper:#0c1322;--wash1:rgba(79,174,126,.08);--wash2:rgba(64,106,255,.09);
--ink:#e9edf5;--ink-2:#93a0b6;--line:rgba(255,255,255,.09);
--glass:rgba(24,34,58,.55);--glass-strong:rgba(20,30,54,.72);--glass-brd:rgba(255,255,255,.10);
--navy:rgba(10,17,34,.78);--navy-ink:#e8ecf6;
--accent:#4fae7e;--urgent:#ff6b71;--sat:48%;--lit:68%;--tile-l:24%;
--shadow:0 1px 2px rgba(0,0,0,.35),0 12px 34px rgba(0,0,0,.45)}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{background:var(--paper) fixed;color:var(--ink);
font:17px/1.6 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;padding-bottom:96px}
body::before{content:"";position:fixed;inset:0;z-index:-1;
background:radial-gradient(52% 38% at 12% -4%,var(--wash1),transparent 70%),
radial-gradient(60% 42% at 96% 2%,var(--wash2),transparent 72%)}
.serif,h1,h2,h3{font-family:Charter,'Bitstream Charter',Georgia,'Times New Roman',serif}
a{color:inherit;text-decoration:none}
.wrap{max-width:680px;margin:0 auto;padding:0 18px}
.glass{background:var(--glass);border:1px solid var(--glass-brd);border-radius:18px;
box-shadow:var(--shadow);-webkit-backdrop-filter:blur(18px) saturate(1.6);backdrop-filter:blur(18px) saturate(1.6)}
header.top{position:sticky;top:0;z-index:20;background:var(--glass-strong);
border-bottom:1px solid var(--glass-brd);box-shadow:0 1px 14px rgba(16,26,51,.06);
-webkit-backdrop-filter:blur(20px) saturate(1.7);backdrop-filter:blur(20px) saturate(1.7);padding:10px 0 8px}
header.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:10px}
.brand{font-weight:800;font-size:1.45rem;letter-spacing:-.02em}
.brand em{font-style:normal;color:var(--accent)}
.brand small{display:block;font-family:ui-sans-serif,system-ui,sans-serif;font-weight:500;font-size:.6rem;
letter-spacing:.28em;text-transform:uppercase;color:var(--ink-2);margin-top:1px}
.ctrl{display:flex;gap:8px;align-items:center}
.pill{border:1px solid var(--glass-brd);background:var(--glass);color:var(--ink);border-radius:999px;
padding:6px 13px;font-size:.78rem;font-weight:700;cursor:pointer;font-family:inherit;
-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);transition:transform .15s}
.pill:active{transform:scale(.94)}
.kicker{display:inline-flex;align-items:center;gap:8px;font-size:.72rem;font-weight:800;
letter-spacing:.09em;text-transform:uppercase;color:hsl(var(--h) var(--sat) var(--lit))}
.kicker::before{content:"";width:8px;height:8px;border-radius:3px;background:hsl(var(--h) var(--sat) var(--lit))}
.urgent{background:var(--urgent);color:#fff;border-radius:999px;padding:2px 10px;font-size:.66rem;
font-weight:800;letter-spacing:.08em;animation:pulse 1.6s infinite}
@keyframes pulse{50%{opacity:.55}}
main{padding:20px 0 30px}
.lead-item{display:block;padding:22px;margin:2px 0 14px}
.lead-item h2{font-size:1.8rem;line-height:1.12;letter-spacing:-.015em;margin:8px 0 8px}
.lead-item p{color:var(--ink-2);font-size:1rem;max-width:60ch}
.item{display:flex;gap:14px;padding:15px 16px;margin:10px 0}
.item .txt{flex:1;min-width:0}
.item h3{font-size:1.12rem;line-height:1.24;margin:5px 0 4px;font-weight:700}
.lead-item,.item{transition:transform .18s ease,box-shadow .18s ease}
.lead-item:hover,.item:hover{transform:translateY(-2px)}
.mono{flex:none;width:52px;height:52px;border-radius:14px;display:grid;place-items:center;
font-family:Charter,Georgia,serif;font-weight:800;font-size:1.35rem;
background:hsl(var(--h) 42% var(--tile-l) / .8);color:hsl(var(--h) var(--sat) var(--lit));
border:1px solid var(--glass-brd);margin-top:4px}
.meta{font-size:.78rem;color:var(--ink-2);display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.meta b{color:var(--ink);font-weight:600}
.chips{margin-top:6px;font-size:.74rem;color:var(--ink-2)}
.chips span{border:1px solid var(--line);background:var(--glass);border-radius:999px;padding:1px 9px;margin-right:4px;white-space:nowrap}
.band{margin-top:28px}
.band-head{display:flex;align-items:center;gap:10px;padding:0 4px 8px}
.band-head h2{font-size:1.12rem}
.band-head .rule{flex:1;height:1px;background:var(--line)}
.brief-box{margin:28px 0 4px;padding:22px}
.brief-box h2{color:var(--accent);font-size:1.2rem;margin-bottom:6px}
.brief-box p{font-size:.92rem;color:var(--ink-2);margin-bottom:12px}
.btn{display:inline-block;background:var(--accent);color:#fff;border-radius:999px;padding:12px 22px;
font-weight:700;font-size:.95rem;box-shadow:0 6px 18px rgba(27,107,70,.28);transition:transform .15s}
.btn:active{transform:scale(.96)}
.btn.big{display:block;text-align:center;padding:15px;font-size:1.05rem;margin:18px 0}
footer{margin:40px 0 26px;font-size:.82rem;color:var(--ink-2)}
footer .wrap>div{padding:20px 22px}
footer p{margin-bottom:8px;max-width:60ch}
.weight{font-variant-numeric:tabular-nums}
nav.tabs{position:fixed;left:14px;right:14px;bottom:calc(10px + env(safe-area-inset-bottom));z-index:20;
background:var(--navy);border:1px solid rgba(255,255,255,.14);border-radius:26px;
box-shadow:0 14px 40px rgba(10,17,34,.35);
-webkit-backdrop-filter:blur(22px) saturate(1.8);backdrop-filter:blur(22px) saturate(1.8);
display:flex;justify-content:space-around;padding:8px 8px;max-width:420px;margin:0 auto}
nav.tabs a{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:.64rem;font-weight:700;
color:rgba(232,236,246,.66);min-width:70px;padding:6px 8px;border-radius:18px;transition:background .15s}
nav.tabs a.on{color:#fff;background:rgba(255,255,255,.14)}
nav.tabs .ic{font-size:1.12rem;line-height:1}
article.story{padding:26px 0}
article.story h1{font-size:1.85rem;line-height:1.13;letter-spacing:-.015em;margin:10px 0 10px}
.src-card{display:flex;align-items:center;gap:12px;padding:13px 15px;margin:16px 0}
.src-card .mono{width:44px;height:44px;margin:0;font-size:1.15rem}
.src-card .who{font-size:.85rem;color:var(--ink-2)}
.src-card .who b{display:block;color:var(--ink);font-size:1rem}
.gist{border-left:3px solid var(--accent);padding:14px 16px;margin:16px 0;color:var(--ink);font-size:1.02rem;
border-radius:0 16px 16px 0}
.gist .lbl{display:block;font-size:.72rem;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--accent);margin-bottom:3px}
.rel{margin-top:26px}
input{-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
@supports not (backdrop-filter:blur(1px)){
:root{--glass:rgba(255,255,255,.94);--glass-strong:rgba(255,255,255,.97);--navy:rgba(16,26,51,.97)}
[data-th=dark]{--glass:rgba(24,34,58,.96);--glass-strong:rgba(20,30,54,.97)}}
@media(prefers-reduced-motion:reduce){.urgent{animation:none}
.lead-item,.item,.pill,.btn{transition:none}}
@media(min-width:940px){
body{padding-bottom:30px;padding-left:212px}
nav.tabs{left:18px;right:auto;top:50%;bottom:auto;transform:translateY(-50%);width:176px;max-width:none;
flex-direction:column;gap:4px;padding:14px 10px;border-radius:24px}
nav.tabs a{flex-direction:row;justify-content:flex-start;gap:10px;font-size:.82rem;width:100%;
padding:10px 14px;border-radius:14px}
.item h3{font-size:1.2rem}}
@media(max-width:380px){.lead-item h2{font-size:1.5rem}nav.tabs a{min-width:58px}}`;

/* Tiny inline script: theme toggle only (stored preference, defaults to system). */
const JS = `(function(){var d=document.documentElement,k='lv-th',s;try{s=localStorage.getItem(k)}catch(e){}
if(s)d.dataset.th=s;else if(matchMedia('(prefers-color-scheme: dark)').matches)d.dataset.th='dark';
window.lvTheme=function(){var n=d.dataset.th==='dark'?'light':'dark';d.dataset.th=n;try{localStorage.setItem(k,n)}catch(e){}}})();`;

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
<header class="top"><div class="wrap">
  <a class="brand serif" href="/${lang === 'en' ? '?lang=en' : ''}">Le <em>Vieillard</em><small>${esc(t.tagline)}</small></a>
  <div class="ctrl">
    <a class="pill" href="?lang=${t.other}">${t.otherLabel}</a>
    <button class="pill" onclick="lvTheme()" aria-label="theme">◑</button>
  </div>
</div></header>
${body}
<footer><div class="wrap"><div class="glass">
  <p>${esc(t.footNote)}</p>
  <p class="weight">${esc(t.weight)}</p>
  <p>© 2026 Le Vieillard</p>
</div></div></footer>
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
    return `<a class="lead-item glass" style="display:block" href="/a/${a.id}${lang === 'en' ? '?lang=en' : ''}">
      <div>${kicker}${urgent}</div><h2>${title}</h2>${ex}${meta}${chips}</a>`;
  }
  return `<a class="item glass" href="/a/${a.id}${lang === 'en' ? '?lang=en' : ''}">
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

  const briefBox = `<div class="brief-box glass">
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
    ? `<div class="gist glass"><span class="lbl">${esc(t.why)}</span>${esc(frTypo(d.excerpt, lang))}</div>` : '';
  const sib = siblings.length
    ? `<div class="chips" style="margin:10px 0 0">${esc(t.alsoOn)} ${siblings.slice(0, 4).map(o => `<span>${esc(o.source)}</span>`).join('')}</div>` : '';

  const body = `<main><div class="wrap"><article class="story">
    <a href="/${lang === 'en' ? '?lang=en' : ''}" class="meta" style="display:inline-flex">${esc(t.backHome)}</a>
    <div style="margin-top:14px"><span class="kicker" style="--h:${CAT_HUE[a.cat] ?? 210}">${esc(t.sections[a.cat] || a.cat)}</span>
    ${a.breaking ? ` <span class="urgent">${t.urgent}</span>` : ''}</div>
    <h1 class="serif">${esc(frTypo(d.title, lang))}</h1>
    <div class="src-card glass">${monogram(a.source)}
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

/* ---------- subscribe page: /subscribe ---------- */
const SUB = {
  fr: {
    title: 'Les alertes Le Vieillard — Telegram',
    h1: 'La dernière minute, sur Telegram',
    sub: 'Dès qu’une information importante tombe sur le Mali, le Sahel et l’Afrique : le titre, un résumé et le lien vers la source. Deux fois par jour, pas plus.',
    join: 'Rejoindre sur Telegram →', soon: 'Les alertes Telegram arrivent très bientôt.',
    or: 'ou par e-mail / numéro', contact: 'Votre e-mail, pseudo ou numéro Telegram',
    name: 'Prénom (optionnel)', submit: 'M’abonner aux alertes',
    ok: '✅ C’est fait ! Vous recevrez les alertes.', already: 'ℹ️ Vous êtes déjà abonné.',
    err: 'Une erreur est survenue. Réessayez.',
    p1: 'Gratuit', p2: 'Deux envois par jour maximum', p3: 'Désabonnement à tout moment'
  },
  en: {
    title: 'Le Vieillard alerts — Telegram',
    h1: 'Breaking news, on Telegram',
    sub: 'The moment something important happens in Mali, the Sahel or Africa: the headline, a summary and the source link. Twice a day, no more.',
    join: 'Join on Telegram →', soon: 'Telegram alerts are coming very soon.',
    or: 'or by e-mail / number', contact: 'Your e-mail, handle or Telegram number',
    name: 'First name (optional)', submit: 'Subscribe to alerts',
    ok: '✅ Done! You will receive the alerts.', already: 'ℹ️ You are already subscribed.',
    err: 'Something went wrong. Please try again.',
    p1: 'Free', p2: 'At most two sends per day', p3: 'Unsubscribe anytime'
  }
};

function subscribe(lang, config){
  const t = L[lang], s = SUB[lang];
  const tgHref = config.telegramChannel ? `https://t.me/${esc(config.telegramChannel)}`
    : (config.telegramBot ? `https://t.me/${esc(config.telegramBot)}?start=subscribe` : '');
  const body = `<main><div class="wrap"><article class="story">
    <div><span class="kicker" style="--h:145">${lang === 'fr' ? 'Alertes' : 'Alerts'}</span></div>
    <h1 class="serif">${esc(frTypo(s.h1, lang))}</h1>
    <p style="color:var(--ink-2);max-width:56ch">${esc(frTypo(s.sub, lang))}</p>
    ${tgHref ? `<a class="btn big" href="${tgHref}" rel="noopener">${esc(s.join)}</a>`
             : `<div class="gist glass"><span class="lbl">Info</span>${esc(s.soon)}</div>`}
    <div class="band-head" style="margin-top:8px"><span class="kicker" style="--h:210">${esc(s.or)}</span><span class="rule"></span></div>
    <form id="f" style="margin-top:14px">
      <label style="display:block;font-size:.8rem;font-weight:700;color:var(--ink-2);margin-bottom:5px">${esc(s.contact)}</label>
      <input name="contact" required style="width:100%;padding:13px 14px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink);font:inherit;margin-bottom:12px">
      <label style="display:block;font-size:.8rem;font-weight:700;color:var(--ink-2);margin-bottom:5px">${esc(s.name)}</label>
      <input name="name" style="width:100%;padding:13px 14px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink);font:inherit;margin-bottom:16px">
      <button class="btn" type="submit" style="border:0;cursor:pointer;font:inherit;font-weight:700;width:100%">${esc(s.submit)}</button>
      <p id="msg" style="margin-top:12px;font-weight:600;display:none"></p>
    </form>
    <p style="margin-top:22px;font-size:.85rem;color:var(--ink-2)">✓ ${esc(s.p1)} · ✓ ${esc(frTypo(s.p2, lang))} · ✓ ${esc(frTypo(s.p3, lang))}</p>
  </article></div></main>
<script>var MSG={ok:${JSON.stringify(s.ok)},already:${JSON.stringify(s.already)},err:${JSON.stringify(s.err)}};
document.getElementById('f').addEventListener('submit',async function(e){e.preventDefault();
var m=document.getElementById('msg'),fd=new FormData(this);
try{var r=await fetch('/api/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({channel:'telegram',contact:fd.get('contact'),name:fd.get('name'),lang:${JSON.stringify(lang)}})});
var j=await r.json();m.style.display='block';
if(j.ok){m.style.color='var(--accent)';m.textContent=j.already?MSG.already:MSG.ok;this.reset();}
else{m.style.color='var(--urgent)';m.textContent=j.error||MSG.err;}}
catch(err){m.style.display='block';m.style.color='var(--urgent)';m.textContent=MSG.err;}});</script>`;
  return page({ lang, title: s.title, desc: s.sub,
    canonical: 'https://le-vieillard.onrender.com/subscribe', body, active: 'alerts' });
}

/* ---------- weekly Brief page: /brief ---------- */
function brief(issue, lang){
  const t = L[lang];
  const link = (id, extra) => `/a/${id}${lang === 'en' ? '?lang=en' : ''}${extra || ''}`;
  const li = it => `<a class="item glass" href="${link(it.id)}">${monogram(it.source)}
    <div class="txt"><h3>${esc(frTypo(it.title, lang))}</h3>
    <div class="meta"><b>${esc(it.source)}</b></div></div></a>`;

  const deep = issue.deep ? `
    <div style="margin-top:18px"><span class="kicker" style="--h:${CAT_HUE[issue.deep.cat] ?? 262}">${lang === 'fr' ? 'Le dossier' : 'Deep dive'}</span></div>
    <a class="lead-item glass" style="display:block" href="${link(issue.deep.id)}">
      <h2 class="serif">${esc(frTypo(issue.deep.title, lang))}</h2>
      ${issue.deep.excerpt ? `<p>${esc(frTypo(issue.deep.excerpt, lang))}</p>` : ''}
      <div class="meta"><b>${esc(issue.deep.source)}</b></div></a>
    ${issue.deep.why ? `<div class="gist glass"><span class="lbl">${lang === 'fr' ? 'Pourquoi ça compte' : 'Why it matters'}</span>${esc(frTypo(issue.deep.why, lang))}</div>` : ''}` : '';

  const macro = issue.macro.length ? `
    <section class="band"><div class="band-head"><span class="kicker" style="--h:210">${lang === 'fr' ? 'En trois titres' : 'In three headlines'}</span><span class="rule"></span></div>
    ${issue.macro.map(li).join('\n')}</section>` : '';

  const briefs = issue.briefs.map(sec => `
    <section class="band"><div class="band-head"><span class="kicker" style="--h:${CAT_HUE[sec.key] ?? 32}">${esc(sec.label)}</span><span class="rule"></span></div>
    ${sec.items.map(li).join('\n')}</section>`).join('\n');

  const body = `<main><div class="wrap"><article class="story" style="padding-bottom:6px">
    <div><span class="kicker" style="--h:145">${esc(issue.tagline)}</span></div>
    <h1 class="serif">${esc(issue.title)}</h1>
    <p style="color:var(--ink-2)">${esc(issue.date)}</p>
    ${deep}${macro}${briefs}
    <div class="brief-box glass" style="margin-top:30px">
      <h2 class="serif">${esc(L[lang].briefTitle)}</h2>
      <p>${esc(frTypo(L[lang].briefText, lang))}</p>
      <a class="btn" href="/subscribe${lang === 'en' ? '?lang=en' : ''}">${esc(L[lang].briefCta)}</a>
    </div>
  </article></div></main>`;

  return page({ lang, title: `${issue.title} — Le Vieillard`, desc: issue.tagline,
    canonical: 'https://le-vieillard.onrender.com/brief', body, active: 'brief' });
}

module.exports = { home, story, subscribe, brief };
