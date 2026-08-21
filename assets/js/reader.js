/**
 * Lettore interno: ripulisce l'HTML del feed e, quando il feed offre solo
 * due righe, prova a recuperare il testo completo dalla pagina originale
 * (sempre passando dai proxy CORS).
 */

import { fetchViaProxy } from './feeds.js';

const ALLOWED = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'blockquote',
  'h2', 'h3', 'h4', 'figure', 'figcaption', 'img', 'picture', 'source',
  'pre', 'code', 'hr', 'span', 'small', 'time', 'table', 'thead', 'tbody', 'tr', 'td', 'th'
]);

const ALLOWED_ATTRS = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'width', 'height'],
  source: ['srcset', 'type'],
  '*': []
};

const BLOCKED = /^(script|style|iframe|object|embed|form|input|button|svg|link|meta|noscript|video|audio|canvas)$/i;

const absolutize = (url, base) => {
  try { return new URL(url, base).href; } catch { return ''; }
};

/** Ripulisce un frammento HTML tenendo solo tag e attributi innocui. */
export function sanitize(html, baseUrl = '') {
  const doc = new DOMParser().parseFromString(`<div id="r">${html || ''}</div>`, 'text/html');
  const root = doc.getElementById('r');

  const walk = (node) => {
    for (const child of [...node.children]) {
      const tag = child.tagName.toLowerCase();

      if (BLOCKED.test(tag)) { child.remove(); continue; }

      if (!ALLOWED.has(tag)) {
        // Tag sconosciuto (div, section, article…): tengo il contenuto.
        walk(child);
        child.replaceWith(...child.childNodes);
        continue;
      }

      const allowed = ALLOWED_ATTRS[tag] || ALLOWED_ATTRS['*'];
      for (const attr of [...child.attributes]) {
        if (!allowed.includes(attr.name)) { child.removeAttribute(attr.name); continue; }
        if ((attr.name === 'href' || attr.name === 'src') && baseUrl) {
          const abs = absolutize(attr.value, baseUrl);
          if (!/^https?:/i.test(abs)) child.removeAttribute(attr.name);
          else child.setAttribute(attr.name, abs);
        }
        if (/^\s*javascript:/i.test(attr.value)) child.removeAttribute(attr.name);
      }
      if (tag === 'a') { child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noopener nofollow'); }
      if (tag === 'img') { child.setAttribute('loading', 'lazy'); child.setAttribute('referrerpolicy', 'no-referrer'); }

      walk(child);
    }
  };

  walk(root);
  return root.innerHTML.trim();
}

const textLength = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim().length;

/** Euristica alla Readability, in versione minima. */
function pickArticleNode(doc) {
  const candidates = [...doc.querySelectorAll('article, [itemprop="articleBody"], .article-body, .entry-content, .post-content, main, [role="main"]')];
  let best = null;
  let bestScore = 0;

  const score = (el) => {
    const paragraphs = el.querySelectorAll('p');
    if (paragraphs.length < 3) return 0;
    let s = 0;
    for (const p of paragraphs) {
      const len = textLength(p);
      if (len > 40) s += len;
    }
    // Penalizzo i contenitori pieni di link (menu, "leggi anche", correlati).
    const linkDensity = textLength(el) ? [...el.querySelectorAll('a')].reduce((n, a) => n + textLength(a), 0) / textLength(el) : 1;
    return s * (1 - Math.min(linkDensity, .9));
  };

  for (const el of candidates.length ? candidates : [doc.body]) {
    const s = score(el);
    if (s > bestScore) { bestScore = s; best = el; }
  }

  if (!best) {
    // Ultimo tentativo: il genitore comune dei paragrafi più lunghi.
    const paras = [...doc.querySelectorAll('p')].filter((p) => textLength(p) > 80);
    if (paras.length >= 3) best = paras[0].parentElement;
  }
  return bestScore > 400 ? best : best;
}

/**
 * Prova a scaricare ed estrarre il testo completo dell'articolo.
 *
 * È la seconda scelta: quasi sempre il testo arriva già pronto da
 * data/news.json, perché lo estrae la GitHub Action lato server. Qui si finisce
 * solo per gli articoli aggiunti dall'utente o assenti dalla cache, e allora
 * tocca passare dai proxy — che possono benissimo essere tutti giù.
 *
 * @returns {Promise<{ok:boolean, html?:string, error?:string}>}
 */
export async function fetchFullArticle(url, { customProxies = [], timeout = 9000 } = {}) {
  const result = await fetchViaProxy(url, {
    customProxies,
    timeout,
    validate: ({ body }) => {
      const doc = new DOMParser().parseFromString(body, 'text/html');
      doc.querySelectorAll('script, style, noscript, aside, nav, footer, header, form, .related, .newsletter, .paywall')
        .forEach((n) => n.remove());

      const node = pickArticleNode(doc);
      if (!node || textLength(node) < 400) throw new Error('testo non individuato');
      return { html: sanitize(node.innerHTML, url) };
    }
  });

  return result.ok
    ? { ok: true, html: result.html }
    : { ok: false, error: 'Il testo completo non è disponibile: i servizi che fanno da ponte verso il sito non rispondono.' };
}
