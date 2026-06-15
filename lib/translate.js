'use strict';
/* Server-side translation via Google's free gtx endpoint (no key, no CORS).
   In-memory cache keyed by `${lang}::${text}` persists for the process lifetime. */

const cache = new Map();
const MAX_CACHE = 5000;

async function gtx(text, target){
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl='
    + encodeURIComponent(target) + '&dt=t&q=' + encodeURIComponent(text);
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    const data = await res.json();
    const out = (data[0] || []).map(seg => seg[0]).join('');
    return out || null;
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

/* Returns translated text, or null on failure so callers can fall back / retry. */
async function translate(text, target){
  if (!text) return text;
  const key = target + '::' + text;
  if (cache.has(key)) return cache.get(key);
  const out = await gtx(text, target);
  if (out) {
    if (cache.size > MAX_CACHE) cache.clear();
    cache.set(key, out);
    return out;
  }
  return null;
}

/* Translate title + excerpt in ONE request so they never end up half-translated. */
async function translatePair(title, excerpt, target){
  const SEP = '\n@@@@\n';
  const out = await translate(`${title}${SEP}${excerpt}`, target);
  if (out && out.includes('@@@@')) {
    const parts = out.split(/\s*@@@@\s*/);
    return { title: parts[0].trim(), excerpt: parts.slice(1).join(' ').trim() };
  }
  return null;
}

module.exports = { translate, translatePair, cacheSize: () => cache.size };
