# iNews

Un lettore di notizie che sta tutto in una cartella di file statici: nessun account,
nessun database, nessun server. La sua idea fissa è una sola — **decidere tu che
cosa non vuoi leggere**.

Un dizionario di parole e coppie di parole tiene fuori dalla home le notizie
costruite per spaventare o far indignare. Non le cancella: le sposta in una
*zona nascosta* che resta a un dito di distanza, dietro una linguetta sul bordo
dello schermo.

![tipo di progetto](https://img.shields.io/badge/sito-statico-blue) ![niente backend](https://img.shields.io/badge/backend-nessuno-green) ![licenza MIT](https://img.shields.io/badge/licenza-MIT-lightgrey)

---

## Cosa fa

**Le notizie**
- Legge un numero qualsiasi di feed **RSS, Atom o RDF** (13 testate italiane e
  internazionali già configurate, tutte modificabili).
- **Navigazione a due livelli**: le categorie in alto (Politica, Cronaca, Esteri,
  Economia, Tech, Scienza, Sport…), e sotto solo le testate di quella categoria.
  Dove il feed marca i singoli articoli, la categoria è quella vera dell'articolo;
  altrove si ricade su quella della fonte, modificabile dalle impostazioni.
- **Filtro per lingua**: se nel carico ci sono notizie in più lingue compare un
  selettore (Italiano / English) e le schede straniere portano un'etichetta.
  Se leggi solo fonti italiane, il selettore non compare affatto.
- Tre disposizioni: griglia con le immagini, elenco, oppure solo titoli.
- **Lettore interno** che mostra il testo dell'articolo senza pubblicità né banner
  dei cookie. Il testo lo estrae la GitHub Action, insieme alle immagini: si apre
  subito, senza passare da nessun servizio esterno. Per gli articoli fuori dalla
  cache (le fonti aggiunte da te) resta il recupero al volo dalla pagina originale.
- Ricerca, filtro per testata, *salvate*, *da leggere*, segna come letto.
- Doppioni tra testate diverse eliminati automaticamente.

**Il filtro — la funzione che conta**
- Un **dizionario personalizzabile** di 50 voci di partenza, divise per famiglia
  (polarizzazione, cronaca nera, allarmismo, guerra, salute, clickbait).
- Ogni voce si può accendere, spegnere, cancellare o riscrivere. Per ognuna decidi:
  - **dove cercare**: *titolo o testo* (l'impostazione di partenza: basta che la
    parola compaia in uno dei due), *solo titolo*, oppure *solo testo*;
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

---

## Domande frequenti

**Perché l'articolo non si apre nel lettore?**
Se resta su «Sto recuperando il testo completo», vuol dire che si è finiti sul
percorso di riserva — quello che passa dai proxy pubblici, che sono spesso
irraggiungibili. Succede solo per gli articoli assenti da `data/news.json`: per
tutti gli altri il testo è già dentro la cache, estratto dalla GitHub Action, e
compare all'istante. Se ti capita spesso, vuol dire che la cache è vecchia o che
la fonte l'hai aggiunta tu: in quel caso il pulsante «Apri l'originale» è lì
apposta.

**Perché alcune notizie non hanno l'immagine?**
Perché la testata non la mette nel feed. Su tredici fonti provate, sei
pubblicano l'immagine (in tre formati diversi: `<enclosure>`, `<media:content>`,
`<media:thumbnail>`) e sette non ne pubblicano nessuna — ANSA, Repubblica, Il
Post e DDAY, per dire, non ne mandano mai. Per questo la GitHub Action, dopo aver
letto i feed, apre le pagine degli articoli rimasti senza foto e ne legge il
`og:image`: sull'ultimo giro ha recuperato 93 immagini su 99, portando la
copertura dal 71% al 98%. È una cosa che si può fare solo lato server: dal
browser sarebbero cento richieste in più a ogni apertura.

**Perché alcune fonti si dividono per categoria e altre no?**
Perché solo alcune marcano i singoli articoli. Repubblica manda `Cronaca`,
`Politica`, `Economia`; Gazzetta arriva a venticinque etichette diverse
(`Calcio`, `Tennis`, perfino `Bordo ring`); ANSA, Focus, Internazionale e BBC non
ne mandano nessuna. iNews normalizza i vocabolari con la tabella
`CATEGORY_ALIASES` in `config.js` — una decina di sezioni riconoscibili — e per
le fonti mute usa la categoria assegnata alla testata. Se una fonte ti interessa
divisa per sezioni e non manda etichette, la strada è iscriversi ai suoi feed di
sezione: quasi tutte le testate ne hanno (è così che Il Post compare come
«Italia» e «Mondo»).

**Perché le notizie non si aggiornano?**
Tre cause possibili, in ordine di frequenza:
1. **La GitHub Action non è sul repository.** Se hai caricato i file
   dall'interfaccia web di GitHub, sappi che salta silenziosamente tutto ciò che
   inizia per punto — quindi niente `.github/`, niente `.nojekyll`. Verifica che
   `.github/workflows/fetch-feeds.yml` ci sia, e in caso carica con `git push`.
2. **L'Action non ha il permesso di scrivere.** Serve
   *Settings → Actions → General → Workflow permissions → Read and write*.
   Senza, il commit finale fallisce con un 403.
3. **La cache era considerata fresca.** L'app usa `data/news.json` finché ha meno
   di 75 minuti, poi passa alla rete. Il pulsante **Aggiorna** salta comunque la
   cache e va sempre a interrogare i siti: il suo suggerimento dice quando e
   come è arrivato l'ultimo carico.

---

## Licenza

[MIT](LICENSE) — fanne quello che vuoi, basta che il testo della licenza resti
allegato. I contenuti dei feed restano ovviamente delle rispettive testate:
iNews li mostra e rimanda sempre all'articolo originale.
