# iNews

Un lettore di notizie che sta tutto in una cartella di file statici: nessun account,
nessun database, nessun server. La sua idea fissa è una sola — **decidere tu che
cosa non vuoi leggere**.

Un dizionario di parole e coppie di parole tiene fuori dalla home le notizie
costruite per spaventare o far indignare. Non le cancella: le sposta in una
*zona nascosta* che resta a un dito di distanza, dietro una linguetta sul bordo
dello schermo.

![tipo di progetto](https://img.shields.io/badge/sito-statico-blue) ![niente backend](https://img.shields.io/badge/backend-nessuno-green)

---

## Cosa fa

**Le notizie**
- Legge un numero qualsiasi di feed **RSS, Atom o RDF** (13 testate italiane e
  internazionali già configurate, tutte modificabili).
- **Navigazione a due livelli**: le categorie in alto (Generale, Esteri, Tech,
  Economia, Sport, Scienza…), e sotto solo le testate di quella categoria. La
  categoria di ogni fonte si cambia dalle impostazioni, e scrivendone una nuova
  la si crea al volo.
- Tre disposizioni: griglia con le immagini, elenco, oppure solo titoli.
- **Lettore interno** che mostra il testo dell'articolo senza pubblicità né banner
  dei cookie; se il feed pubblica solo l'anteprima, prova a recuperare il testo
  completo dalla pagina originale.
- Ricerca, filtro per testata, *salvate*, *da leggere*, segna come letto.
- Doppioni tra testate diverse eliminati automaticamente.

**Il filtro — la funzione che conta**
- Un **dizionario personalizzabile** di 50 voci di partenza, divise per famiglia
  (polarizzazione, cronaca nera, allarmismo, guerra, salute, clickbait).
- Ogni voce si può accendere, spegnere, cancellare o riscrivere. Per ognuna decidi:
  - **dove cercare**: solo nel titolo, oppure anche nella descrizione;
  - **quanto essere rigidi**: *flessibile* copre plurali e femminili italiani
    (`immigrato` intercetta anche *immigrata* e *immigrati*), *esatta* prende solo
    la parola scritta. Con `*` allarghi ancora: `immigrat*` prende pure
    *immigrazione*.
- Le **coppie di parole** funzionano come frasi: `emergenza migranti` scatta solo
  se le due parole compaiono vicine e in quell'ordine — molto più preciso di due
  parole separate.
- Accenti e maiuscole non contano; i confini di parola sì, quindi `choc` non
  nasconde *cioccolato*.
- **Salvagente**: una lista di parole che *riportano* la notizia in home anche se
  il dizionario la bloccherebbe. Utile per non perdere i temi che ti interessano.
- Interruttore generale per spegnere il filtro in un secondo.

**La zona nascosta**
- Linguetta fissa sul bordo destro (in basso su telefono, con la tendina da
  trascinare) col conteggio delle notizie messe da parte.
- Per ognuna è scritto **perché** è stata nascosta, con la parola evidenziata nel
  titolo. Il titolo è sfocato finché non ci passi sopra: si vede che c'è, non ti
  salta addosso.
- Da lì puoi leggerla comunque, riportarla in home, oppure togliere quella parola
  dal dizionario con un clic.
- Le pastiglie in alto raggruppano per parola: *«allarme» 6*, *«tragedia» 3* —
  così si capisce al volo se una regola sta esagerando.

**Il resto**
- Tema chiaro/scuro/automatico, scorciatoie da tastiera, installabile come app
  (PWA) e funzionante offline.
- Esporta e reimporta il tuo profilo in un file JSON.
- Nessuna traccia esce dal tuo browser.

### Scorciatoie

| Tasto | Azione | | Tasto | Azione |
|---|---|---|---|---|
| `/` | cerca | | `h` | zona nascosta |
| `r` | aggiorna | | `f` | accendi/spegni il filtro |
| `t` | tema | | `s` | impostazioni |
| `v` | disposizione | | `Esc` | chiudi |

---

## Metterlo online (GitHub Pages)

```bash
git init && git add . && git commit -m "iNews"
git branch -M main
git remote add origin https://github.com/TUO-UTENTE/inews.git
git push -u origin main
```

Poi su GitHub: **Settings → Pages → Source: Deploy from a branch → main / (root)**.
Dopo un minuto il sito è su `https://TUO-UTENTE.github.io/inews/`.

Non serve nessuna compilazione: sono file statici, i percorsi sono tutti relativi
e `.nojekyll` evita che GitHub ignori qualche cartella.

Per provarlo in locale serve un piccolo server, perché il browser blocca i moduli
JavaScript aperti da `file://`:

```bash
python3 -m http.server 8000    # poi apri http://localhost:8000
```

---

## «Ma i dati dove finiscono?»

Era la tua domanda, e la risposta ha due metà.

**I tuoi dati** — dizionario, fonti, salvate, preferenze — stanno nel
`localStorage` del browser. Una pagina statica non può scrivere file sul server
perché un server, semplicemente, non c'è: il browser non ha nessuno a cui
chiedere. In compenso non serve alcun account e niente di tuo esce dal
dispositivo. Per spostarli su un altro computer, `Impostazioni → Dati → Esporta`
ti dà un file JSON da reimportare dall'altra parte.

Il codice però è già pronto per il passo successivo: tutta la persistenza passa da
`assets/js/storage.js`, che espone quattro metodi (`get`, `set`, `remove`, `keys`).
Per sincronizzare davvero basta scrivere un secondo adapter — c'è già lo scheletro
in `createRemoteAdapter()` — appoggiandosi a un Gist privato, a una funzione
serverless o a un backend vero. Nient'altro nell'app cambia.

**Le notizie**, invece, su file ci finiscono davvero. Un sito statico non può
leggere i feed da solo (i server delle testate non mandano gli header CORS), e la
soluzione standard sono i proxy pubblici — che però sono lenti e ogni tanto
spariscono. Allora l'ho girata: la GitHub Action in
[`.github/workflows/fetch-feeds.yml`](.github/workflows/fetch-feeds.yml) gira ogni
ora, scarica i feed **da GitHub** con `tools/fetch-feeds.mjs` e fa commit di
`data/news.json` nel repo. Il sito resta statico, ma apre già pieno di notizie,
senza proxy e senza attesa.

I due sistemi convivono: l'app legge prima `data/news.json`, e usa i proxy solo
per i feed che l'utente ha aggiunto di suo (`Impostazioni → Aspetto → Come
scaricare i feed`). Se un giorno i proxy pubblici dovessero smettere di
funzionare, puoi indicarne uno tuo in `Impostazioni → Dati → Avanzate`.

Per rigenerare la cache a mano:

```bash
node tools/fetch-feeds.mjs
```

---

## Com'è fatto dentro

```
index.html                 struttura della pagina
assets/css/style.css       tutto lo stile, a variabili CSS
assets/js/
  config.js                feed iniziali (con categoria), dizionario base, proxy
  storage.js               persistenza (adapter sostituibile)
  filter.js                motore del dizionario: regex, accenti, coppie
  feeds.js                 scarico e parsing RSS/Atom/RDF
  reader.js                pulizia HTML + estrazione del testo completo
  ui.js                    schede, righe nascoste, notifiche
  settings.js              i quattro pannelli delle impostazioni
  app.js                   stato, eventi, rendering
tools/fetch-feeds.mjs      generatore della cache statica
data/news.json             la cache, aggiornata dalla GitHub Action
sw.js                      service worker (offline)
```

JavaScript nativo a moduli, zero dipendenze, zero build. Si apre, si legge, si
modifica.

### Sicurezza

L'HTML che arriva dai feed non viene mai inserito così com'è: `reader.js` lo passa
da un filtro che tiene solo una lista chiusa di tag e attributi, butta via
`script`, `iframe`, `on*` e gli URL `javascript:`, e rende assoluti i link
relativi. Tutto il testo che finisce nelle schede è comunque sottoposto a escape.

---

## Idee per il seguito

- Sincronizzazione via Gist privato (l'adapter è già predisposto).
- Punteggio di "tono" invece del solo sì/no, con una soglia regolabile.
- Raggruppamento della stessa notizia raccontata da testate diverse.
- Dizionari condivisibili tramite link.
- Filtro per fascia oraria («niente cronaca dopo le 22»).
