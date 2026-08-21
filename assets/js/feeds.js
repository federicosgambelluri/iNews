/**
 * Scarico e parsing dei feed RSS / Atom / RDF.
 *
 * Un sito statico non può leggere i feed direttamente (i server dei giornali
 * non mandano header CORS), quindi ci sono due strade, provate in quest'ordine:
 *   1. `data/news.json`, generato ogni ora da una GitHub Action — nessun proxy,
 *      nessuna attesa, funziona anche offline;
 *   2. i proxy CORS pubblici, in cascata, per i feed non presenti nella cache
 *      statica o aggiunti dall'utente.
 */

import { APP, CORS_PROXIES, STATIC_CACHE_URL, STATIC_CACHE_MAX_AGE_MIN, CATEGORY_ALIASES } from './config.js';
import { normalize } from './filter.js';

// Creato alla prima chiamata: così il modulo resta importabile anche da Node
// (tools/fetch-feeds.mjs riusa resolveCategory e detectLang senza copiarli).
let _parser = null;
const dom = () => (_parser ||= new DOMParser());

const text = (node, ...names) => {
  for (const name of names) {
    const el = node.querySelector(name);
    if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
  }
  return '';
};

const attr = (node, selector, name) => {
  const el = node.querySelector(selector);
  return el ? el.getAttribute(name) || '' : '';
};

/** Toglie i tag HTML da un sommario mantenendo il testo leggibile. */
export function stripHtml(html = '') {
  if (!html) return '';
  const doc = dom().parseFromString(`<body>${html}</body>`, 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

function extractImage(item, htmlContent) {
  const enclosure = item.querySelector('enclosure[url]');
  if (enclosure && /image/i.test(enclosure.getAttribute('type') || 'image')) {
    return enclosure.getAttribute('url');
  }
  for (const sel of ['media\\:content[url]', 'content[url]', 'media\\:thumbnail[url]', 'thumbnail[url]', 'image url', 'image']) {
    const el = item.querySelector(sel);
    const url = el && (el.getAttribute('url') || el.textContent);
    if (url && /^https?:/.test(url.trim())) return url.trim();
  }
  const match = /<img[^>]+src=["']([^"']+)["']/i.exec(htmlContent || '');
  return match ? match[1] : '';
}

/**
 * Categoria dell'articolo: prima i <category> dell'articolo stesso, se dicono
 * qualcosa che sappiamo tradurre; altrimenti quella assegnata alla fonte.
 */
export function resolveCategory(tags, feed) {
  for (const tag of tags) {
    const key = normalize(tag).replace(/[^a-z0-9]+/g, ' ').trim();
    for (const word of [key, ...key.split(' ')]) {
      if (CATEGORY_ALIASES[word]) return CATEGORY_ALIASES[word];
    }
  }
  return feed.category || 'Generale';
}

// Parole cortissime e frequentissime: bastano a distinguere due lingue in un titolo.
const IT_WORDS = /(?:^|\s)(di|il|la|le|lo|che|per|non|con|una|un|del|della|dei|sono|piu|dopo|anche|dalla|nel|nella|alla|gli|come|questo|essere|stato|stata|ha|ma|si|se|al|da|su|tra|fra|ci)(?=\s|$)/g;
const EN_WORDS = /(?:^|\s)(the|and|of|to|in|is|for|with|that|from|after|on|by|as|are|was|has|its|be|at|this|it|will|new|how|why)(?=\s|$)/g;

/** Lingua dell'articolo, indovinata dalle parole comuni. Ripiega su quella della fonte. */
export function detectLang(text, fallback = 'it') {
  const norm = normalize(text || '').replace(/[^a-z0-9\s]+/g, ' ');
  if (norm.length < 25) return fallback;
  const it = (norm.match(IT_WORDS) || []).length;
  const en = (norm.match(EN_WORDS) || []).length;
  if (it === en) return fallback;
  return it > en ? 'it' : 'en';
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function stableId(feedId, link, title) {
  const base = `${feedId}|${link || title}`;
  let hash = 5381;
  for (let i = 0; i < base.length; i++) hash = ((hash << 5) + hash + base.charCodeAt(i)) | 0;
  return `${feedId}-${(hash >>> 0).toString(36)}`;
}

/** XML (RSS/Atom/RDF) → array di articoli normalizzati. */
export function parseFeed(xmlString, feed) {
  const doc = dom().parseFromString(xmlString, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML non valido');

  const nodes = [...doc.querySelectorAll('item, entry')].slice(0, APP.maxItemsPerFeed);
  if (!nodes.length) throw new Error('Nessun articolo nel feed');

  return nodes.map((item) => {
    const title = text(item, 'title') || '(senza titolo)';
    const tags = [...item.querySelectorAll('category')]
      .map((c) => (c.textContent || '').trim() || c.getAttribute('term') || '')
      .filter(Boolean);
    const link =
      text(item, 'link') ||
      attr(item, 'link[rel="alternate"]', 'href') ||
      attr(item, 'link', 'href') ||
      text(item, 'guid');

    const html = text(item, 'content\\:encoded', 'encoded', 'content', 'description', 'summary');
    const summary = stripHtml(text(item, 'description', 'summary', 'content\\:encoded', 'content'));

    return {
      id: stableId(feed.id, link, title),
      feedId: feed.id,
      feedName: feed.name,
      feedColor: feed.color,
      category: resolveCategory(tags, feed),
      tags: tags.slice(0, 6),
      lang: detectLang(`${title} ${summary}`, feed.lang || 'it'),
      title: stripHtml(title),
      link: (link || '').trim(),
      summary: summary.slice(0, 600),
      content: html,
      image: extractImage(item, html),
      author: text(item, 'dc\\:creator', 'creator', 'author name', 'author'),
      publishedAt:
        parseDate(text(item, 'pubDate', 'published', 'updated', 'dc\\:date', 'date')) ||
        new Date().toISOString()
    };
  });
}

/** rss2json risponde con articoli già normalizzati: ramo di lettura separato. */
function parseJsonFeed(payload, feed) {
  if (!payload || payload.status !== 'ok' || !Array.isArray(payload.items)) throw new Error('JSON inatteso');
  return payload.items.slice(0, APP.maxItemsPerFeed).map((item) => {
    const title = stripHtml(item.title || '(senza titolo)');
    const summary = stripHtml(item.description || item.content || '').slice(0, 600);
    const tags = Array.isArray(item.categories) ? item.categories.filter(Boolean) : [];
    return {
      id: stableId(feed.id, item.link, title),
      feedId: feed.id,
      feedName: feed.name,
      feedColor: feed.color,
      category: resolveCategory(tags, feed),
      tags: tags.slice(0, 6),
      lang: detectLang(`${title} ${summary}`, feed.lang || 'it'),
      title,
      link: (item.link || '').trim(),
      summary,
      content: item.content || item.description || '',
      image: item.thumbnail || item.enclosure?.link || '',
      author: item.author || '',
      publishedAt: parseDate(item.pubDate) || new Date().toISOString()
    };
  });
}

function proxies(customProxies = []) {
  const custom = customProxies
    .filter(Boolean)
    .map((tpl) => ({ name: 'custom', build: (url) => tpl.replace('{url}', encodeURIComponent(url)) }));
  return [...custom, ...CORS_PROXIES];
}

/*
 * I proxy pubblici vanno e vengono. Provarli uno dopo l'altro significa pagare
 * la somma di tutti i timeout quando sono giù (un minuto buono), quindi:
 *  - la prima volta li interroghiamo tutti insieme e teniamo il più veloce;
 *  - dopo si usa solo quello, finché non smette di funzionare.
 */
let preferredProxy = null;

async function attempt(proxy, feed, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(proxy.build(feed.url), { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    if (!body || body.length < 80) throw new Error('risposta vuota');
    const items = proxy.json ? parseJsonFeed(JSON.parse(body), feed) : parseFeed(body, feed);
    if (!items.length) throw new Error('nessun articolo');
    return { ok: true, items, via: proxy.name, proxy };
  } catch (err) {
    return { ok: false, error: `${proxy.name}: ${err.name === 'AbortError' ? 'tempo scaduto' : err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

/** Scarica un singolo feed. */
export async function fetchFeed(feed, { customProxies = [], timeout = 9000 } = {}) {
  const list = proxies(customProxies);
  if (!list.length) return { ok: false, items: [], error: 'nessun proxy configurato' };

  if (preferredProxy && list.includes(preferredProxy)) {
    const first = await attempt(preferredProxy, feed, timeout);
    if (first.ok) return first;
    preferredProxy = null;   // è caduto: si riapre la gara
  }

  const errors = [];
  try {
    const winner = await Promise.any(
      list.map((proxy) =>
        attempt(proxy, feed, timeout).then((r) => {
          if (r.ok) return r;
          errors.push(r.error);
          throw new Error(r.error);
        })
      )
    );
    preferredProxy = winner.proxy;
    return winner;
  } catch {
    return { ok: false, items: [], error: errors.join(' · ') || 'nessun proxy raggiungibile' };
  }
}

/** Legge la cache statica prodotta dalla GitHub Action, se esiste. */
export async function fetchStaticCache() {
  try {
    const res = await fetch(`${STATIC_CACHE_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data && Array.isArray(data.items) ? data : null;
  } catch {
    return null;
  }
}

/** Scarta i doppioni fra testate diverse (stesso titolo o stesso link). */
export function dedupe(articles) {
  const seen = new Set();
  const out = [];
  for (const a of articles) {
    const key = (a.link || '').split('?')[0].toLowerCase() ||
      a.title.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 60);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

/**
 * Carica tutti i feed attivi.
 *
 * La cache statica ha la precedenza solo finché è fresca: superata l'ora e un
 * quarto (la Action gira ogni mezz'ora) si passa alla rete, altrimenti il sito
 * resterebbe fermo alla fotografia scattata l'ultima volta che il repository è
 * stato aggiornato. `preferLive` è quello che fa il pulsante Aggiorna: chi lo
 * preme vuole le notizie di adesso, non quelle già in cache.
 *
 * @param {(progress:{done:number,total:number,feed:object,ok:boolean})=>void} onProgress
 */
export async function loadAll(feeds, { customProxies = [], strategy = 'auto', preferLive = false, onProgress } = {}) {
  const active = feeds.filter((f) => f.enabled !== false);
  const results = [];
  const problems = [];
  let done = 0;

  const staticItems = new Map();
  let staticAge = null;

  if (strategy !== 'live') {
    const cached = await fetchStaticCache();
    if (cached) {
      staticAge = Date.now() - new Date(cached.generatedAt || 0).getTime();
      for (const item of cached.items) {
        if (!staticItems.has(item.feedId)) staticItems.set(item.feedId, []);
        staticItems.get(item.feedId).push(item);
      }
    }
  }

  const staticFresh = staticAge !== null && staticAge < STATIC_CACHE_MAX_AGE_MIN * 60 * 1000;
  const sources = new Set();

  await Promise.all(
    active.map(async (feed) => {
      const cachedItems = staticItems.get(feed.id) || null;
      let outcome;

      if (cachedItems && staticFresh && !preferLive) {
        outcome = { ok: true, items: cachedItems, via: 'cache' };
      } else if (strategy === 'static') {
        outcome = cachedItems
          ? { ok: true, items: cachedItems, via: 'cache' }
          : { ok: false, items: [], error: 'assente dalla cache statica' };
      } else {
        outcome = await fetchFeed(feed, { customProxies });
        // Se la rete non risponde, meglio una notizia vecchia che una pagina vuota.
        if (!outcome.ok && cachedItems) outcome = { ok: true, items: cachedItems, via: 'cache di riserva' };
      }

      if (outcome.ok) {
        results.push(...outcome.items);
        sources.add(outcome.via);
      } else {
        problems.push({ feed: feed.name, error: outcome.error });
      }

      done++;
      onProgress?.({ done, total: active.length, feed, ok: outcome.ok });
    })
  );

  // Gli articoli che arrivano dalla cache statica sono stati letti da Node, che
  // non fa il riconoscimento della lingua: lo completo qui.
  for (const article of results) {
    if (!article.lang) {
      const feed = feeds.find((f) => f.id === article.feedId);
      article.lang = detectLang(`${article.title} ${article.summary}`, feed?.lang || 'it');
    }
  }

  results.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  return {
    articles: dedupe(results),
    problems,
    staticAge,
    via: sources.size === 1 ? [...sources][0] : (sources.size ? 'misto' : null)
  };
}
