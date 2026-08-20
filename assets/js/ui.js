/** Helper di rendering: niente framework, solo template string + delega eventi. */

import { highlight } from './filter.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const ICONS = {
  bookmark: '<svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 10 8 10 8a18 18 0 0 1-2.16 3.19m-6.72 1.07A9.1 9.1 0 0 1 12 20c-7 0-10-8-10-8a18 18 0 0 1 5.06-5.94M1 1l22 22M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z"/><circle cx="12" cy="12" r="3"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  external: '<svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/></svg>',
  share: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>'
};

const RTF = new Intl.RelativeTimeFormat('it', { numeric: 'auto' });
const DTF = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function timeAgo(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = (then - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'adesso';
  if (abs < 3600) return RTF.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return RTF.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return RTF.format(Math.round(diff / 86400), 'day');
  return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' }).format(then);
}

export const fullDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : DTF.format(d);
};

/** Card di un articolo visibile. */
export function cardHTML(article, state) {
  const saved = state.saved.has(article.id);
  const read = state.read.has(article.id);
  const color = article.feedColor || 'var(--accent)';

  const media = article.image
    ? `<div class="card__media"><img src="${esc(article.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.card__media').remove()"></div>`
    : `<div class="card__media card__media--empty"><span>${esc((article.feedName || '?')[0])}</span></div>`;

  return `
  <article class="card ${read ? 'is-read' : ''}" data-id="${esc(article.id)}">
    ${media}
    <div class="card__body">
      <div class="card__meta">
        <span class="card__source"><i style="background:${esc(color)}"></i>${esc(article.feedName)}</span>
        <span aria-hidden="true">·</span>
        <time datetime="${esc(article.publishedAt)}" title="${esc(fullDate(article.publishedAt))}">${esc(timeAgo(article.publishedAt))}</time>
      </div>
      <h3 class="card__title"><button data-act="open">${esc(article.title)}</button></h3>
      ${article.summary ? `<p class="card__summary">${esc(article.summary)}</p>` : ''}
      <div class="card__foot">
        <button class="act ${saved ? 'is-on' : ''}" data-act="save" title="${saved ? 'Rimuovi dai salvati' : 'Salva per dopo'}" aria-label="Salva">${ICONS.bookmark}</button>
        <button class="act ${read ? 'is-on' : ''}" data-act="read" title="${read ? 'Segna da leggere' : 'Segna come letta'}" aria-label="Segna come letta">${ICONS.check}</button>
        <button class="act" data-act="hide" title="Nascondi questa notizia" aria-label="Nascondi">${ICONS.eyeOff}</button>
        <span class="spacer"></span>
        <a class="act" href="${esc(article.link)}" target="_blank" rel="noopener" data-act="external" title="Apri l'originale" aria-label="Apri l'originale">${ICONS.external}</a>
      </div>
    </div>
  </article>`;
}

/** Riga della zona nascosta: il motivo è sempre in chiaro, il titolo sfocato. */
export function veiledHTML(article, compiled) {
  const reason = article._reason || {};
  const why = reason.manual
    ? 'nascosta a mano'
    : `contiene <b>${esc(reason.term || '')}</b>${reason.field === 'summary' ? ' (nella descrizione)' : ''}`;

  return `
  <div class="veiled" data-id="${esc(article.id)}">
    <div class="veiled__why">${ICONS.shield}<span>${why}</span></div>
    <p class="veiled__title veiled__blur">${highlight(article.title, compiled, esc)}</p>
    <div class="veiled__meta">
      <span>${esc(article.feedName)}</span><span>·</span>
      <time datetime="${esc(article.publishedAt)}">${esc(timeAgo(article.publishedAt))}</time>
    </div>
    <div class="veiled__actions">
      <button class="btn btn--tiny" data-act="open">Leggi comunque</button>
      <button class="btn btn--tiny" data-act="unhide">Riporta in home</button>
      ${reason.term ? `<button class="btn btn--tiny btn--danger" data-act="drop-term" title="Rimuove «${esc(reason.term)}» dal dizionario">Togli «${esc(reason.term)}»</button>` : ''}
    </div>
  </div>`;
}

export function emptyHTML({ title, text, action }) {
  return `<h2>${esc(title)}</h2><p>${esc(text)}</p>${action ? `<button class="btn btn--primary" data-act="${esc(action.act)}">${esc(action.label)}</button>` : ''}`;
}

/** Toast con eventuale azione di annullamento. */
export function toast(message, { actionLabel, onAction, timeout = 4500 } = {}) {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(message)}</span>${actionLabel ? `<button type="button">${esc(actionLabel)}</button>` : ''}`;
  host.appendChild(el);

  const close = () => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 250);
  };
  el.querySelector('button')?.addEventListener('click', () => { onAction?.(); close(); });
  setTimeout(close, timeout);
  return close;
}
