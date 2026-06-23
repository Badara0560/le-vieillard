'use strict';
/* Live World Cup match data for the dashboard, fetched server-side (no CORS)
   from TheSportsDB. The free key returns the in-progress / most-recent match
   and the next fixture — enough to keep the dashboard's "live" match and score
   current. The rest of the dashboard (standings, scorers, predictions) is the
   curated snapshot in public/worldcup.html. Results are cached briefly so a
   roomful of refreshing browsers doesn't hammer the API. */

const KEY    = () => process.env.SPORTSDB_KEY || '3';        // '3' = free/test key
const LEAGUE = () => process.env.SPORTSDB_WC_LEAGUE || '4429'; // FIFA World Cup
const TTL    = 45 * 1000;

let cache = { at: 0, data: null };

async function fetchJson(url){
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctrl.signal,
      headers: { 'User-Agent': 'LeVieillardBot/1.0 (+https://levieillard.news)' } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
  finally { clearTimeout(to); }
}

/* Normalise TheSportsDB status into the three the UI cares about. */
function mapStatus(s){
  s = String(s || '').toUpperCase().trim();
  if (s === 'FT' || s === 'AET' || s === 'PEN' || s === 'MATCH FINISHED') return 'FT';
  if (s === 'NS' || s === '' || s === 'NOT STARTED' || s === 'POSTP' || s === 'TBD') return 'NS';
  return 'LIVE';   // HT, 1H, 2H, LIVE, a running minute, etc.
}

const num = v => (v === '' || v == null) ? null : (Number.isNaN(+v) ? null : +v);
const groupOf = s => String(s || '').replace(/^group\s*/i, '').trim();

async function fetchLive(){
  if (cache.data && Date.now() - cache.at < TTL) return cache.data;

  const base = `https://www.thesportsdb.com/api/v1/json/${KEY()}/`;
  const eventUrls = [
    `eventspastleague.php?id=${LEAGUE()}`,    // last results (incl. the live one)
    `eventsnextleague.php?id=${LEAGUE()}`,     // upcoming
    `eventsseason.php?id=${LEAGUE()}&s=2026`,  // season sample
    `eventsround.php?id=${LEAGUE()}&r=1&s=2026`,
    `eventsround.php?id=${LEAGUE()}&r=2&s=2026`,
    `eventsround.php?id=${LEAGUE()}&r=3&s=2026`
  ];
  const [eventLists, tableJson] = await Promise.all([
    Promise.all(eventUrls.map(u => fetchJson(base + u).then(j => (j && j.events) || []).catch(() => []))),
    fetchJson(base + `lookuptable.php?l=${LEAGUE()}&s=2026`).catch(() => null)
  ]);

  const seen = new Set();
  const events = [];
  for (const ev of eventLists.flat()) {
    if (!ev || seen.has(ev.idEvent)) continue;
    seen.add(ev.idEvent);
    events.push({
      id: ev.idEvent,
      home: ev.strHomeTeam, away: ev.strAwayTeam,
      hs: num(ev.intHomeScore), as: num(ev.intAwayScore),
      status: mapStatus(ev.strStatus), raw: ev.strStatus || '',
      date: ev.dateEvent || '', time: (ev.strTime || '').slice(0, 5),
      venue: ev.strVenue || ''
    });
  }

  // Real group standings for whichever teams the table returns.
  const table = ((tableJson && tableJson.table) || []).map(r => ({
    team: r.strTeam, group: groupOf(r.strGroup),
    played: +r.intPlayed || 0, win: +r.intWin || 0, draw: +r.intDraw || 0, loss: +r.intLoss || 0,
    gf: +r.intGoalsFor || 0, ga: +r.intGoalsAgainst || 0, points: +r.intPoints || 0
  }));

  // Keep the previous good result if everything came back empty (transient blip).
  if (!events.length && !table.length && cache.data) return cache.data;

  cache = { at: Date.now(), data: { updated: new Date().toISOString(), source: 'TheSportsDB', events, table } };
  return cache.data;
}

module.exports = { fetchLive };
