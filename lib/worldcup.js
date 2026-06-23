'use strict';
/* Live World Cup data for the dashboard, fetched server-side from ESPN's free
   public JSON API (no key, no row caps). One scoreboard call over the tournament
   date range returns every match with its goal-scorers and cards; one standings
   call returns all groups. We normalise it into a compact payload the dashboard
   overlays onto its layout. Cached briefly so refreshing browsers don't hammer it.

   Override the source via env if needed: ESPN_WC_LEAGUE (default fifa.world),
   ESPN_WC_DATES (default 20260611-20260719). */

const LEAGUE = () => process.env.ESPN_WC_LEAGUE || 'fifa.world';
const DATES  = () => process.env.ESPN_WC_DATES  || '20260611-20260719';
const TTL    = 60 * 1000;

let cache = { at: 0, data: null };

async function fetchJson(url){
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal,
      headers: { 'User-Agent': 'LeVieillardBot/1.0 (+https://levieillard.news)' } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
  finally { clearTimeout(to); }
}

const num = v => (v === '' || v == null || Number.isNaN(+v)) ? 0 : +v;

function mapState(state){
  if (state === 'post') return 'FT';
  if (state === 'in')   return 'LIVE';
  return 'NS';
}

function normEvent(e){
  const c = (e.competitions && e.competitions[0]) || {};
  const comp = c.competitors || [];
  const home = comp.find(x => x.homeAway === 'home') || comp[0] || {};
  const away = comp.find(x => x.homeAway === 'away') || comp[1] || {};
  const st = (e.status && e.status.type) || {};
  const status = mapState(st.state);

  const goals = [], cards = [];
  for (const d of (c.details || [])) {
    const side = d.team && d.team.id === (home.team && home.team.id) ? 'home'
              : d.team && d.team.id === (away.team && away.team.id) ? 'away' : null;
    if (!side) continue;
    const who = (d.athletesInvolved && d.athletesInvolved[0] && d.athletesInvolved[0].displayName) || '';
    const min = (d.clock && d.clock.displayValue) || '';
    if (d.scoringPlay) goals.push({ side, who, min, own: !!d.ownGoal, pen: !!d.penaltyKick });
    if (d.redCard || d.yellowCard) cards.push({ side, who, min, type: d.redCard ? 'R' : 'Y' });
  }

  return {
    date: (e.date || '').slice(0, 10),
    status, clock: st.shortDetail || st.description || '',
    home: { name: (home.team && home.team.displayName) || '', abbr: (home.team && home.team.abbreviation) || '', score: home.score == null ? null : num(home.score) },
    away: { name: (away.team && away.team.displayName) || '', abbr: (away.team && away.team.abbreviation) || '', score: away.score == null ? null : num(away.score) },
    goals, cards
  };
}

function aggregate(events){
  const scorers = new Map();   // name -> {who, team, goals}
  const yellows = new Map();   // name -> {who, team, count}
  const reds = [];
  let goalsTotal = 0, played = 0, redCount = 0, yellowCount = 0;

  for (const ev of events) {
    if (ev.status === 'FT' || ev.status === 'LIVE') played++;
    for (const g of ev.goals) {
      goalsTotal++;
      if (g.own || !g.who) continue;                 // own goals don't credit a scorer
      const team = g.side === 'home' ? ev.home.name : ev.away.name;
      const k = g.who + '|' + team;
      const cur = scorers.get(k) || { who: g.who, team, goals: 0 };
      cur.goals++; scorers.set(k, cur);
    }
    for (const card of ev.cards) {
      const team = card.side === 'home' ? ev.home.name : ev.away.name;
      const vs   = card.side === 'home' ? ev.away.name : ev.home.name;
      if (card.type === 'R') { redCount++; reds.push({ who: card.who, team, vs, min: card.min }); }
      else {
        yellowCount++;
        const k = card.who + '|' + team;
        const cur = yellows.get(k) || { who: card.who, team, count: 0 };
        cur.count++; yellows.set(k, cur);
      }
    }
  }

  return {
    scorers: [...scorers.values()].sort((a, b) => b.goals - a.goals).slice(0, 20),
    reds,
    yellows: [...yellows.values()].sort((a, b) => b.count - a.count).slice(0, 12),
    kpis: {
      goals: goalsTotal, played, reds: redCount, yellows: yellowCount,
      goalsPerMatch: played ? +(goalsTotal / played).toFixed(2) : 0,
      cardsPerMatch: played ? +((redCount + yellowCount) / played).toFixed(2) : 0
    }
  };
}

function normTable(json){
  const out = [];
  for (const g of ((json && json.children) || [])) {
    const group = String(g.name || '').replace(/^group\s*/i, '').trim();
    for (const en of ((g.standings && g.standings.entries) || [])) {
      const s = {};
      for (const x of (en.stats || [])) s[x.name] = x.value;
      out.push({
        group, team: (en.team && en.team.displayName) || '',
        played: num(s.gamesPlayed), win: num(s.wins), draw: num(s.ties), loss: num(s.losses),
        gf: num(s.pointsFor), ga: num(s.pointsAgainst), points: num(s.points), rank: num(s.rank)
      });
    }
  }
  return out;
}

async function fetchLive(){
  if (cache.data && Date.now() - cache.at < TTL) return cache.data;

  const base = `https://site.api.espn.com/apis`;
  const [sb, st] = await Promise.all([
    fetchJson(`${base}/site/v2/sports/soccer/${LEAGUE()}/scoreboard?dates=${DATES()}`),
    fetchJson(`${base}/v2/sports/soccer/${LEAGUE()}/standings`)
  ]);

  const events = ((sb && sb.events) || []).map(normEvent).filter(e => e.home.name && e.away.name);
  const table = normTable(st);

  // Keep the last good payload if ESPN returned nothing (transient blip).
  if (!events.length && !table.length && cache.data) return cache.data;

  const agg = aggregate(events);
  cache = { at: Date.now(), data: { updated: new Date().toISOString(), source: 'ESPN', events, table, ...agg } };
  return cache.data;
}

module.exports = { fetchLive };
