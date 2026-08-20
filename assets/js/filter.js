/**
 * Motore del dizionario: decide se una notizia va nascosta e, soprattutto,
 * *perché* (l'app mostra sempre la parola che ha fatto scattare il filtro).
 */

const DIACRITICS = /[\u0300-\u036f]/g;

export const normalize = (s = '') =>
  String(s).normalize('NFD').replace(DIACRITICS, '').toLowerCase();

/**
 * Come normalize(), ma tiene anche la mappa indice-normalizzato → indice
 * originale: serve per evidenziare la parola nel testo vero, visto che
 * togliere gli accenti puo' cambiare la lunghezza della stringa.
 */
function normalizeWithMap(text = '') {
  let norm = '';
  const map = [];
  for (let i = 0; i < text.length; i++) {
    const piece = text[i].normalize('NFD').replace(DIACRITICS, '').toLowerCase();
    for (let k = 0; k < piece.length; k++) { norm += piece[k]; map.push(i); }
  }
  map.push(text.length);
  return { norm, map };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Confini di parola che funzionano anche con lettere accentate.
const LEFT = '(?<![\\p{L}\\p{N}])';
const RIGHT = '(?![\\p{L}\\p{N}])';
const SEP = '[^\\p{L}\\p{N}]+';

/**
 * Da un singolo token del termine al pezzo di regex corrispondente.
 *  - `*` è sempre un jolly (immigrat* → immigrato, immigrati, immigrazione…)
 *  - modalità "smart": se finisce per vocale, tollera le altre desinenze
 *    italiane (immigrato → immigrat[aeio]); se finisce per consonante,
 *    tollera il plurale invariabile.
 */
function tokenToSource(token, mode) {
  if (token.includes('*')) {
    return escapeRe(token).replace(/\\\*/g, '[\\p{L}\\p{N}]*');
  }
  if (mode === 'exact') return escapeRe(token);
  if (/[aeio]$/.test(token)) return escapeRe(token.slice(0, -1)) + '[aeio]';
  if (/e$/.test(token)) return escapeRe(token.slice(0, -1)) + '[ei]';
  return escapeRe(token);
}

/** Compila un termine (parola singola o coppia/frase) in una RegExp. */
export function compileTerm(term, mode = 'smart') {
  const tokens = normalize(term).split(/[^\p{L}\p{N}*]+/u).filter(Boolean);
  if (!tokens.length) return null;
  const body = tokens.map((t) => tokenToSource(t, mode)).join(SEP);
  try {
    return new RegExp(LEFT + body + RIGHT, 'giu');
  } catch {
    // Vecchi browser senza lookbehind: ripiego su \b, meno preciso ma vivo.
    try { return new RegExp('\\b' + body + '\\b', 'gi'); } catch { return null; }
  }
}

/** Prepara una volta sola le regex del dizionario (usato a ogni render). */
export function compileDictionary(entries = []) {
  return entries
    .filter((e) => e && e.enabled !== false && e.term)
    .map((e) => ({ ...e, re: compileTerm(e.term, e.mode) }))
    .filter((e) => e.re);
}

function findIn(text, entry) {
  if (!text) return null;
  const { norm, map } = normalizeWithMap(text);
  entry.re.lastIndex = 0;
  const m = entry.re.exec(norm);
  if (!m) return null;
  const start = map[m.index];
  const end = map[m.index + m[0].length];
  return { start, end, excerpt: text.slice(start, end) };
}

/**
 * Valuta un articolo.
 * @returns {{hidden: boolean, reason?: {term, category, field, excerpt}, rescuedBy?: string}}
 */
export function evaluate(article, { dictionary = [], whitelist = [], defaultScope = 'both' } = {}) {
  for (const entry of whitelist) {
    if (findIn(article.title, entry) || findIn(article.summary, entry)) {
      return { hidden: false, rescuedBy: entry.term };
    }
  }

  for (const entry of dictionary) {
    const scope = entry.scope || defaultScope;
    const hit = findIn(article.title, entry);
    if (hit) {
      return { hidden: true, reason: { term: entry.term, category: entry.category, field: 'title', excerpt: hit.excerpt } };
    }
    if (scope === 'both' || scope === 'description') {
      const hitDesc = findIn(article.summary, entry);
      if (hitDesc) {
        return { hidden: true, reason: { term: entry.term, category: entry.category, field: 'summary', excerpt: hitDesc.excerpt } };
      }
    }
  }
  return { hidden: false };
}

/** Restituisce l'HTML del testo con le occorrenze evidenziate. */
export function highlight(text, entries = [], escapeFn) {
  if (!text) return '';
  const { norm, map } = normalizeWithMap(text);
  const ranges = [];
  for (const entry of entries) {
    entry.re.lastIndex = 0;
    let m;
    while ((m = entry.re.exec(norm)) !== null) {
      ranges.push([map[m.index], map[m.index + m[0].length]]);
      if (m.index === entry.re.lastIndex) entry.re.lastIndex++;
    }
  }
  if (!ranges.length) return escapeFn(text);

  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0]];
  for (const [s, e] of ranges.slice(1)) {
    const last = merged[merged.length - 1];
    if (s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }

  let out = '';
  let cursor = 0;
  for (const [s, e] of merged) {
    out += escapeFn(text.slice(cursor, s)) + '<mark>' + escapeFn(text.slice(s, e)) + '</mark>';
    cursor = e;
  }
  return out + escapeFn(text.slice(cursor));
}
