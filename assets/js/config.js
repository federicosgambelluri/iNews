/**
 * iNews — configurazione di base.
 * Tutto ciò che è "dato iniziale" vive qui, così è facile da rivedere
 * senza toccare la logica dell'applicazione.
 */

export const APP = {
  name: 'iNews',
  version: '1.0.0',
  storagePrefix: 'inews:v1:',
  // Cache dei feed scaricati (in localStorage) prima di riscaricare.
  feedCacheMinutes: 10,
  // Numero massimo di articoli tenuti in memoria per feed.
  maxItemsPerFeed: 60
};

/**
 * Proxy CORS usati in cascata: il primo che risponde vince.
 * I feed RSS non espongono header CORS, quindi il browser da solo non può
 * leggerli. Se un proxy muore, basta aggiungerne un altro qui (o dalle
 * Impostazioni → Avanzate).
 */
export const CORS_PROXIES = [
  { name: 'allorigins', build: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` },
  { name: 'codetabs',   build: (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}` },
  { name: 'corsproxy',  build: (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}` },
  { name: 'thingproxy', build: (url) => `https://thingproxy.freeboard.io/fetch/${url}` },
  // Ultima spiaggia: non è un proxy ma un convertitore, restituisce JSON già
  // normalizzato. Ha un limite di chiamate, per questo sta in fondo alla fila.
  { name: 'rss2json', json: true, build: (url) => `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}&count=40` }
];

/** Oltre questa età la cache statica è considerata vecchia e si passa alla rete. */
export const STATIC_CACHE_MAX_AGE_MIN = 75;

/** Cache statica generata da GitHub Actions (vedi tools/fetch-feeds.mjs). */
export const STATIC_CACHE_URL = './data/news.json';

export const DEFAULT_FEEDS = [
  { id: 'ilpost-italia', name: 'Il Post · Italia',  url: 'https://www.ilpost.it/italia/feed/',                   category: 'Generale',   enabled: true,  color: '#e8543f' },
  { id: 'ilpost-mondo',  name: 'Il Post · Mondo',   url: 'https://www.ilpost.it/mondo/feed/',                    category: 'Esteri',     enabled: true,  color: '#e8543f' },
  { id: 'ansa',          name: 'ANSA',              url: 'https://www.ansa.it/sito/ansait_rss.xml',              category: 'Generale',   enabled: true,  color: '#2d6cdf' },
  { id: 'repubblica',    name: 'Repubblica',        url: 'https://www.repubblica.it/rss/homepage/rss2.0.xml',    category: 'Generale',   enabled: true,  color: '#c8332b' },
  { id: 'wired-it',      name: 'Wired Italia',      url: 'https://www.wired.it/feed/rss',                        category: 'Tech',       enabled: true,  color: '#111827' },
  { id: 'dday',          name: 'DDAY.it',           url: 'https://www.dday.it/rss',                              category: 'Tech',       enabled: false, color: '#0ea5e9' },
  { id: 'hdblog',        name: 'HDblog',            url: 'https://www.hdblog.it/feed/',                          category: 'Tech',       enabled: false, color: '#f97316' },
  { id: 'sole24',        name: 'Il Sole 24 Ore',    url: 'https://www.ilsole24ore.com/rss/economia.xml',         category: 'Economia',   enabled: false, color: '#16a34a' },
  { id: 'internazionale',name: 'Internazionale',    url: 'https://www.internazionale.it/sitemaps/rss.xml',       category: 'Esteri',     enabled: false, color: '#7c3aed' },
  { id: 'gazzetta',      name: 'Gazzetta',          url: 'https://www.gazzetta.it/rss/home.xml',                 category: 'Sport',      enabled: false, color: '#ec4899' },
  { id: 'focus',         name: 'Focus',             url: 'https://www.focus.it/rss/scienza.rss',                 category: 'Scienza',    enabled: false, color: '#0891b2' },
  { id: 'bbc-world',     name: 'BBC World',         url: 'https://feeds.bbci.co.uk/news/world/rss.xml',          category: 'Esteri',     enabled: false, color: '#b91c1c', lang: 'en' },
  { id: 'hn',            name: 'Hacker News',       url: 'https://hnrss.org/frontpage',                          category: 'Tech',       enabled: false, color: '#f59e0b', lang: 'en' }
];

/**
 * Alcuni feed marcano ogni articolo con uno o più <category>, ma ognuno usa il
 * suo vocabolario ("Calcio", "Tennis", "Bordo ring"…). Questa tabella riporta
 * le etichette più comuni a una decina di sezioni riconoscibili; quelle che non
 * compaiono qui vengono ignorate e l'articolo eredita la categoria della fonte.
 */
export const CATEGORY_ALIASES = {
  politica: 'Politica', governo: 'Politica', elezioni: 'Politica', politics: 'Politica',
  cronaca: 'Cronaca', giustizia: 'Cronaca',
  esteri: 'Esteri', mondo: 'Esteri', world: 'Esteri', europa: 'Esteri', internazionale: 'Esteri',
  economia: 'Economia', finanza: 'Economia', business: 'Economia', lavoro: 'Economia',
  mercati: 'Economia', imprese: 'Economia', economy: 'Economia',
  tecnologia: 'Tech', tech: 'Tech', technology: 'Tech', internet: 'Tech', smartphone: 'Tech',
  apple: 'Tech', android: 'Tech', google: 'Tech', microsoft: 'Tech', amazon: 'Tech',
  gadget: 'Tech', games: 'Tech', videogiochi: 'Tech', security: 'Tech', sicurezza: 'Tech',
  software: 'Tech', hardware: 'Tech', domotica: 'Tech', telefonia: 'Tech',
  scienza: 'Scienza', science: 'Scienza', spazio: 'Scienza', ricerca: 'Scienza',
  salute: 'Salute', medicina: 'Salute', health: 'Salute', benessere: 'Salute',
  ambiente: 'Ambiente', clima: 'Ambiente', energia: 'Ambiente', environment: 'Ambiente',
  cultura: 'Cultura', spettacoli: 'Cultura', cinema: 'Cultura', musica: 'Cultura',
  libri: 'Cultura', arte: 'Cultura', tv: 'Cultura', culture: 'Cultura', moda: 'Cultura',
  sport: 'Sport', calcio: 'Sport', tennis: 'Sport', volley: 'Sport', basket: 'Sport',
  ciclismo: 'Sport', atletica: 'Sport', formula: 'Sport', motogp: 'Sport', coppe: 'Sport',
  auto: 'Motori', motori: 'Motori', moto: 'Motori',
  scuola: 'Scuola', universita: 'Scuola'
};

/**
 * Dizionario base: 50 voci pensate per smorzare rage-bait, cronaca nera
 * gratuita e titoli acchiappa-click. Sono solo un punto di partenza:
 * l'utente può disattivarle una per una, modificarle o cancellarle.
 *
 * scope:  'title' = solo titolo | 'both' = titolo + descrizione
 * mode:   'smart' = tollera plurali/femminili italiani (immigrato → immigrat[aeio])
 *         'exact' = parola esatta | il carattere * funziona come jolly
 */
const T = (term, opts = {}) => ({
  term,
  scope: opts.scope || 'both',
  mode: opts.mode || 'smart',
  enabled: opts.enabled !== false,
  category: opts.category || 'Generale',
  builtin: true
});

export const DEFAULT_DICTIONARY = [
  // — Polarizzazione / rage-bait —
  T('immigrato',            { category: 'Polarizzazione' }),
  T('clandestino',          { category: 'Polarizzazione' }),
  T('invasione',            { category: 'Polarizzazione' }),
  T('emergenza migranti',   { category: 'Polarizzazione' }),
  T('baby gang',            { category: 'Polarizzazione' }),
  T('degrado',              { category: 'Polarizzazione' }),
  T('vergogna',             { category: 'Polarizzazione', scope: 'title' }),
  T('scandalo',             { category: 'Polarizzazione', scope: 'title' }),
  T('inaccettabile',        { category: 'Polarizzazione', scope: 'title' }),
  T('delirio',              { category: 'Polarizzazione', scope: 'title' }),
  T('follia',               { category: 'Polarizzazione', scope: 'title' }),
  T('bufera',               { category: 'Polarizzazione', scope: 'title' }),

  // — Cronaca nera —
  T('omicidio',             { category: 'Cronaca nera' }),
  T('femminicidio',         { category: 'Cronaca nera' }),
  T('stupro',               { category: 'Cronaca nera' }),
  T('violenza sessuale',    { category: 'Cronaca nera' }),
  T('pedofilo',             { category: 'Cronaca nera' }),
  T('suicidio',             { category: 'Cronaca nera' }),
  T('cadavere',             { category: 'Cronaca nera' }),
  T('strage',               { category: 'Cronaca nera' }),
  T('massacro',             { category: 'Cronaca nera' }),
  T('accoltellato',         { category: 'Cronaca nera' }),
  T('morto sul colpo',      { category: 'Cronaca nera' }),
  T('incidente mortale',    { category: 'Cronaca nera' }),

  // — Paura e allarmismo —
  T('orrore',               { category: 'Allarmismo' }),
  T('agghiacciante',        { category: 'Allarmismo' }),
  T('raccapricciante',      { category: 'Allarmismo' }),
  T('sconvolgente',         { category: 'Allarmismo' }),
  T('choc',                 { category: 'Allarmismo', mode: 'exact' }),
  T('shock',                { category: 'Allarmismo', mode: 'exact' }),
  T('terrore',              { category: 'Allarmismo' }),
  T('panico',               { category: 'Allarmismo' }),
  T('incubo',               { category: 'Allarmismo', scope: 'title' }),
  T('catastrofe',           { category: 'Allarmismo' }),
  T('apocalisse',           { category: 'Allarmismo' }),
  T('allarme',              { category: 'Allarmismo', scope: 'title' }),
  T('allerta',              { category: 'Allarmismo', scope: 'title', enabled: false }),
  T('tragedia',             { category: 'Allarmismo' }),
  T('dramma',               { category: 'Allarmismo', scope: 'title' }),

  // — Guerra —
  T('bombardamento',        { category: 'Guerra' }),
  T('attentato',            { category: 'Guerra' }),
  T('terza guerra mondiale',{ category: 'Guerra' }),
  T('missile',              { category: 'Guerra', enabled: false }),

  // — Salute —
  T('tumore',               { category: 'Salute' }),
  T('cancro',               { category: 'Salute' }),
  T('pandemia',             { category: 'Salute', enabled: false }),

  // — Clickbait puro —
  T('non ci crederete',     { category: 'Clickbait' }),
  T('resterete senza parole',{ category: 'Clickbait' }),
  T('il motivo ti sorprender*', { category: 'Clickbait' }),
  T('non indovinerai mai',  { category: 'Clickbait' }),
  T('ecco cosa è successo', { category: 'Clickbait' })
];

/** Parole "salvagente": se compaiono, la notizia resta visibile comunque. */
export const DEFAULT_WHITELIST = [];

export const DEFAULT_SETTINGS = {
  theme: 'auto',              // auto | light | dark
  layout: 'grid',             // grid | list | compact
  defaultScope: 'both',       // ambito usato per le nuove parole
  filterEnabled: true,
  hideRead: false,
  autoRefreshMinutes: 30,
  showHiddenBadge: true,
  showEdgeHandle: true,       // la "linguetta" laterale stile buddybank
  openInApp: true,            // lettore interno invece del sito esterno
  sourceStrategy: 'auto',     // auto | static | live
  customProxies: []
};
