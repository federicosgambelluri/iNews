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

import { APP, CORS_PROXIES, STATIC_CACHE_URL } from './config.js';

const parser = new DOMParser();

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
  const doc = parser.parseFromString(`<body>${html}</body>`, 'text/html');
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
  const doc = parser.parseFromString(xmlString, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML non valido');

  const nodes = [...doc.querySelectorAll('item, entry')].slice(0, APP.maxItemsPerFeed);
  if (!nodes.length) throw new Error('Nessun articolo nel feed');

  return nodes.map((item) => {
    const title = text(item, 'title') || '(senza titolo)';
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
      category: feed.category || 'Generale',
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

function proxies(customProxies = []) {
  const custom = customProxies
    .filter(Boolean)
    .map((tpl) => ({ name: 'custom', build: (url) => tpl.replace('{url}', encodeURIComponent(url)) }));
  return [...custom, ...CORS_PROXIES];
}

/** Scarica un singolo feed provando i proxy in cascata. */
export async function fetchFeed(feed, { customProxies = [], timeout = 12000 } = {}) {
  const errors = [];
  for (const proxy of proxies(customProxies)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(proxy.build(feed.url), { signal: controller.signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      if (!body || body.length < 80) throw new Error('Risposta vuota');
      const items = parseFeed(body, feed);
      return { ok: true, items, via: proxy.name };
    } catch (err) {
      errors.push(`${proxy.name}: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, items: [], error: errors.join(' · ') };
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
 * @param {(progress:{done:number,total:number,feed:object,ok:boolean})=>void} onProgress
 */
export async function loadAll(feeds, { customProxies = [], strategy = 'auto', onProgress } = {}) {
  const active = feeds.filter((f) => f.enabled !== false);
  const results = [];
  const problems = [];
  let done = 0;

  let staticItems = new Map();
  if (strategy !== 'live') {
    const cached = await fetchStaticCache();
    if (cached) {
      for (const item of cached.items) {
        if (!staticItems.has(item.feedId)) staticItems.set(item.feedId, []);
        staticItems.get(item.feedId).push(item);
      }
    }
  }

  await Promise.all(
    active.map(async (feed) => {
      let outcome;
      const fromStatic = staticItems.get(feed.id);
      if (fromStatic && fromStatic.length) {
        outcome = { ok: true, items: fromStatic, via: 'cache statica' };
      } else if (strategy === 'static') {
        outcome = { ok: false, items: [], error: 'assente dalla cache statica' };
      } else {
        outcome = await fetchFeed(feed, { customProxies });
      }

      if (outcome.ok) results.push(...outcome.items);
      else problems.push({ feed: feed.name, error: outcome.error });

      done++;
      onProgress?.({ done, total: active.length, feed, ok: outcome.ok });
    })
  );

  results.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return { articles: dedupe(results), problems };
}
