'use strict';
/* Story clustering: group articles that cover the same event across sources.
   Zero-dependency — normalized title-token overlap within a time window.
   The cluster's lead is the freshest article from the most authoritative
   source; other members appear as "aussi couvert par" chips. */

/* Words that carry no event identity (FR + EN news boilerplate). */
const STOP = new Set(('le la les un une des du de d l au aux et ou en sur dans pour par avec sans est sont a ont ce cette ces qui que quoi dont il elle ils elles nous vous leur leurs son sa ses plus tres apres avant entre contre chez vers face selon depuis the a an of to in on for and or is are was were with by at from as it its this that these not no'
).split(' '));

function tokens(title){
  return String(title || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip accents
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w));
}

/* Jaccard-ish overlap on token sets, biased toward the smaller set so a short
   headline matching inside a long one still counts. */
function overlap(setA, setB){
  if (!setA.size || !setB.size) return 0;
  let hit = 0;
  for (const t of setA) if (setB.has(t)) hit++;
  return hit / Math.min(setA.size, setB.size);
}

const WINDOW_MS = 36 * 3600 * 1000;   // same event = within 36h of each other
const THRESHOLD = 0.5;                // ≥50% of the smaller title's tokens shared

/* Source authority for picking the cluster lead (wire services > local portals).
   Unlisted sources rank 0. */
const AUTHORITY = {
  'RFI Afrique': 5, 'France 24 Afrique': 5, 'BBC Africa': 5, 'Al Jazeera': 4,
  'Jeune Afrique': 4, 'Studio Tamani': 4, 'Journal du Mali': 3, 'Financial Afrik': 3,
  'AllAfrica': 2, 'Maliweb': 2, 'Bamada.net': 2, 'Maliactu': 1, 'Malijet': 1, 'aBamako': 1
};

/* Input: the flat article list from feeds.build() (sorted newest-first).
   Output: array of clusters, newest-first:
   { lead: article, others: [article…], cat, ts, breaking } */
function clusterArticles(articles){
  const items = articles.map(a => ({ a, set: new Set(tokens(a.title)) }));
  const used = new Array(items.length).fill(false);
  const clusters = [];

  for (let i = 0; i < items.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const members = [items[i].a];
    const memberSets = [items[i].set];
    // Single-linkage with re-scan: joining via ANY member (headlines vary a
    // lot across outlets), repeated until no new member joins.
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = i + 1; j < items.length; j++) {
        if (used[j]) continue;
        if (members.every(m => Math.abs(m.ts - items[j].a.ts) > WINDOW_MS)) continue;
        if (memberSets.some(s => overlap(s, items[j].set) >= THRESHOLD)) {
          used[j] = true;
          members.push(items[j].a);
          memberSets.push(items[j].set);
          grew = true;
        }
      }
    }
    // Lead = highest authority, ties broken by freshness
    members.sort((x, y) =>
      (AUTHORITY[y.source] || 0) - (AUTHORITY[x.source] || 0) || y.ts - x.ts);
    const lead = members[0];
    // De-dupe same-source repeats inside a cluster (portals re-post)
    const seen = new Set([lead.source]);
    const others = members.slice(1).filter(m => !seen.has(m.source) && seen.add(m.source));
    clusters.push({
      lead, others,
      cat: lead.cat,
      ts: Math.max(...members.map(m => m.ts)),
      breaking: members.some(m => m.breaking)
    });
  }

  clusters.sort((a, b) => b.ts - a.ts);
  return clusters;
}

module.exports = { clusterArticles, tokens, overlap };
