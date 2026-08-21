/**
 * Genera data/news.json leggendo i feed lato server (GitHub Actions).
 *
 * È la risposta alla domanda "posso scrivere su file senza backend?": sì,
 * non dal browser, ma da una GitHub Action che gira ogni ora, scarica i feed
 * e fa commit del risultato nel repo. Il sito resta statico, e in più
 * l'utente non deve passare dai proxy CORS.
 *
 *   node tools/fetch-feeds.mjs
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { DEFAULT_FEEDS } from '../assets/js/config.js';
import { resolveCategory, detectLang } from '../assets/js/feeds.js';

const MAX_PER_FEED = 40;
const TIMEOUT = 20000;
const IMAGE_CONCURRENCY = 8;
const UA = {
  'User-Agent': 'Mozilla/5.0 (compatible; iNewsBot/1.0; +https://github.com/) feed reader',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

const decodeEntities = (s = '') =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
   .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
   .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
   .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
   .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
   .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

const stripTags = (s = '') => decodeEntities(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function tag(xml, ...names) {
  for (const name of names) {
    const re = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i');
    const m = re.exec(xml);
    if (m && m[1].trim()) return decodeEntities(m[1]).trim();
  }
  return '';
}

function attrOf(xml, tagName, attr, filter) {
  const re = new RegExp(`<(?:\\w+:)?${tagName}\\b[^>]*>`, 'gi');
  let m;
  while ((m = re.exec(xml)) !== null) {
    if (filter && !filter.test(m[0])) continue;
    const a = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, 'i').exec(m[0]);
    if (a) return decodeEntities(a[1]);
  }
  return '';
}

/** Stessa funzione del browser: gli id devono coincidere fra cache e diretta. */
function stableId(feedId, link, title) {
  const base = `${feedId}|${link || title}`;
  let hash = 5381;
  for (let i = 0; i < base.length; i++) hash = ((hash << 5) + hash + base.charCodeAt(i)) | 0;
  return `${feedId}-${(hash >>> 0).toString(36)}`;
}

function parse(xml, feed) {
  const blocks = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) || [];

  return blocks.slice(0, MAX_PER_FEED).map((block) => {
    const title = stripTags(tag(block, 'title')) || '(senza titolo)';
    const tags = [
      ...[...block.matchAll(/<(?:\w+:)?category(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?category>/gi)].map((m) => stripTags(m[1])),
      ...[...block.matchAll(/<(?:\w+:)?category\b[^>]*\bterm=["']([^"']+)["']/gi)].map((m) => decodeEntities(m[1]))
    ].filter(Boolean);
    let link = tag(block, 'link');
    if (!link || /^\s*$/.test(link) || /</.test(link)) {
      link = attrOf(block, 'link', 'href', /rel=["']alternate["']/i) || attrOf(block, 'link', 'href') || tag(block, 'guid');
    }

    const content = tag(block, 'encoded', 'content', 'description', 'summary');
    const image =
      attrOf(block, 'enclosure', 'url', /image/i) ||
      attrOf(block, 'content', 'url', /media/i) ||
      attrOf(block, 'thumbnail', 'url') ||
      (/<img[^>]+src=["']([^"']+)["']/i.exec(content || '') || [])[1] || '';

    const dateRaw = tag(block, 'pubDate', 'published', 'updated', 'date');
    const parsed = dateRaw ? new Date(dateRaw) : null;

    return {
      id: stableId(feed.id, link, title),
      feedId: feed.id,
      feedName: feed.name,
      feedColor: feed.color,
      category: resolveCategory(tags, feed),
      tags: tags.slice(0, 6),
      lang: detectLang(`${title} ${stripTags(content).slice(0, 300)}`, feed.lang || 'it'),
      title,
      link: (link || '').trim(),
      summary: stripTags(tag(block, 'description', 'summary', 'encoded', 'content')).slice(0, 600),
      content: content.slice(0, 20000),
      image,
      author: stripTags(tag(block, 'creator', 'author', 'name')),
      publishedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString()
    };
  });
}

async function fetchFeed(feed) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(feed.url, {
      signal: controller.signal,
      headers: {
        // Alcune testate rifiutano gli user agent "da script".
        'User-Agent': 'Mozilla/5.0 (compatible; iNewsBot/1.0; +https://github.com/) feed reader',
        Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = parse(await res.text(), feed);
    if (!items.length) throw new Error('nessun articolo');
    console.log(`  ok  ${feed.name}: ${items.length} articoli`);
    return items;
  } catch (err) {
    console.warn(`  ko  ${feed.name}: ${err.message}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Molti feed (ANSA, Repubblica, Il Post, DDAY…) non pubblicano nessuna immagine.
 * Qui giriamo sulla pagina dell'articolo e leggiamo og:image: una richiesta in
 * più per articolo, che nel browser sarebbe insostenibile ma su un runner di
 * GitHub costa qualche secondo una volta ogni mezz'ora.
 */
async function enrichImages(items) {
  const missing = items.filter((a) => !a.image && a.link);
  let index = 0;
  let found = 0;

  const worker = async () => {
    while (index < missing.length) {
      const article = missing[index++];
      try {
        const res = await fetch(article.link, { headers: UA, signal: AbortSignal.timeout(12000) });
        if (!res.ok) continue;
        const head = (await res.text()).slice(0, 250000);
        const m =
          /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*\scontent=["']([^"']+)["']/i.exec(head) ||
          /<meta[^>]+content=["']([^"']+)["'][^>]*\s(?:property|name)=["'](?:og:image|twitter:image)["']/i.exec(head);
        if (m && m[1]) {
          article.image = new URL(decodeEntities(m[1]), article.link).href;
          found++;
        }
      } catch {
        // pagina irraggiungibile: l'articolo resta senza immagine, pazienza
      }
    }
  };

  await Promise.all(Array.from({ length: IMAGE_CONCURRENCY }, worker));
  console.log(`\nimmagini recuperate da og:image: ${found} su ${missing.length} articoli senza`);
}

const all = (await Promise.all(DEFAULT_FEEDS.map(fetchFeed))).flat();

// Doppioni fra testate diverse: tengo il primo per link.
const seen = new Set();
const items = all.filter((a) => {
  const key = (a.link || a.title).split('?')[0].toLowerCase();
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

await enrichImages(items);

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../data/news.json', import.meta.url),
  JSON.stringify({ generatedAt: new Date().toISOString(), count: items.length, items }, null, 0)
);

console.log(`\n${items.length} articoli scritti in data/news.json`);
