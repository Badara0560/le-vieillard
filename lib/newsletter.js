'use strict';
/* The West Africa Brief — a weekly business & geopolitics issue auto-assembled
   from the live article pool. No fabricated analysis: it curates and groups real
   headlines into an executive-scannable structure (Macro Overview → Deep Dive →
   Regional Briefs), bilingual FR/EN, with sources and links intact.

   The editorial angle (per the publication strategy): the high-stakes
   intersections where business and politics collide across ECOWAS + the Sahel —
   currency (Eco vs CFA), AES vs ECOWAS, trade corridors, mining/FDI, tech. */

/* ---- editorial lenses ---------------------------------------------------- */
/* A fixed "why it matters" framing per beat — a reading lens, not a claim of
   fact about any one story. Shown under the Deep Dive to anchor the "So What?". */
const LENS = {
  economy: {
    fr: 'À surveiller : franc CFA / Eco, coûts du commerce et signaux pour les investissements directs étrangers (IDE).',
    en: 'Watch for: CFA franc / Eco, trade costs and signals for foreign direct investment (FDI).'
  },
  sahel: {
    fr: 'À surveiller : tension AES / CEDEAO, sécurité des corridors et risque souverain.',
    en: 'Watch for: AES / ECOWAS tension, corridor security and sovereign risk.'
  },
  politics: {
    fr: 'À surveiller : stabilité politique, cycles électoraux et leur effet sur le climat des affaires.',
    en: 'Watch for: political stability, election cycles and their effect on the business climate.'
  },
  tech: {
    fr: 'À surveiller : mobile money, infrastructure numérique et protocoles AfCFTA du commerce digital.',
    en: 'Watch for: mobile money, digital infrastructure and AfCFTA digital-trade protocols.'
  }
};

/* ---- region & beat grouping for the briefs -------------------------------- */
const BRIEF_SECTIONS = [
  { key: 'markets',  fr: 'Marchés & Monnaie',   en: 'Markets & Currency', cats: ['economy'] },
  { key: 'sahel',    fr: 'Sahel & Sécurité',     en: 'Sahel & Security',   cats: ['sahel', 'politics'] },
  { key: 'tech',     fr: 'Tech & Télécoms',      en: 'Tech & Telecoms',    cats: ['tech'] },
  { key: 'mali',     fr: 'Mali',                 en: 'Mali',               cats: ['mali'] }
];

/* Priority for picking the lead / macro stories: business & geopolitics first. */
const WEIGHT = { economy: 5, sahel: 4, politics: 4, tech: 3, mali: 2, world: 1 };

function loc(a, lang){ return a[lang] || a.fr || a.en || { title: '', excerpt: '' }; }

/* West Africa / Sahel relevance gate. The francophone business wires and the
   mali/sahel/economy/tech beats are regionally grounded by construction, but the
   broad `politics`/`world` buckets pull in off-region stories (e.g. Brazilian
   elections). Require those to actually mention the region before they qualify. */
const AFRICA = /afriqu|africa|sahel|cedeao|ecowas|\baes\b|\buemoa\b|\bwaemu\b|\bcfa\b|\beco\b|\bbrvm\b|mali|s[ée]n[ée]gal|c[ôo]te d|ivoir|burkina|\bniger\b|nigeria|ghana|guin[ée]e|togo|b[ée]nin|mauritani|tchad|bamako|dakar|abidjan|accra|lagos|ouagadougou|niamey|conakry|dangote|afcfta|zlecaf|\bbad\b|\bafdb\b/i;
function regional(a){
  if (a.cat === 'politics' || a.cat === 'world') {
    const c = a.fr || a.en || {};
    return AFRICA.test((a.source || '') + ' ' + (c.title || '') + ' ' + (c.excerpt || ''));
  }
  return true;   // economy, tech, sahel, mali — already on-beat
}

function score(a){
  const w = WEIGHT[a.cat] || 0;
  // Recency bonus (decays over a week) so the issue feels current.
  const days = (Date.now() - (a.ts || 0)) / 86400000;
  const recency = Math.max(0, 7 - days);
  return w * 10 + recency + (a.lead ? 3 : 0) + (a.breaking ? 2 : 0);
}

/* Build a single issue object for the given language from the article pool. */
function buildIssue(articles, lang){
  lang = lang === 'en' ? 'en' : 'fr';
  const L = lang === 'en'
    ? { title: 'The West Africa Brief', tag: 'Business & Geopolitics · ECOWAS & the Sahel',
        macro: 'The Macro Overview', deep: 'The Deep Dive', why: 'Why it matters',
        briefs: 'Regional Briefs', read: 'Read the full report', source: 'Source', empty: 'No stories in this beat this week.' }
    : { title: 'Le Point Afrique de l’Ouest', tag: 'Business & Géopolitique · CEDEAO & Sahel',
        macro: 'Le Point Macro', deep: 'L’Analyse', why: 'Pourquoi c’est important',
        briefs: 'Brèves Régionales', read: 'Lire le rapport complet', source: 'Source', empty: 'Aucune actualité sur ce thème cette semaine.' };

  // Only the business/geopolitics-relevant pool, freshest & weightiest first.
  const pool = articles
    .filter(a => WEIGHT[a.cat] != null && regional(a))
    .map(a => ({ a, s: score(a) }))
    .sort((x, y) => y.s - x.s)
    .map(x => x.a);

  const used = new Set();
  const take = a => { used.add(a.id); return a; };

  // 1) Deep Dive — the single highest-weight business/geopolitics story.
  const deepSrc = pool.find(a => a.cat === 'economy' || a.cat === 'sahel' || a.cat === 'politics') || pool[0];
  let deep = null;
  if (deepSrc) {
    const c = loc(take(deepSrc), lang);
    deep = {
      id: deepSrc.id, title: c.title, excerpt: c.excerpt,
      source: deepSrc.source, url: deepSrc.url, cat: deepSrc.cat,
      ageMin: Math.max(1, Math.round((Date.now() - deepSrc.ts) / 60000)),
      why: (LENS[deepSrc.cat] || LENS.economy)[lang]
    };
  }

  // 2) Macro Overview — next three highest-priority stories, one line each.
  const macro = pool.filter(a => !used.has(a.id)).slice(0, 3).map(a => {
    const c = loc(take(a), lang);
    return { id: a.id, title: c.title, source: a.source, url: a.url };
  });

  // 3) Regional Briefs — grouped by beat, up to 4 bullets each, no repeats.
  const briefs = BRIEF_SECTIONS.map(sec => {
    const items = pool
      .filter(a => sec.cats.includes(a.cat) && !used.has(a.id))
      .slice(0, 4)
      .map(a => {
        const c = loc(take(a), lang);
        return { id: a.id, title: c.title, source: a.source, url: a.url };
      });
    return { key: sec.key, label: sec[lang], items };
  }).filter(s => s.items.length);

  const now = new Date();
  const dateStr = now.toLocaleDateString(lang === 'en' ? 'en-GB' : 'fr-FR',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return {
    lang, labels: L,
    title: L.title, tagline: L.tag, date: dateStr, generated: now.toISOString(),
    deep, macro, briefs,
    storyCount: used.size
  };
}

module.exports = { buildIssue };
