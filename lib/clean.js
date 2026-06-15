'use strict';
/* Text cleaning for RSS feed content: strip HTML, decode entities,
   remove common aggregator/WordPress boilerplate, collapse whitespace. */

const NAMED = {
  '&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' ',
  '&hellip;':'…','&mdash;':'—','&ndash;':'–','&rsquo;':'’','&lsquo;':'‘',
  '&ldquo;':'“','&rdquo;':'”','&laquo;':'«','&raquo;':'»','&eacute;':'é',
  '&egrave;':'è','&agrave;':'à','&ugrave;':'ù','&ccedil;':'ç','&ecirc;':'ê',
  '&acirc;':'â','&icirc;':'î','&ocirc;':'ô','&ucirc;':'û','&euml;':'ë',
  '&iuml;':'ï','&ntilde;':'ñ','&deg;':'°','&euro;':'€','&copy;':'©','&#039;':"'"
};

function decodeEntities(s){
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return _; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _; } })
    .replace(/&[a-z0-9]+;/gi, m => (m in NAMED ? NAMED[m] : m));
}

function stripTags(s){
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
}

/* Boilerplate patterns common across many feeds (FR + EN). */
const BOILER = [
  /the post\b[\s\S]*?appeared first on[\s\S]*?$/i,
  /cet article\b[\s\S]*?est apparu en premier sur[\s\S]*?$/i,
  /l['’]article\b[\s\S]*?est apparu en premier sur[\s\S]*?$/i,
  /lire (?:la suite|l['’]article|plus)[\s\S]*$/i,
  /(?:read more|continue reading|view post)[\s\S]*$/i,
  /\(adsbygoogle[\s\S]*$/i,
  /\[…\]\s*$/,          // trailing [...]
  /\.{3,}\s*$/               // trailing ...
];

/* Strip a short leading credit like "© JDM" / "© AFP" */
const LEADING_CREDIT = /^\s*©\s*[A-Za-zÀ-ÿ.&'’\- ]{1,18}?(?=[A-ZÀ-Ý][a-zà-ÿ])/;

function clean(raw, extraStrip){
  if (!raw) return '';
  let s = decodeEntities(stripTags(raw)).replace(/\s+/g, ' ').trim();
  // feed-specific patterns first (e.g. site-name boilerplate)
  if (Array.isArray(extraStrip)) {
    for (const re of extraStrip) s = s.replace(re, ' ').replace(/\s+/g, ' ').trim();
  }
  for (const re of BOILER) s = s.replace(re, '').trim();
  s = s.replace(LEADING_CREDIT, '').trim();
  return s;
}

/* If the excerpt merely repeats the title at its start, drop the repetition. */
function dedupeTitle(excerpt, title){
  if (!excerpt || !title) return excerpt;
  const e = excerpt.trim(), t = title.trim();
  if (e.toLowerCase().startsWith(t.toLowerCase())) {
    const rest = e.slice(t.length).replace(/^[\s:–—-]+/, '').trim();
    if (rest.length > 20) return rest;
  }
  return e;
}

/* Collapse "stuffed" titles/descriptions where a phrase repeats (common in
   some aggregator feeds, e.g. a headline echoed several times). Cuts at the
   first point where a 4-word sequence repeats one seen earlier. */
function collapseRepeats(text){
  if (!text) return text;
  const words = text.split(/\s+/);
  if (words.length < 10) return text;
  const norm = w => w.toLowerCase().replace(/[^0-9a-zà-ÿ]/gi, '');
  const seen = new Map();
  for (let i = 0; i + 4 <= words.length; i++) {
    const gram = words.slice(i, i + 4).map(norm).join(' ');
    if (gram.replace(/\s/g, '').length < 6) continue; // skip grams of tiny words
    if (seen.has(gram)) {
      return words.slice(0, i).join(' ').replace(/[\s:–—,.-]+$/, '').trim();
    }
    seen.set(gram, i);
  }
  return text;
}

module.exports = { clean, decodeEntities, stripTags, dedupeTitle, collapseRepeats };
