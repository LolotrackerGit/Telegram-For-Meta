# TG Occhiali

Client Telegram non ufficiale per **Meta Ray-Ban Display**. È un sito di soli file statici: si collega direttamente a Telegram dal browser degli occhiali (MTProto via WebSocket), senza server.

**Indirizzo:** <https://lolotrackergit.github.io/Telegram-For-Meta/>

## 1. Ottieni api_id e api_hash

Ogni utente usa le proprie chiavi: nel codice non ce ne sono.

1. Apri <https://my.telegram.org> e accedi col tuo numero.
2. Scegli **API development tools** e crea un'app.
3. Copia `api_id` (un numero) e `api_hash` (32 caratteri).

## 2. Costruisci l'URL

Aggiungi le chiavi dopo il `#`, senza spazi:

```text
https://lolotrackergit.github.io/Telegram-For-Meta/#api_id=IL_TUO_API_ID&api_hash=IL_TUO_API_HASH
```

Quello che segue il `#` non viene inviato a GitHub. L'app salva i valori in `localStorage` e toglie il frammento dalla barra degli indirizzi.

Tieni l'URL per te, perché contiene le tue chiavi. Se il frammento non arrivasse all'app, la schermata **Configurazione** permette di inserirle a mano.

## 3. Aggiungi la Web App agli occhiali

1. Attiva la **Modalità sviluppatore** nell'app Meta AI.
2. Apri **App Settings** nel pannello sinistro, poi **Apps**.
3. Tocca **Web Apps** → **Connect Web App**, incolla l'URL del punto 2 e tocca **Save**.

L'app compare in fondo alla griglia e si può fissare.

## 4. Accedi

- **Numero di telefono (metodo principale):** scrivi numero, codice ed eventuale password di verifica in due passaggi con il compositore di sistema. Senza prefisso si assume +39.
- **QR (opzione secondaria, comodo dal Mac):** Telegram sul telefono → Impostazioni → Dispositivi → Collega dispositivo desktop.

La password di verifica in due passaggi usa un campo di testo normale, perché `type=password` non apre il compositore: resta visibile mentre la scrivi.

## Comandi sugli occhiali

| Input | Azione |
|---|---|
| Frecce | Spostano il focus; senza elementi in quella direzione scorrono la pagina |
| Invio | Apre la chat, attiva il campo di testo o il pulsante |
| Destra dal campo | Porta a **Invia** |
| Indietro di sistema | Dalla chat torna alla lista |

**Esci** si trova in fondo alla lista, chiede conferma e chiude la sessione anche su Telegram.

## Scrivere e allegare

Le opzioni del compositore di sistema (scrittura neurale, dettatura, tastiera) dipendono dagli occhiali e dalla loro lingua: una Web App non può aggiungerne. Per questo il pulsante **+**, a sinistra del campo, apre un pannello interno all'app:

- **Risposte rapide ed emoji:** finiscono nel campo e il focus passa su **Invia**, così non parte nulla per errore.
- **🎤 Vocale, 📷 Foto, 🎬 Video (massimo 15 secondi), 📁 File (massimo 50 MB).**

La documentazione Meta non cita fotocamera, microfono o selezione di file per le Web App. L'app prova ad usarli e, se il dispositivo non li offre, lo dice sullo schermo. Su Chrome per computer funzionano tutti.

## Sicurezza

- La sessione Telegram e le chiavi stanno in `localStorage`. Meta sconsiglia Web Storage per i segreti, ma un sito statico non ha un'alternativa protetta.
- L'origine `lolotrackergit.github.io` è condivisa da tutti i progetti Pages di questo account: **non pubblicare lì codice non fidato**, perché potrebbe leggere la sessione.
- La Content Security Policy consente script solo da questo sito e connessioni solo a Telegram. Include `'unsafe-eval'` perché teleproto genera i lettori del protocollo con `new Function`, a partire dallo schema e mai dai messaggi.

## Sviluppo

Serve Node 20 o superiore.

```bash
npm install
```

```bash
npm run build
```

```bash
npm run serve
```

`npm run build` genera `docs/`, poi `npm run serve` lo apre su <http://localhost:4173/>. La pagina locale accetta lo stesso frammento `#api_id=…&api_hash=…`. GitHub Pages pubblica `docs/` dal branch `main`.

```bash
npm test
```

I test usano Chrome a 600×600 con un Telegram finto (`tests/fake-tg.js`, mai incluso in `docs/`) e soli tasti freccia e Invio. Chrome ha bisogno di `--enable-spatial-navigation`, perché su desktop la navigazione spaziale è spenta. Il simulatore Meta invia solo gli eventi dei tasti, quindi non basta per provarla.

### Struttura

- `glasses/src/main.js`: avvio e passaggio tra le schermate.
- `glasses/src/screens/`: configurazione, login, lista chat, conversazione.
- `glasses/src/tg/client.js`: unico modulo che usa [teleproto](https://github.com/sanyok12345/teleproto), caricato dopo il primo disegno.
- `glasses/public/`: icona, `.nojekyll` e `.well-known/meta-wearables-manifest.json`. Senza `.nojekyll` GitHub Pages ignorerebbe `.well-known`.
