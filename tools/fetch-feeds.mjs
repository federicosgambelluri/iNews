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
   .replace(/&nbsp;/g, ' ')
   .replace(/&(rsquo|lsquo|apos);/g, "'")
   .replace(/&(rdquo|ldquo|quot);/g, '"')
   .replace(/&(mdash|ndash);/g, '-')
   .replace(/&hellip;/g, '...')
   .replace(/&(laquo);/g, '\u00ab').replace(/&(raquo);/g, '\u00bb')
   .replace(/&(egrave);/g, '\u00e8').replace(/&(eacute);/g, '\u00e9')
   .replace(/&(agrave);/g, '\u00e0').replace(/&(ograve);/g, '\u00f2')
   .replace(/&(igrave);/g, '\u00ec').replace(/&(ugrave);/g, '\u00f9')
   .replace(/&euro;/g, '\u20ac').replace(/&deg;/g, '\u00b0')
   .replace(/&amp;/g, '&');

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

const MAX_TEXT = 9000;      // caratteri di testo tenuti per articolo
const ENRICH_NEWEST = 220;  // quanti articoli visitare, dal più recente

// Righe che compaiono in ogni pagina e non c'entrano con l'articolo.
const BOILERPLATE = /(cookie|consentless|informativa privacy|condizioni generali|abbonamen|iscriviti alla newsletter|riproduzione riservata|accetta|pubblicit|segui .{0,20}su (facebook|twitter|whatsapp)|leggi anche|tutti i diritti)/i;

/** Dal tag di apertura al suo tag di chiusura, contando gli annidamenti. */
function sliceElement(html, from, tagName) {
  const open = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  const close = new RegExp(`</${tagName}\\s*>`, 'gi');
  open.lastIndex = from;
  const first = open.exec(html);
  if (!first) return '';

  let depth = 1;
  let cursor = open.lastIndex;
  while (depth > 0 && cursor < html.length) {
    open.lastIndex = cursor;
    close.lastIndex = cursor;
    const nextOpen = open.exec(html);
    const nextClose = close.exec(html);
    if (!nextClose) return html.slice(first.index, Math.min(html.length, first.index + 300000));
    if (nextOpen && nextOpen.index < nextClose.index) { depth++; cursor = open.lastIndex; }
    else { depth--; cursor = close.lastIndex; }
  }
  return html.slice(first.index, cursor);
}

/** Paragrafi utili di un frammento, con il loro peso complessivo. */
function paragraphsOf(fragment) {
  const out = [];
  let total = 0;
  for (const m of fragment.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = stripTags(m[1]);
    if (text.length < 60) continue;          // didascalie, firme, briciole di menu
    if (BOILERPLATE.test(text)) continue;    // cookie, abbonamenti, "leggi anche"
    out.push(text);
    total += text.length;
    if (total > MAX_TEXT) break;
  }
  return { paragraphs: out, total };
}

/**
 * Testo dell'articolo, in HTML minimo.
 * Prima cerca il contenitore che *è* l'articolo (<article>, articleBody,
 * entry-content…): prendere tutti i <p> della pagina significherebbe portarsi
 * dietro l'informativa sui cookie, come è successo nella prima versione.
 */
function extractText(html) {
  const page = html
    .replace(/<(script|style|noscript|nav|aside|footer|header|form|figure|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const candidates = [];
  const markers = [
    /<article\b[^>]*>/i,
    /<div\b[^>]*itemprop=["']articleBody["'][^>]*>/i,
    /<div\b[^>]*class=["'][^"']*(?:article-?body|articlebody|entry-content|post-content|story-?body|content__body|testo|article__content)[^"']*["'][^>]*>/i,
    /<main\b[^>]*>/i
  ];

  for (const marker of markers) {
    const hit = marker.exec(page);
    if (!hit) continue;
    const tag = /^<(\w+)/.exec(hit[0])[1];
    const fragment = sliceElement(page, hit.index, tag);
    if (fragment) candidates.push(fragment);
  }
  candidates.push(page);   // ultima risorsa: tutta la pagina

  let best = { paragraphs: [], total: 0 };
  for (const fragment of candidates) {
    const found = paragraphsOf(fragment);
    // Il primo contenitore che dà un articolo vero vince: è il più specifico.
    if (found.total >= 500) { best = found; break; }
    if (found.total > best.total) best = found;
  }

  if (best.total < 400) return '';
  const escape = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return best.paragraphs.map((t) => `<p>${escape(t)}</p>`).join('');
}

/**
 * Visita la pagina di ogni articolo e ne ricava due cose che il feed spesso non
 * dà: l'immagine di apertura (og:image) e il testo completo. Nel browser
 * sarebbero centinaia di richieste attraverso proxy pubblici inaffidabili; qui
 * è una passata sola, ogni mezz'ora, su una macchina di GitHub.
 */
async function enrich(items) {
  const targets = items.slice(0, ENRICH_NEWEST).filter((a) => a.link);
  let index = 0;
  let images = 0;
  let texts = 0;

  const worker = async () => {
    while (index < targets.length) {
      const article = targets[index++];
      const serveImmagine = !article.image;
      const serveTesto = stripTags(article.content || '').length < 900;
      if (!serveImmagine && !serveTesto) continue;

      try {
        const res = await fetch(article.link, { headers: UA, signal: AbortSignal.timeout(12000) });
        if (!res.ok) continue;
        const page = (await res.text()).slice(0, 400000);

        if (serveImmagine) {
          const m =
            /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*\scontent=["']([^"']+)["']/i.exec(page) ||
            /<meta[^>]+content=["']([^"']+)["'][^>]*\s(?:property|name)=["'](?:og:image|twitter:image)["']/i.exec(page);
          if (m && m[1]) { article.image = new URL(decodeEntities(m[1]), article.link).href; images++; }
        }

        if (serveTesto) {
          const text = extractText(page);
          if (text) { article.content = text; article.fullText = true; texts++; }
        }
      } catch {
        // pagina irraggiungibile: restano il titolo e il sommario del feed
      }
    }
  };

  await Promise.all(Array.from({ length: IMAGE_CONCURRENCY }, worker));
  console.log(`\narricchimento su ${targets.length} articoli: ${images} immagini, ${texts} testi completi`);
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

await enrich(items);

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../data/news.json', import.meta.url),
  JSON.stringify({ generatedAt: new Date().toISOString(), count: items.length, items }, null, 0)
);

console.log(`\n${items.length} articoli scritti in data/news.json`);
