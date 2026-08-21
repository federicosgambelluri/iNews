/** Contenuto dei quattro pannelli delle impostazioni. */

import { esc, ICONS } from './ui.js';
import { DEFAULT_DICTIONARY, DEFAULT_FEEDS } from './config.js';

const switchHTML = (key, on) =>
  `<label class="switch"><input type="checkbox" data-setting="${esc(key)}" ${on ? 'checked' : ''}><span></span></label>`;

const field = (title, desc, control) => `
  <div class="field">
    <div class="field__text"><b>${esc(title)}</b><span>${desc}</span></div>
    ${control}
  </div>`;

/* ------------------------------------------------------------ dizionario */

export function dictionaryPanel({ dictionary, whitelist, stats }) {
  const byCategory = new Map();
  dictionary.forEach((entry, index) => {
    const cat = entry.category || 'Personali';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push({ entry, index });
  });

  const groups = [...byCategory.entries()].map(([cat, items]) => `
    <div class="group-title">${esc(cat)} <span style="text-transform:none;letter-spacing:0;font-weight:500">${items.length}</span></div>
    ${items.map(({ entry, index }) => `
      <div class="term ${entry.enabled === false ? 'is-off' : ''}" data-index="${index}">
        <label class="switch"><input type="checkbox" data-act="toggle-term" ${entry.enabled === false ? '' : 'checked'}><span></span></label>
        <span class="term__word">${esc(entry.term)}
          <small>${stats[entry.term] ? `ha nascosto ${stats[entry.term]} notizie` : 'nessuna corrispondenza al momento'}</small>
        </span>
        <select data-act="scope-term" title="Dove cercare la parola: basta una corrispondenza in uno dei punti indicati">
          <option value="both" ${!entry.scope || entry.scope === 'both' ? 'selected' : ''}>titolo o testo</option>
          <option value="title" ${entry.scope === 'title' ? 'selected' : ''}>solo titolo</option>
          <option value="description" ${entry.scope === 'description' ? 'selected' : ''}>solo testo</option>
        </select>
        <select data-act="mode-term" title="Quanto è rigida la corrispondenza">
          <option value="smart" ${entry.mode !== 'exact' ? 'selected' : ''}>flessibile</option>
          <option value="exact" ${entry.mode === 'exact' ? 'selected' : ''}>esatta</option>
        </select>
        <button class="act" data-act="remove-term" style="opacity:1" title="Elimina">${ICONS.trash}</button>
      </div>`).join('')}
  `).join('');

  return `
    <form class="adder" data-act="add-term">
      <input name="term" placeholder="Aggiungi una parola o una coppia di parole…" autocomplete="off" required>
      <button class="btn btn--primary" type="submit">${ICONS.plus} Aggiungi</button>
    </form>
    <p class="hint">
      Ogni voce dice <b>dove</b> cercare: <i>titolo o testo</i> (l\u2019impostazione di partenza)
      nasconde la notizia se la parola compare anche in uno solo dei due, <i>solo titolo</i>
      ignora la descrizione, <i>solo testo</i> ignora il titolo. La corrispondenza
      <b>flessibile</b> copre da sola plurali e femminili (<code>immigrato</code> intercetta anche
      <i>immigrata</i>, <i>immigrati</i>); usa <code>*</code> per allargare ancora
      (<code>immigrat*</code> prende pure <i>immigrazione</i>) oppure la modalità <b>esatta</b> per
      evitare falsi positivi. Una coppia come <code>emergenza migranti</code> scatta solo se le due
      parole sono vicine, nell'ordine scritto.
    </p>
    ${groups}
    <div class="group-title">Salvagente</div>
    <p class="hint">Se una di queste parole compare, la notizia resta visibile anche quando il dizionario la bloccherebbe. Utile per non perdere gli argomenti che ti interessano davvero.</p>
    <form class="adder" data-act="add-safe">
      <input name="term" placeholder="Es. il nome della tua città, un tema che segui…" autocomplete="off" required>
      <button class="btn" type="submit">Aggiungi</button>
    </form>
    ${whitelist.map((entry, index) => `
      <div class="term" data-index="${index}">
        <span class="term__word" style="color:var(--good)">${esc(entry.term)}</span>
        <button class="act" data-act="remove-safe" style="opacity:1" title="Elimina">${ICONS.trash}</button>
      </div>`).join('')}
    <div class="field" style="margin-top:22px">
      <div class="field__text"><b>Ripristina il dizionario di partenza</b><span>Rimette le ${DEFAULT_DICTIONARY.length} voci iniziali, tenendo quelle che hai aggiunto tu.</span></div>
      <button class="btn" data-act="restore-dictionary">Ripristina</button>
    </div>`;
}

/* ----------------------------------------------------------------- fonti */

export function feedsPanel({ feeds, problems }) {
  const categories = [...new Set(feeds.map((f) => f.category || 'Generale'))];
  const datalist = `<datalist id="cat-list">${categories.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`;

  const row = (feed, index) => {
    const issue = problems.find((p) => p.feed === feed.name);
    return `
    <div class="feed-row" data-index="${index}">
      <label class="switch"><input type="checkbox" data-act="toggle-feed" ${feed.enabled !== false ? 'checked' : ''}><span></span></label>
      <div class="feed-row__info">
        <b><i style="background:${esc(feed.color || 'var(--accent)')}"></i>${esc(feed.name)}
          ${issue ? '<span style="color:var(--danger);font-size:11px;font-weight:600">non raggiungibile</span>' : ''}
        </b>
        <span>${esc(feed.url)}</span>
      </div>
      <input class="feed-row__cat" list="cat-list" data-act="cat-feed" value="${esc(feed.category || 'Generale')}"
             title="Categoria: raggruppa le fonti nella barra in alto" aria-label="Categoria di ${esc(feed.name)}">
      <button class="act" data-act="remove-feed" style="opacity:1" title="Elimina">${ICONS.trash}</button>
    </div>`;
  };

  // Raggruppo per categoria mantenendo l'indice originale, che serve per le modifiche.
  const groups = categories.map((cat) => {
    const rows = feeds.map((feed, index) => ({ feed, index })).filter(({ feed }) => (feed.category || 'Generale') === cat);
    const active = rows.filter(({ feed }) => feed.enabled !== false).length;
    return `
      <div class="group-title">${esc(cat)}
        <span style="text-transform:none;letter-spacing:0;font-weight:500">${active} di ${rows.length} attive</span>
      </div>
      ${rows.map(({ feed, index }) => row(feed, index)).join('')}`;
  }).join('');

  return `
    ${datalist}
    <form class="adder" data-act="add-feed">
      <input name="url" type="url" placeholder="https://sito.it/feed/" required autocomplete="off" style="min-width:180px">
      <input name="name" placeholder="Nome" style="flex:0 0 120px">
      <input name="category" list="cat-list" placeholder="Categoria" style="flex:0 0 120px">
      <button class="btn btn--primary" type="submit">Aggiungi</button>
    </form>
    <p class="hint">
      Funziona con qualunque feed RSS, Atom o RDF. Molti siti lo espongono su <code>/feed</code>,
      <code>/rss</code> o <code>/feed.xml</code>; i feed per argomento sono di solito più mirati della home.
      La <b>categoria</b> decide sotto quale scheda finisce la fonte nella barra in alto: scrivine una
      esistente per aggiungerla lì, o una nuova per crearne un\u2019altra.
    </p>
    ${groups}
    <div class="field" style="margin-top:18px">
      <div class="field__text"><b>Ripristina l\u2019elenco iniziale</b><span>Le ${DEFAULT_FEEDS.length} testate di partenza.</span></div>
      <button class="btn" data-act="restore-feeds">Ripristina</button>
    </div>`;
}

/* --------------------------------------------------------------- aspetto */

export function lookPanel({ settings }) {
  return `
    ${field('Tema', 'Chiaro, scuro o come il sistema operativo.', `
      <select data-setting="theme">
        <option value="auto" ${settings.theme === 'auto' ? 'selected' : ''}>Automatico</option>
        <option value="light" ${settings.theme === 'light' ? 'selected' : ''}>Chiaro</option>
        <option value="dark" ${settings.theme === 'dark' ? 'selected' : ''}>Scuro</option>
      </select>`)}
    ${field('Disposizione', 'Griglia con le immagini, elenco, oppure solo titoli.', `
      <select data-setting="layout">
        <option value="grid" ${settings.layout === 'grid' ? 'selected' : ''}>Griglia</option>
        <option value="list" ${settings.layout === 'list' ? 'selected' : ''}>Elenco</option>
        <option value="compact" ${settings.layout === 'compact' ? 'selected' : ''}>Compatta</option>
      </select>`)}
    ${field('Apri gli articoli qui dentro', 'Il lettore interno mostra il testo senza pubblicità né banner dei cookie. Da spento, apre direttamente il sito.', switchHTML('openInApp', settings.openInApp))}
    ${field('Nascondi le notizie già lette', 'Le trovi comunque nella scheda «Salvate» o riaccendendo questa voce.', switchHTML('hideRead', settings.hideRead))}
    ${field('Linguetta laterale', 'La maniglia sul bordo che apre la zona nascosta. Da spenta, resta il conteggio nelle impostazioni.', switchHTML('showEdgeHandle', settings.showEdgeHandle))}
    ${field('Aggiornamento automatico', 'Ogni quanto ricontrollare i feed mentre la scheda è aperta.', `
      <select data-setting="autoRefreshMinutes">
        <option value="0" ${+settings.autoRefreshMinutes === 0 ? 'selected' : ''}>Mai</option>
        <option value="15" ${+settings.autoRefreshMinutes === 15 ? 'selected' : ''}>15 minuti</option>
        <option value="30" ${+settings.autoRefreshMinutes === 30 ? 'selected' : ''}>30 minuti</option>
        <option value="60" ${+settings.autoRefreshMinutes === 60 ? 'selected' : ''}>1 ora</option>
      </select>`)}
    ${field('Come scaricare i feed', 'La cache statica è il file generato ogni ora su GitHub: veloce e senza proxy. «In diretta» salta la cache e interroga i siti al volo.', `
      <select data-setting="sourceStrategy">
        <option value="auto" ${settings.sourceStrategy === 'auto' ? 'selected' : ''}>Cache, poi diretta</option>
        <option value="static" ${settings.sourceStrategy === 'static' ? 'selected' : ''}>Solo cache</option>
        <option value="live" ${settings.sourceStrategy === 'live' ? 'selected' : ''}>Solo diretta</option>
      </select>`)}`;
}

/* ------------------------------------------------------------------ dati */

export function dataPanel({ stats, settings }) {
  return `
    <p class="hint">
      Tutto quello che vedi — dizionario, fonti, notizie salvate, preferenze — sta solo nel tuo
      browser. Nessun account, nessun server, nessuna statistica su di te. Il rovescio della medaglia
      è che i dati non seguono il dispositivo: per spostarli, esportali in un file e reimportali altrove.
    </p>
    ${field('Esporta il tuo profilo', 'Un file JSON con dizionario, fonti e preferenze.', '<button class="btn" data-act="export">Scarica</button>')}
    ${field('Importa da file', 'Sostituisce le impostazioni attuali con quelle del file.', '<button class="btn" data-act="import">Scegli file</button>')}
    <div class="group-title">Numeri</div>
    ${field('Notizie caricate', 'Nella sessione corrente.', `<b>${stats.total}</b>`)}
    ${field('Notizie nascoste', 'Dal dizionario attivo.', `<b style="color:var(--hidden)">${stats.hidden}</b>`)}
    ${field('Salvate', 'Da leggere con calma.', `<b>${stats.saved}</b>`)}
    <div class="group-title">Avanzate</div>
    ${field('Proxy personalizzato', 'Serve solo se i proxy pubblici sono bloccati. Usa <code>{url}</code> come segnaposto.', `<input type="text" data-setting="customProxy" placeholder="https://mio-proxy/?u={url}" value="${esc((settings.customProxies || [])[0] || '')}">`)}
    ${field('Cancella tutto', 'Riporta iNews come appena installato.', '<button class="btn btn--danger" data-act="wipe">Azzera</button>')}`;
}
