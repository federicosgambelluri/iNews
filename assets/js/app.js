/**
 * iNews — orchestratore.
 * Tiene insieme stato, filtro, rendering e persistenza.
 */

import { APP, DEFAULT_FEEDS, DEFAULT_DICTIONARY, DEFAULT_WHITELIST, DEFAULT_SETTINGS } from './config.js';
import { createStore, localStorageAdapter } from './storage.js';
import { compileDictionary, evaluate, compileTerm } from './filter.js';
import { loadAll } from './feeds.js';
import { sanitize, fetchFullArticle } from './reader.js';
import { dictionaryPanel, feedsPanel, lookPanel, dataPanel } from './settings.js';
import { $, $$, esc, cardHTML, veiledHTML, emptyHTML, toast, timeAgo, fullDate, ICONS } from './ui.js';

const store = createStore(localStorageAdapter);

const state = {
  settings: { ...DEFAULT_SETTINGS },
  feeds: [],
  dictionary: [],
  whitelist: [],
  read: new Set(),
  saved: new Set(),
  manualHidden: new Set(),
  allowed: new Set(),          // notizie sbloccate a mano dall'utente
  articles: [],
  visible: [],
  hidden: [],
  problems: [],
  compiled: [],
  compiledSafe: [],
  view: 'all',
  category: null,
  source: null,
  lang: null,
  query: '',
  vaultTerm: null,
  loading: false,
  lastSync: null,
  lastVia: null,
  staticAge: null
};

/* ------------------------------------------------------------- avvio */

async function init() {
  state.settings = { ...DEFAULT_SETTINGS, ...(await store.load('settings', {})) };
  state.feeds = await store.load('feeds', structuredClone(DEFAULT_FEEDS));
  state.dictionary = await store.load('dictionary', structuredClone(DEFAULT_DICTIONARY));
  state.whitelist = await store.load('whitelist', structuredClone(DEFAULT_WHITELIST));
  state.read = new Set(await store.load('read', []));
  state.saved = new Set(await store.load('saved', []));
  state.manualHidden = new Set(await store.load('manualHidden', []));
  state.allowed = new Set(await store.load('allowed', []));

  applyTheme();
  applyLayout();
  recompile();
  wireEvents();

  const cache = await store.load('feedCache', null);
  if (cache && Date.now() - cache.at < APP.feedCacheMinutes * 60 * 1000) {
    state.articles = cache.articles;
    state.lastSync = cache.at;
    partition();
    render();
    refresh({ silent: true });
  } else {
    render();
    refresh();
  }

  if (+state.settings.autoRefreshMinutes > 0) {
    setInterval(() => refresh({ silent: true }), +state.settings.autoRefreshMinutes * 60 * 1000);
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  window.addEventListener('beforeunload', () => store.flush());
}

/* ------------------------------------------------------- tema e layout */

const media = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const mode = state.settings.theme === 'auto' ? (media.matches ? 'dark' : 'light') : state.settings.theme;
  document.documentElement.dataset.theme = mode;
  $('meta[name="theme-color"]').setAttribute('content', mode === 'dark' ? '#0c0e12' : '#f5f6f8');
}
media.addEventListener('change', () => { if (state.settings.theme === 'auto') applyTheme(); });

function applyLayout() {
  $('#board').dataset.layout = state.settings.layout;
  $('#edge-handle').hidden = !state.settings.showEdgeHandle;
}

/* ------------------------------------------------------------- filtro */

function recompile() {
  state.compiled = compileDictionary(state.dictionary);
  state.compiledSafe = compileDictionary(state.whitelist.map((w) => ({ ...w, enabled: true })));
}

/** Divide gli articoli fra visibili e nascosti, annotando il perché. */
function partition() {
  const visible = [];
  const hidden = [];
  const filterOn = state.settings.filterEnabled;

  for (const article of state.articles) {
    if (state.manualHidden.has(article.id)) {
      article._reason = { manual: true };
      hidden.push(article);
      continue;
    }
    if (!filterOn || state.allowed.has(article.id)) {
      article._reason = null;
      visible.push(article);
      continue;
    }
    const verdict = evaluate(article, {
      dictionary: state.compiled,
      whitelist: state.compiledSafe,
      defaultScope: state.settings.defaultScope
    });
    if (verdict.hidden) {
      article._reason = verdict.reason;
      hidden.push(article);
    } else {
      article._reason = null;
      visible.push(article);
    }
  }

  state.visible = visible;
  state.hidden = hidden;
}

function termStats() {
  const stats = {};
  for (const a of state.hidden) {
    const term = a._reason?.term;
    if (term) stats[term] = (stats[term] || 0) + 1;
  }
  return stats;
}

/** Applica vista, fonte e ricerca alla lista dei visibili. */
function currentList() {
  const q = state.query.trim().toLowerCase();
  return state.visible.filter((a) => {
    if (state.view === 'saved' && !state.saved.has(a.id)) return false;
    if (state.view === 'unread' && state.read.has(a.id)) return false;
    if (state.view === 'all' && state.settings.hideRead && state.read.has(a.id) && !state.saved.has(a.id)) return false;
    if (state.category && (a.category || 'Generale') !== state.category) return false;
    if (state.source && a.feedId !== state.source) return false;
    if (state.lang && (a.lang || 'it') !== state.lang) return false;
    if (q && !(`${a.title} ${a.summary} ${a.feedName}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

/* ------------------------------------------------------------ scarico */

async function refresh({ silent = false, preferLive = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  $('#progress').hidden = false;
  $('#btn-refresh').classList.add('is-spinning');

  const known = new Set(state.articles.map((a) => a.id));

  const { articles, problems, staticAge, via } = await loadAll(state.feeds, {
    customProxies: state.settings.customProxies,
    strategy: state.settings.sourceStrategy,
    preferLive
  });

  state.problems = problems;
  state.staticAge = staticAge;
  let fresh = 0;
  if (articles.length) {
    fresh = articles.filter((a) => !known.has(a.id)).length;
    state.articles = articles;
    state.lastSync = Date.now();
    state.lastVia = via;
    store.save('feedCache', { at: state.lastSync, articles: articles.slice(0, 400) });
  }

  state.loading = false;
  $('#progress').hidden = true;
  $('#btn-refresh').classList.remove('is-spinning');

  partition();
  render();
  updateSyncLabel();

  // Un aggiornamento a mano deve sempre dire com'è andata: senza un riscontro
  // sembra che il pulsante non faccia niente.
  if (!silent && articles.length) {
    const origine = via === 'cache' ? ' (dalla cache del sito)' : '';
    toast(fresh ? `${fresh} ${fresh === 1 ? 'notizia nuova' : 'notizie nuove'}${origine}` : `Nessuna novità${origine}`);
  }

  if (!silent && problems.length) {
    toast(`${problems.length} ${problems.length === 1 ? 'fonte non raggiungibile' : 'fonti non raggiungibili'}`, {
      actionLabel: 'Vedi', onAction: () => openSettings('feeds')
    });
  }
  if (!silent && !articles.length && !state.articles.length) {
    toast('Nessun feed raggiungibile: controlla la connessione o i proxy.', { timeout: 7000 });
  }
}

/* ---------------------------------------------------------- rendering */

/** Il pulsante Aggiorna racconta da solo quando e come è arrivato l'ultimo carico. */
function updateSyncLabel() {
  const btn = $('#btn-refresh');
  if (!state.lastSync) { btn.title = 'Aggiorna (R)'; return; }
  const come = state.lastVia === 'cache' ? 'dalla cache del sito'
    : state.lastVia === 'misto' ? 'da cache e rete'
    : 'dai siti, in diretta';
  const eta = state.staticAge !== null ? ` · cache del sito: ${timeAgo(Date.now() - state.staticAge)}` : '';
  btn.title = `Aggiornato ${timeAgo(state.lastSync)} ${come}${eta} — clicca per riscaricare tutto (R)`;
}

function render() {
  renderChips();
  renderBoard();
  renderVault();
}

function renderChips() {
  const counts = {
    all: state.visible.filter((a) => !state.settings.hideRead || !state.read.has(a.id)).length,
    unread: state.visible.filter((a) => !state.read.has(a.id)).length,
    saved: state.visible.filter((a) => state.saved.has(a.id)).length
  };
  for (const [key, value] of Object.entries(counts)) {
    const el = $(`[data-count="${key}"]`);
    if (el) el.textContent = value ? value : '';
  }

  /* Categorie: primo livello di navigazione, nell'ordine in cui compaiono
     nell'elenco delle fonti così non ballano a ogni aggiornamento. */
  const catCounts = new Map();
  for (const a of state.visible) {
    const cat = a.category || 'Generale';
    catCounts.set(cat, (catCounts.get(cat) || 0) + 1);
  }
  const orderedCats = [];
  for (const feed of state.feeds) {
    const cat = feed.category || 'Generale';
    if (catCounts.has(cat) && !orderedCats.includes(cat)) orderedCats.push(cat);
  }
  for (const cat of catCounts.keys()) if (!orderedCats.includes(cat)) orderedCats.push(cat);

  $('#categories').innerHTML = orderedCats.length < 2 ? '' : [
    `<button class="chip chip--all ${state.category ? '' : 'is-active'}" data-category="">Tutto <span class="chip__count">${state.visible.length}</span></button>`,
    ...orderedCats.map((cat) => `
      <button class="chip ${state.category === cat ? 'is-active' : ''}" data-category="${esc(cat)}">
        ${esc(cat)}<span class="chip__count">${catCounts.get(cat)}</span>
      </button>`)
  ].join('');

  /* Fonti: secondo livello, ristretto alla categoria scelta. */
  const used = new Map();
  for (const a of state.visible) {
    if (state.category && (a.category || 'Generale') !== state.category) continue;
    used.set(a.feedId, (used.get(a.feedId) || 0) + 1);
  }

  const chips = state.feeds
    .filter((f) => used.has(f.id))
    .sort((a, b) => used.get(b.id) - used.get(a.id))
    .map((f) => `
      <button class="chip chip--source ${state.source === f.id ? 'is-active' : ''}" data-source="${esc(f.id)}">
        <span class="chip__dot" style="background:${esc(f.color || 'var(--accent)')}"></span>${esc(f.name)}
        <span class="chip__count">${used.get(f.id)}</span>
      </button>`).join('');

  /* Lingua: compare solo se nel carico ci sono davvero notizie in più lingue. */
  const langCounts = new Map();
  for (const a of state.visible) {
    if (state.category && (a.category || 'Generale') !== state.category) continue;
    const lang = a.lang || 'it';
    langCounts.set(lang, (langCounts.get(lang) || 0) + 1);
  }
  const LANG_NAMES = { it: 'Italiano', en: 'English' };
  if (state.lang && !langCounts.has(state.lang)) state.lang = null;

  $('#languages').innerHTML = langCounts.size < 2 ? '' : [
    `<button class="chip chip--lang ${state.lang ? '' : 'is-active'}" data-lang="">Tutte le lingue</button>`,
    ...[...langCounts.entries()].sort((a, b) => b[1] - a[1]).map(([lang, n]) => `
      <button class="chip chip--lang ${state.lang === lang ? 'is-active' : ''}" data-lang="${esc(lang)}">
        ${esc(LANG_NAMES[lang] || lang.toUpperCase())}<span class="chip__count">${n}</span>
      </button>`)
  ].join('');

  $('#sources-row').hidden = used.size < 2 && langCounts.size < 2;
  $('#sources').innerHTML = state.source
    ? `<button class="chip chip--source is-active" data-source="">Tutte le fonti ✕</button>` + chips
    : chips;

  const toggle = $('#btn-filter-toggle');
  toggle.setAttribute('aria-pressed', String(state.settings.filterEnabled));
  $('#filter-label').textContent = state.settings.filterEnabled ? 'Filtro attivo' : 'Filtro spento';
}

function renderBoard() {
  const list = currentList();
  const board = $('#board');
  const empty = $('#empty');

  if (!list.length) {
    board.innerHTML = '';
    empty.hidden = false;
    if (state.loading) {
      empty.innerHTML = emptyHTML({ title: 'Sto scaricando le notizie…', text: 'Un attimo: sto interrogando i feed che hai attivato.' });
    } else if (state.query) {
      empty.innerHTML = emptyHTML({ title: 'Nessun risultato', text: `Nessuna notizia visibile contiene «${state.query}». Potrebbe essere finita nella zona nascosta.`, action: { act: 'open-vault', label: 'Apri la zona nascosta' } });
    } else if (state.view === 'saved') {
      empty.innerHTML = emptyHTML({ title: 'Non hai ancora salvato niente', text: 'Il segnalibro sulle schede mette da parte gli articoli da leggere con calma.' });
    } else if (state.category || state.source || state.lang) {
      const where = state.source ? state.feeds.find((f) => f.id === state.source)?.name
        : state.category || (state.lang === 'en' ? 'English' : 'Italiano');
      empty.innerHTML = emptyHTML({
        title: 'Niente in questa sezione',
        text: `Nessuna notizia da mostrare in «${where}» con i filtri attuali.`,
        action: { act: 'clear-filters', label: 'Mostra tutte le categorie' }
      });
    } else if (state.hidden.length) {
      empty.innerHTML = emptyHTML({ title: 'Tutto filtrato', text: `Il dizionario ha nascosto ${state.hidden.length} notizie e non è rimasto altro. Puoi allentare le regole o dare un'occhiata alla zona nascosta.`, action: { act: 'open-vault', label: 'Apri la zona nascosta' } });
    } else {
      empty.innerHTML = emptyHTML({ title: 'Niente da leggere', text: 'Nessuna notizia dalle fonti attive. Prova ad aggiungerne qualcuna o ad aggiornare.', action: { act: 'open-feeds', label: 'Gestisci le fonti' } });
    }
    return;
  }

  empty.hidden = true;
  board.innerHTML = list.map((a) => cardHTML(a, state)).join('');
}

function renderVault() {
  const count = state.hidden.length;
  $('#edge-count').textContent = count;
  $('#edge-handle').hidden = !state.settings.showEdgeHandle || count === 0;

  const sub = $('#vault-sub');
  sub.textContent = count
    ? `${count} ${count === 1 ? 'notizia messa da parte' : 'notizie messe da parte'} in questo aggiornamento`
    : 'Nessuna notizia filtrata';

  const stats = termStats();
  const pills = Object.entries(stats)
    .sort((a, b) => b[1] - a[1])
    .map(([term, n]) => `<button class="stat-pill ${state.vaultTerm === term ? 'is-active' : ''}" data-term="${esc(term)}">${esc(term)} <b>${n}</b></button>`)
    .join('');
  $('#vault-stats').innerHTML = pills;

  const list = state.vaultTerm ? state.hidden.filter((a) => a._reason?.term === state.vaultTerm) : state.hidden;
  $('#vault-list').innerHTML = list.length
    ? list.map((a) => veiledHTML(a, state.compiled)).join('')
    : `<p class="hint" style="padding:24px;text-align:center">Qui finiscono le notizie che il dizionario mette da parte. Restano sempre recuperabili: nessuna viene cancellata.</p>`;
}

/* ------------------------------------------------------------ lettore */

const byId = (id) => state.articles.find((a) => a.id === id);

async function openReader(article) {
  markRead(article.id, true, { rerender: false });

  const dialog = $('#reader');
  const body = $('#reader-body');
  const hiddenNote = article._reason && !article._reason.manual
    ? `<div class="reader__note">${ICONS.shield} Questa notizia era nascosta perché contiene «${esc(article._reason.term)}».</div>`
    : '';

  body.innerHTML = `
    ${hiddenNote}
    <div class="reader__kicker">
      <b>${esc(article.feedName)}</b><span>·</span>
      <span>${esc(fullDate(article.publishedAt))}</span>
      ${article.author ? `<span>·</span><span>${esc(article.author)}</span>` : ''}
    </div>
    <h1>${esc(article.title)}</h1>
    ${article.summary ? `<p class="reader__lead">${esc(article.summary)}</p>` : ''}
    ${article.image ? `<figure class="reader__hero"><img src="${esc(article.image)}" alt="" referrerpolicy="no-referrer" onerror="this.closest('figure').remove()"></figure>` : ''}
    <div class="reader__content" id="reader-content">${sanitize(article.content || '', article.link)}</div>
    <div class="reader__fallback" id="reader-more">
      <span>Sto recuperando il testo completo…</span>
    </div>`;

  $('#reader-open').href = article.link || '#';
  $('#reader-save').textContent = state.saved.has(article.id) ? 'Salvata ✓' : 'Salva';
  dialog.dataset.id = article.id;
  if (!dialog.open) dialog.showModal();
  document.body.classList.add('is-locked');
  body.scrollTop = 0;
  renderBoard();

  const content = $('#reader-content');
  const more = $('#reader-more');
  const short = (content.textContent || '').trim().length < 900;

  if (!short) { more.remove(); return; }
  if (!article.link) { more.innerHTML = 'Questo feed non offre il testo completo.'; return; }

  const result = await fetchFullArticle(article.link, { customProxies: state.settings.customProxies });
  if (dialog.dataset.id !== article.id) return;      // l'utente ha già cambiato articolo
  if (result.ok) {
    content.innerHTML = result.html;
    more.remove();
  } else {
    more.innerHTML = `${esc(result.error)} <a class="btn btn--tiny" style="margin-left:8px" href="${esc(article.link)}" target="_blank" rel="noopener">Apri l'originale ↗</a>`;
  }
}

/* -------------------------------------------------------------- azioni */

function persistSets() {
  store.save('read', [...state.read].slice(-4000));
  store.save('saved', [...state.saved]);
  store.save('manualHidden', [...state.manualHidden].slice(-2000));
  store.save('allowed', [...state.allowed].slice(-2000));
}

function markRead(id, value, { rerender = true } = {}) {
  value ? state.read.add(id) : state.read.delete(id);
  persistSets();
  if (rerender) { renderBoard(); renderChips(); }
}

function toggleSave(id) {
  state.saved.has(id) ? state.saved.delete(id) : state.saved.add(id);
  persistSets();
  renderBoard();
  renderChips();
  return state.saved.has(id);
}

function hideManually(id) {
  const card = $(`.card[data-id="${CSS.escape(id)}"]`);
  card?.classList.add('is-leaving');
  state.manualHidden.add(id);
  state.allowed.delete(id);
  persistSets();
  setTimeout(() => { partition(); render(); }, 180);
  toast('Notizia spostata nella zona nascosta', {
    actionLabel: 'Annulla',
    onAction: () => { state.manualHidden.delete(id); persistSets(); partition(); render(); }
  });
}

function unhide(id) {
  state.manualHidden.delete(id);
  state.allowed.add(id);
  persistSets();
  partition();
  render();
  toast('Notizia riportata in home');
}

/* -------------------------------------------------------------- vault */

function openVault(open = true) {
  const vault = $('#vault');
  const scrim = $('#scrim');
  vault.classList.toggle('is-open', open);
  vault.setAttribute('aria-hidden', String(!open));
  $('#edge-handle').setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('vault-open', open);

  if (open) {
    scrim.hidden = false;
    requestAnimationFrame(() => scrim.classList.add('is-on'));
    renderVault();
    $('#vault-close').focus();
  } else {
    scrim.classList.remove('is-on');
    setTimeout(() => { scrim.hidden = true; }, 250);
    state.vaultTerm = null;
  }
}

/* --------------------------------------------------------- impostazioni */

function openSettings(tab = 'dictionary') {
  const dialog = $('#settings');
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === tab));
  $$('.panel').forEach((p) => p.classList.toggle('is-active', p.dataset.panel === tab));
  renderSettings();
  if (!dialog.open) dialog.showModal();
  document.body.classList.add('is-locked');
}

function renderSettings() {
  $('[data-panel="dictionary"]').innerHTML = dictionaryPanel({
    dictionary: state.dictionary, whitelist: state.whitelist, stats: termStats()
  });
  $('[data-panel="feeds"]').innerHTML = feedsPanel({ feeds: state.feeds, problems: state.problems });
  $('[data-panel="look"]').innerHTML = lookPanel({ settings: state.settings });
  $('[data-panel="data"]').innerHTML = dataPanel({
    settings: state.settings,
    stats: { total: state.articles.length, hidden: state.hidden.length, saved: state.saved.size }
  });
}

function saveDictionary() {
  store.save('dictionary', state.dictionary);
  store.save('whitelist', state.whitelist);
  recompile();
  partition();
  render();
  renderSettings();
}

function saveSetting(key, value) {
  state.settings[key] = value;
  store.save('settings', state.settings);
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || `f${Date.now()}`;

/* -------------------------------------------------------------- eventi */

function wireEvents() {
  /* --- barra superiore --- */
  $('#search').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderBoard();
  });

  $('#btn-refresh').addEventListener('click', () => refresh({ preferLive: true }));
  $('#btn-theme').addEventListener('click', () => {
    const order = ['light', 'dark'];
    const current = document.documentElement.dataset.theme;
    saveSetting('theme', order[(order.indexOf(current) + 1) % order.length]);
    applyTheme();
  });
  $('#btn-layout').addEventListener('click', () => {
    const order = ['grid', 'list', 'compact'];
    saveSetting('layout', order[(order.indexOf(state.settings.layout) + 1) % order.length]);
    applyLayout();
  });
  $('#btn-settings').addEventListener('click', () => openSettings());

  $('#btn-filter-toggle').addEventListener('click', () => {
    saveSetting('filterEnabled', !state.settings.filterEnabled);
    partition();
    render();
    toast(state.settings.filterEnabled ? 'Dizionario riattivato' : 'Dizionario spento: vedi tutto');
  });

  $('#views').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-view]');
    if (!chip) return;
    state.view = chip.dataset.view;
    $$('.chip--view').forEach((c) => c.classList.toggle('is-active', c === chip));
    renderBoard();
  });

  $('#categories').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-category]');
    if (!chip) return;
    state.category = chip.dataset.category || null;
    // Se la fonte scelta non appartiene più alla categoria, la lascio cadere.
    if (state.source) {
      const feed = state.feeds.find((f) => f.id === state.source);
      if (state.category && (feed?.category || 'Generale') !== state.category) state.source = null;
    }
    renderChips();
    renderBoard();
  });

  $('#languages').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-lang]');
    if (!chip) return;
    state.lang = chip.dataset.lang || null;
    renderChips();
    renderBoard();
  });

  $('#sources').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-source]');
    if (!chip) return;
    state.source = chip.dataset.source || null;
    renderChips();
    renderBoard();
  });

  /* --- schede --- */
  $('#board').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    const action = e.target.closest('[data-act]');
    if (!card || !action) return;
    const article = byId(card.dataset.id);
    if (!article) return;

    switch (action.dataset.act) {
      case 'open':
        if (state.settings.openInApp) openReader(article);
        else { window.open(article.link, '_blank', 'noopener'); markRead(article.id, true); }
        break;
      case 'save': toggleSave(article.id); break;
      case 'read': markRead(article.id, !state.read.has(article.id)); break;
      case 'hide': hideManually(article.id); break;
      case 'external': markRead(article.id, true); break;
    }
  });

  $('#empty').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'open-vault') openVault(true);
    if (act === 'open-feeds') openSettings('feeds');
    if (act === 'clear-filters') {
      state.category = null;
      state.source = null;
      state.lang = null;
      renderChips();
      renderBoard();
    }
  });

  /* --- zona nascosta --- */
  $('#edge-handle').addEventListener('click', () => openVault(true));
  $('#vault-close').addEventListener('click', () => openVault(false));
  $('#scrim').addEventListener('click', () => openVault(false));

  $('#vault-stats').addEventListener('click', (e) => {
    const pill = e.target.closest('[data-term]');
    if (!pill) return;
    state.vaultTerm = state.vaultTerm === pill.dataset.term ? null : pill.dataset.term;
    renderVault();
  });

  $('#vault-list').addEventListener('click', (e) => {
    const row = e.target.closest('.veiled');
    const action = e.target.closest('[data-act]');
    if (!row) return;
    const article = byId(row.dataset.id);
    if (!article) return;

    if (!action) { row.classList.toggle('is-revealed'); return; }

    switch (action.dataset.act) {
      case 'open':
        state.allowed.add(article.id);
        persistSets();
        openVault(false);
        openReader(article);
        partition();
        render();
        break;
      case 'unhide': unhide(article.id); break;
      case 'drop-term': {
        const term = article._reason?.term;
        const removed = state.dictionary.filter((d) => d.term === term);
        state.dictionary = state.dictionary.filter((d) => d.term !== term);
        saveDictionary();
        toast(`«${term}» rimossa dal dizionario`, {
          actionLabel: 'Annulla',
          onAction: () => { state.dictionary.push(...removed); saveDictionary(); }
        });
        break;
      }
    }
  });

  /* --- lettore --- */
  const reader = $('#reader');
  $('#reader-close').addEventListener('click', () => reader.close());
  reader.addEventListener('close', () => {
    document.body.classList.remove('is-locked');
    delete reader.dataset.id;
    renderChips();
  });
  reader.addEventListener('click', (e) => {
    // clic sul backdrop: il dialog occupa tutto, quindi confronto le coordinate
    if (e.target !== reader) return;
    const r = reader.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) reader.close();
  });
  $('#reader-save').addEventListener('click', () => {
    const id = reader.dataset.id;
    if (!id) return;
    $('#reader-save').textContent = toggleSave(id) ? 'Salvata ✓' : 'Salva';
  });
  $('#reader-share').addEventListener('click', async () => {
    const article = byId(reader.dataset.id);
    if (!article) return;
    try {
      if (navigator.share) await navigator.share({ title: article.title, url: article.link });
      else { await navigator.clipboard.writeText(article.link); toast('Link copiato'); }
    } catch {}
  });

  /* --- impostazioni --- */
  const settings = $('#settings');
  $('#settings-close').addEventListener('click', () => settings.close());
  settings.addEventListener('close', () => document.body.classList.remove('is-locked'));
  $$('.tab').forEach((tab) => tab.addEventListener('click', () => openSettings(tab.dataset.tab)));

  settings.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const kind = form.dataset.act;

    if (kind === 'add-term') {
      const term = form.term.value.trim();
      if (!term) return;
      if (!compileTerm(term)) return toast('Termine non valido');
      if (state.dictionary.some((d) => d.term.toLowerCase() === term.toLowerCase())) return toast('C’è già');
      state.dictionary.unshift({ term, scope: state.settings.defaultScope, mode: 'smart', enabled: true, category: 'Personali' });
      form.reset();
      saveDictionary();
      toast(`«${term}» aggiunta al dizionario`);
    }

    if (kind === 'add-safe') {
      const term = form.term.value.trim();
      if (!term) return;
      state.whitelist.unshift({ term, mode: 'smart', enabled: true });
      form.reset();
      saveDictionary();
    }

    if (kind === 'add-feed') {
      const url = form.url.value.trim();
      const name = form.name.value.trim() || new URL(url).hostname.replace(/^www\./, '');
      if (state.feeds.some((f) => f.url === url)) return toast('Questa fonte c’è già');
      const category = form.category.value.trim() || 'Personali';
      state.feeds.push({ id: slug(name), name, url, category, enabled: true, color: '#6b7280' });
      store.save('feeds', state.feeds);
      form.reset();
      renderSettings();
      refresh();
    }
  });

  settings.addEventListener('change', (e) => {
    const el = e.target;

    /* interruttori e menù delle preferenze */
    const key = el.dataset.setting;
    if (key) {
      if (key === 'customProxy') {
        saveSetting('customProxies', el.value.trim() ? [el.value.trim()] : []);
      } else {
        const value = el.type === 'checkbox' ? el.checked : el.value;
        saveSetting(key, key === 'autoRefreshMinutes' ? +value : value);
        if (key === 'theme') applyTheme();
        if (key === 'layout' || key === 'showEdgeHandle') applyLayout();
        if (key === 'hideRead') { renderBoard(); renderChips(); }
      }
      renderVault();
      return;
    }

    /* dizionario */
    const term = el.closest('.term');
    if (term) {
      const index = +term.dataset.index;
      const act = el.dataset.act;
      if (act === 'toggle-term') state.dictionary[index].enabled = el.checked;
      if (act === 'scope-term') state.dictionary[index].scope = el.value;
      if (act === 'mode-term') state.dictionary[index].mode = el.value;
      saveDictionary();
      return;
    }

    /* fonti */
    const feedRow = el.closest('.feed-row');
    if (!feedRow) return;
    const feed = state.feeds[+feedRow.dataset.index];

    if (el.dataset.act === 'toggle-feed') {
      feed.enabled = el.checked;
      store.save('feeds', state.feeds);
      refresh();
    }

    if (el.dataset.act === 'cat-feed') {
      const category = el.value.trim() || 'Generale';
      feed.category = category;
      // Gli articoli già scaricati portano con sé la vecchia categoria: la aggiorno
      // subito, senza aspettare il prossimo scarico.
      for (const a of state.articles) if (a.feedId === feed.id) a.category = category;
      store.save('feeds', state.feeds);
      store.save('feedCache', { at: state.lastSync || Date.now(), articles: state.articles.slice(0, 400) });
      if (state.category && !state.articles.some((a) => a.category === state.category)) state.category = null;
      render();
      renderSettings();
    }
  });

  settings.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.tagName === 'INPUT' || btn.tagName === 'SELECT') return;

    switch (btn.dataset.act) {
      case 'remove-term': {
        const index = +btn.closest('.term').dataset.index;
        const [removed] = state.dictionary.splice(index, 1);
        saveDictionary();
        toast(`«${removed.term}» eliminata`, { actionLabel: 'Annulla', onAction: () => { state.dictionary.splice(index, 0, removed); saveDictionary(); } });
        break;
      }
      case 'remove-safe': {
        const index = +btn.closest('.term').dataset.index;
        state.whitelist.splice(index, 1);
        saveDictionary();
        break;
      }
      case 'remove-feed': {
        const index = +btn.closest('.feed-row').dataset.index;
        const [removed] = state.feeds.splice(index, 1);
        store.save('feeds', state.feeds);
        renderSettings();
        toast(`«${removed.name}» rimossa`, { actionLabel: 'Annulla', onAction: () => { state.feeds.splice(index, 0, removed); store.save('feeds', state.feeds); renderSettings(); refresh(); } });
        refresh();
        break;
      }
      case 'restore-dictionary': {
        const custom = state.dictionary.filter((d) => !d.builtin);
        state.dictionary = [...custom, ...structuredClone(DEFAULT_DICTIONARY)];
        saveDictionary();
        toast('Dizionario di partenza ripristinato');
        break;
      }
      case 'restore-feeds': {
        state.feeds = structuredClone(DEFAULT_FEEDS);
        store.save('feeds', state.feeds);
        renderSettings();
        refresh();
        break;
      }
      case 'export': {
        const payload = await store.exportAll();
        delete payload.data.feedCache;
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `inews-profilo-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        break;
      }
      case 'import': {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.onchange = async () => {
          try {
            const payload = JSON.parse(await input.files[0].text());
            await store.importAll(payload);
            toast('Profilo importato, ricarico…');
            setTimeout(() => location.reload(), 900);
          } catch (err) {
            toast('File non valido');
          }
        };
        input.click();
        break;
      }
      case 'wipe': {
        if (!confirm('Cancello dizionario, fonti, salvate e preferenze. Procedo?')) return;
        await store.clearAll();
        location.reload();
        break;
      }
    }
  });

  /* --- tastiera --- */
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);

    if (e.key === 'Escape') {
      if ($('#vault').classList.contains('is-open')) openVault(false);
      return;
    }
    if (typing) return;

    switch (e.key.toLowerCase()) {
      case '/': e.preventDefault(); $('#search').focus(); break;
      case 'r': refresh({ preferLive: true }); break;
      case 't': $('#btn-theme').click(); break;
      case 'v': $('#btn-layout').click(); break;
      case 's': e.preventDefault(); openSettings(); break;
      case 'f': $('#btn-filter-toggle').click(); break;
      case 'h': openVault(!$('#vault').classList.contains('is-open')); break;
    }
  });

  /* --- gesto: trascinare la tendina verso il basso per chiuderla (mobile) --- */
  let startY = null;
  const vault = $('#vault');
  vault.addEventListener('touchstart', (e) => {
    startY = $('#vault-list').scrollTop === 0 ? e.touches[0].clientY : null;
  }, { passive: true });
  vault.addEventListener('touchmove', (e) => {
    if (startY === null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0) vault.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  vault.addEventListener('touchend', (e) => {
    if (startY === null) return;
    const dy = e.changedTouches[0].clientY - startY;
    vault.style.transform = '';
    if (dy > 110) openVault(false);
    startY = null;
  });
}

init();
