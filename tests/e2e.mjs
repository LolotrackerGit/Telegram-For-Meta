// Prova l'app come sugli occhiali: Chrome reale a 600×600, solo frecce e Invio.
// La navigazione spaziale va attivata con un flag perché su desktop è spenta.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = 4174;
const BASE = `http://localhost:${PORT}/`;
const API_HASH = '0123456789abcdef0123456789abcdef';
const shots = process.env.E2E_SHOTS;

execFileSync('node', ['build.mjs', '--fake'], { stdio: 'ignore' });
const server = spawn('node', ['serve.mjs', '.e2e-dist'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});
await new Promise((resolve) => setTimeout(resolve, 500));

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-spatial-navigation'],
});

let failures = 0;
async function scenario(name, run) {
  const context = await browser.newContext({ viewport: { width: 600, height: 600 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  try {
    await run(page, context);
    if (errors.length) throw new Error(`errori nella pagina: ${errors.join(' | ')}`);
    console.log(`ok    ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`ERRORE ${name}\n      ${error.message}`);
  }
  await context.close();
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const press = (page, ...keys) => keys.reduce(
  (previous, key) => previous.then(() => page.keyboard.press(key)),
  Promise.resolve(),
);

const activeText = (page) => page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
const activeTag = (page) => page.evaluate(() => document.activeElement?.tagName);
const scrollY = (page) => page.evaluate(() => Math.round(window.scrollY));
const calls = (page, name) => page.evaluate((call) => window.fakeTg.calls.filter(([n]) => n === call), name);

async function noHorizontalScroll(page) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check(width <= 600, `scroll orizzontale: larghezza ${width}`);
}

async function screenshot(page, name) {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, `${name}.png`) });
}

// La sessione si semina una volta sola, così un ricaricamento vede quella vera.
async function signedIn(context) {
  await context.addInitScript((hash) => {
    localStorage.setItem('tgocchiali.api_id', '12345');
    localStorage.setItem('tgocchiali.api_hash', hash);
    if (sessionStorage.getItem('seminata')) return;
    sessionStorage.setItem('seminata', '1');
    localStorage.setItem('tgocchiali.session', 'sessione-finta');
  }, API_HASH);
}

async function openList(page, context) {
  await signedIn(context);
  await page.goto(BASE);
  await page.waitForSelector('.chat-row');
}

// Porta il focus sulla riga voluta con i soli tasti freccia.
async function focusRow(page, count) {
  for (let step = 0; step < count; step += 1) await press(page, 'ArrowDown');
}

await scenario('senza credenziali mostra le istruzioni', async (page) => {
  await page.goto(BASE);
  await page.waitForSelector('text=Configurazione');
  await noHorizontalScroll(page);
  await screenshot(page, 'setup');
  await page.keyboard.type('abc');
  await press(page, 'ArrowDown', 'ArrowDown', 'Enter');
  check(await page.isVisible('text=Valori non validi'), 'manca l’errore di validazione');
});

await scenario('le credenziali dal frammento vengono salvate e tolte dall’URL', async (page) => {
  await page.goto(`${BASE}#api_id=12345&api_hash=${API_HASH}`);
  await page.waitForSelector('text=Accedi a Telegram');
  check(!page.url().includes('#'), `URL non pulito: ${page.url()}`);
  const stored = await page.evaluate(() => localStorage.getItem('tgocchiali.api_hash'));
  check(stored === API_HASH, 'api_hash non salvato');
});

await scenario('login con numero, codice errato, 2FA, tutto da tastiera', async (page) => {
  await page.goto(`${BASE}#api_id=12345&api_hash=${API_HASH}`);
  await page.waitForSelector('input[type=tel]');
  check(await activeTag(page) === 'INPUT', 'il campo numero non ha il focus');
  await screenshot(page, 'login');
  await page.keyboard.type('333 1234567');
  await press(page, 'ArrowDown');
  check(await activeText(page) === 'Invia codice', `focus su "${await activeText(page)}"`);
  await press(page, 'Enter');

  await page.waitForSelector('text=Codice di accesso');
  await page.keyboard.type('99999');
  await press(page, 'ArrowDown', 'Enter');
  await page.waitForSelector('text=Codice scaduto');
  check((await calls(page, 'sendCode'))[0][1] === '+393331234567', 'numero non normalizzato');

  await page.keyboard.type('333 1234567');
  await press(page, 'ArrowDown', 'Enter');
  await page.waitForSelector('text=Codice di accesso');
  await page.keyboard.type('11111');
  await press(page, 'ArrowDown', 'Enter');

  await page.waitForSelector('text=Verifica in due passaggi');
  check(await page.getAttribute('input', 'type') === 'text', 'il campo 2FA deve essere type=text');
  check(await page.isVisible('text=resta visibile'), 'manca l’avviso sulla password');
  await screenshot(page, 'password');
  await page.keyboard.type('sbagliata');
  await press(page, 'ArrowDown', 'Enter');
  await page.waitForSelector('text=Password errata');
  await page.keyboard.type('segreta');
  await press(page, 'ArrowDown', 'Enter');
  await page.waitForSelector('.chat-row');
  const session = await page.evaluate(() => localStorage.getItem('tgocchiali.session'));
  check(session === 'sessione-finta', 'sessione non salvata');
});

await scenario('login QR come opzione secondaria e ritorno al numero', async (page) => {
  await page.goto(`${BASE}#api_id=12345&api_hash=${API_HASH}`);
  await page.waitForSelector('input[type=tel]');
  await press(page, 'ArrowDown', 'ArrowDown');
  check(await activeText(page) === 'Accedi con QR', `focus su "${await activeText(page)}"`);
  await press(page, 'Enter');
  await page.waitForSelector('.qr img');
  await noHorizontalScroll(page);
  await screenshot(page, 'qr');
  check(await activeText(page) === 'Usa il numero', 'il pulsante di ritorno non ha il focus');
  await press(page, 'Enter');
  await page.waitForSelector('input[type=tel]');
  await press(page, 'ArrowDown', 'ArrowDown', 'Enter');
  await page.waitForSelector('.qr img');
  await page.evaluate(() => window.fakeTg.scanQr());
  await page.waitForSelector('.chat-row');
});

await scenario('lista: righe native, frecce, nome lungo senza overflow', async (page, context) => {
  await openList(page, context);
  await screenshot(page, 'lista');
  await noHorizontalScroll(page);
  check(await page.locator('.chat-row').count() === 40, 'prima pagina diversa da 40');
  check(await page.locator('[tabindex]').count() === 0, 'trovato un tabindex');
  check(await activeTag(page) === 'BUTTON', 'la prima riga non ha il focus');
  await focusRow(page, 12);
  const name = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
  check(name.startsWith('Contatto 12'), `focus su "${name}"`);
  const box = await page.evaluate(() => document.activeElement.getBoundingClientRect().toJSON());
  check(box.top >= 40 && box.bottom <= 600, `riga fuori vista: ${box.top}-${box.bottom}`);
});

await scenario('foto: scaricate solo se in vista e una volta sola', async (page, context) => {
  await openList(page, context);
  await page.waitForSelector('.avatar img');
  await page.waitForTimeout(1500);
  const first = (await calls(page, 'downloadAvatar')).length;
  check(first > 0 && first < 20, `download iniziali: ${first}`);
  await page.reload();
  await page.waitForSelector('.avatar img');
  await page.waitForTimeout(800);
  check((await calls(page, 'downloadAvatar')).length === 0, 'foto riscaricate invece che lette dalla cache');
  const initialsShown = await page.locator('.avatar:not(:has(img))').first().textContent();
  check(initialsShown.length > 0, 'nessun fallback alle iniziali');
});

await scenario('aggiornamenti: focus e scroll restano al loro posto', async (page, context) => {
  await openList(page, context);
  await focusRow(page, 10);
  const label = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
  const top = await page.evaluate(() => document.activeElement.getBoundingClientRect().top);
  await page.evaluate(() => {
    window.markedRow = document.activeElement;
    window.fakeTg.incoming('1030', 'Sale in cima');
    window.fakeTg.incoming('1031', 'Sale anche questa');
  });
  check(await page.evaluate(() => document.activeElement === window.markedRow), 'focus perso');
  const after = await page.evaluate(() => document.activeElement.getBoundingClientRect().top);
  check(Math.abs(after - top) < 2, `riga spostata di ${after - top}px`);
  check((await page.evaluate(() => document.activeElement.getAttribute('aria-label'))) === label, 'riga cambiata');
  await page.evaluate(() => window.fakeTg.incoming('1010', 'Tocca alla riga col focus'));
  check(await page.evaluate(() => document.activeElement === window.markedRow), 'focus perso sulla riga spostata');
  const visible = await page.evaluate(() => {
    const box = document.activeElement.getBoundingClientRect();
    return box.top >= 0 && box.bottom <= 600;
  });
  check(visible, 'riga col focus fuori vista dopo lo spostamento');
});

await scenario('conversazione: apertura, scroll, messaggi vecchi, invio, Indietro', async (page, context) => {
  await openList(page, context);
  await focusRow(page, 5);
  const startLength = await page.evaluate(() => history.length);
  const listY = await scrollY(page);
  await press(page, 'Enter');
  await page.waitForSelector('.msg');
  check(await page.evaluate(() => history.length) === startLength + 1, 'aprire una chat deve aggiungere una voce');
  check(await activeTag(page) === 'TEXTAREA', 'il campo non ha il focus');
  check(await page.getAttribute('textarea', 'type') === null, 'il campo deve essere un textarea nativo');
  await page.waitForFunction(() => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2);
  await noHorizontalScroll(page);
  await screenshot(page, 'chat');
  check((await calls(page, 'markRead')).length === 1, 'chat non segnata come letta');

  const bottom = await scrollY(page);
  await press(page, 'ArrowUp');
  await page.waitForFunction((y) => window.scrollY < y, bottom);
  check(await activeTag(page) === 'TEXTAREA', 'Su deve scorrere senza togliere il focus');
  await press(page, 'ArrowDown');
  await page.waitForTimeout(300);

  for (let step = 0; step < 60 && (await calls(page, 'getHistory')).length < 2; step += 1) {
    await press(page, 'ArrowUp');
    await page.waitForTimeout(30);
  }
  check((await calls(page, 'getHistory')).length >= 2, 'messaggi vecchi non caricati');
  await page.waitForFunction(() => document.querySelectorAll('.msg').length >= 60);
  const stable = await page.evaluate(() => {
    const text = [...document.querySelectorAll('.msg')].find((item) => item.getBoundingClientRect().top > 60);
    return text.getBoundingClientRect().top < 600;
  });
  check(stable, 'lo scroll è saltato dopo il caricamento');

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.keyboard.type('Ciao dagli occhiali');
  await press(page, 'ArrowRight');
  check(await activeText(page) === 'Invia', `dopo il campo il focus è su "${await activeText(page)}"`);
  await press(page, 'Enter');
  await page.waitForSelector('text=Ciao dagli occhiali');
  await page.waitForTimeout(100);
  check(await page.locator('.msg:has-text("Ciao dagli occhiali")').count() === 1, 'messaggio duplicato');
  check(await page.inputValue('textarea') === '', 'campo non svuotato');

  await page.goBack();
  await page.waitForSelector('.chat-row');
  check(await page.isHidden('.chat'), 'conversazione ancora visibile');
  const label = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
  check(label?.startsWith('Contatto 5'), `focus al ritorno su "${label}"`);
  check(Math.abs((await scrollY(page)) - listY) < 2, 'posizione della lista persa');
  check(await page.evaluate(() => history.length) === startLength + 1, 'Indietro non deve aggiungere voci');
});

await scenario('conversazione: messaggi in arrivo non spostano chi sta leggendo', async (page, context) => {
  await openList(page, context);
  await press(page, 'Enter');
  await page.waitForSelector('.msg');
  // Lontano dal fondo e fuori dalla zona che carica i messaggi vecchi.
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(200);
  const reading = () => page.evaluate(() => {
    const message = [...document.querySelectorAll('.msg')].find((item) => item.getBoundingClientRect().top > 60);
    return { text: message.textContent, top: Math.round(message.getBoundingClientRect().top) };
  });
  const before = await reading();
  await page.evaluate(() => window.fakeTg.incoming('1000', 'Mentre leggi'));
  const after = await reading();
  check(after.text === before.text && after.top === before.top, 'la pagina è saltata');
  await page.waitForSelector('text=1 nuovo messaggio');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForSelector('.new-below', { state: 'hidden' });
  await page.evaluate(() => window.fakeTg.incoming('1000', 'In fondo'));
  await page.waitForFunction(() => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2);
});

await scenario('invio fallito: il testo resta nel campo', async (page, context) => {
  await context.addInitScript(() => localStorage.setItem('fake.sendFails', '1'));
  await openList(page, context);
  await press(page, 'Enter');
  await page.waitForSelector('.msg');
  await page.keyboard.type('Da non perdere');
  await press(page, 'ArrowRight', 'Enter');
  await page.waitForSelector('text=Invio non riuscito');
  check(await page.inputValue('textarea') === 'Da non perdere', 'testo perso');
});

async function openChat(page, context) {
  await openList(page, context);
  await press(page, 'Enter');
  await page.waitForSelector('.msg');
}

const activeLabel = (page) => page.evaluate(() => document.activeElement.getAttribute('aria-label'));

async function openTools(page, context) {
  await openChat(page, context);
  await press(page, 'ArrowLeft', 'ArrowLeft');
  check(await activeLabel(page) === 'Altre opzioni', 'il pulsante + non ha il focus');
  await press(page, 'Enter');
  await page.waitForSelector('.tools button');
}

async function openKeyboard(page) {
  await press(page, 'ArrowLeft');
  check(await activeLabel(page) === 'Tastiera dell’app', 'il pulsante tastiera non ha il focus');
  await press(page, 'Enter');
  await page.waitForSelector('.keyboard button');
}

// Raggiunge un tasto con le sole frecce, spostandosi dalla posizione corrente.
async function pressKey(page, label) {
  const exact = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`);
  const target = page.locator('.keyboard button').filter({ hasText: exact });
  for (let step = 0; step < 40; step += 1) {
    const here = await page.evaluate(() => document.activeElement.getBoundingClientRect().toJSON());
    const there = await target.boundingBox();
    const dx = there.x + there.width / 2 - (here.x + here.width / 2);
    const dy = there.y + there.height / 2 - (here.y + here.height / 2);
    if (Math.abs(dx) < there.width / 2 && Math.abs(dy) < there.height / 2) {
      await press(page, 'Enter');
      return;
    }
    if (Math.abs(dy) >= there.height / 2) await press(page, dy > 0 ? 'ArrowDown' : 'ArrowUp');
    else await press(page, dx > 0 ? 'ArrowRight' : 'ArrowLeft');
  }
  throw new Error(`tasto ${label} non raggiungibile con le frecce`);
}

await scenario('risposte rapide ed emoji da tastiera, senza invio automatico', async (page, context) => {
  await openTools(page, context);
  await noHorizontalScroll(page);
  await screenshot(page, 'opzioni');
  check(await activeText(page) === 'Ok', `focus su "${await activeText(page)}"`);
  check(await page.locator('.tools button:has-text("Vocale"), .tools button:has-text("Foto")').count() === 0, 'pulsanti media ancora presenti');
  await press(page, 'Enter');
  check(await page.inputValue('textarea') === 'Ok', 'risposta non inserita');
  check(await activeText(page) === 'Invia', 'il focus deve andare su Invia');
  check((await calls(page, 'sendMessage')).length === 0, 'inviato senza conferma');
  await press(page, 'Enter');
  await page.waitForSelector('.msg.out:has-text("Ok")');
});

await scenario('tastiera dell’app: scrive in russo con le frecce e invia', async (page, context) => {
  await openChat(page, context);
  await openKeyboard(page);
  await noHorizontalScroll(page);
  await screenshot(page, 'tastiera-ru');
  const visible = await page.evaluate(() => [...document.querySelectorAll('.msg')]
    .some((item) => item.getBoundingClientRect().bottom > 60 && item.getBoundingClientRect().top < 200));
  check(visible, 'i messaggi non si vedono sopra la tastiera');
  check(await activeText(page) === 'Й', `primo tasto "${await activeText(page)}"`);
  for (const letter of ['П', 'р', 'и', 'в', 'е', 'т', 'т']) await pressKey(page, letter);
  check(await page.inputValue('textarea') === 'Приветт', `testo "${await page.inputValue('textarea')}"`);
  check(await activeText(page) === 'т', 'il focus deve restare sul tasto');
  await pressKey(page, '⌫');
  check(await page.inputValue('textarea') === 'Привет', 'cancellazione errata');
  await page.locator('.composer button:text-is("Invia")').focus();
  await press(page, 'Enter');
  await page.waitForSelector('.msg.out:has-text("Привет")');
  check(await page.isVisible('.keyboard'), 'la tastiera deve restare aperta dopo l’invio');
  check(await page.inputValue('textarea') === '', 'campo non svuotato');
  check(await page.locator('.keyboard button:text-is("Й")').count() === 1, 'maiuscola automatica assente');
});

await scenario('tastiera dell’app: maiuscola una tantum, spazio e cambio di layout', async (page, context) => {
  await openChat(page, context);
  await openKeyboard(page);
  await pressKey(page, 'Й');
  await pressKey(page, 'Aa');
  await pressKey(page, 'Ц');
  await pressKey(page, 'у');
  await pressKey(page, 'Spazio');
  check(await page.inputValue('textarea') === 'ЙЦу ', `testo "${await page.inputValue('textarea')}"`);
  await pressKey(page, 'ABC');
  await pressKey(page, 'q');
  await pressKey(page, '123');
  await pressKey(page, '?');
  await pressKey(page, 'à');
  check(await page.inputValue('textarea') === 'ЙЦу q?à', `testo "${await page.inputValue('textarea')}"`);
  await noHorizontalScroll(page);
  await screenshot(page, 'tastiera-123');
  await pressKey(page, 'Chiudi');
  check(await page.isHidden('.keyboard'), 'tastiera ancora aperta');
  check(await activeText(page) === 'Invia', 'Chiudi deve portare su Invia');
});

await scenario('tutti i tasti di ogni layout si raggiungono con le frecce', async (page, context) => {
  await openChat(page, context);
  await openKeyboard(page);
  for (const next of ['ABC', '123', 'RU']) {
    const labels = await page.locator('.keyboard-rows button').allTextContents();
    for (const label of labels) {
      const before = await page.inputValue('textarea');
      const current = await page.locator('.keyboard-rows button').allTextContents();
      await pressKey(page, current[labels.indexOf(label)]);
      check((await page.inputValue('textarea')).length === before.length + 1, `tasto ${label} non scrive`);
    }
    await pressKey(page, next);
  }
});

await scenario('il layout resta nella chat e cambia le risposte rapide', async (page, context) => {
  await openChat(page, context);
  await openKeyboard(page);
  await pressKey(page, 'Chiudi');
  await page.locator('.more[aria-label="Altre opzioni"]').focus();
  await press(page, 'Enter');
  await page.waitForSelector('.tools button:text-is("Спасибо")');
  await page.locator('.more[aria-label="Tastiera dell’app"]').focus();
  await press(page, 'Enter');
  check(await page.isHidden('.tools'), 'il pannello + deve chiudersi');
  await pressKey(page, 'ABC');
  await page.reload();
  await page.waitForSelector('.msg');
  await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA');
  await openKeyboard(page);
  check(await page.locator('.keyboard button:text-is("Q")').count() === 1, 'layout non ricordato dopo il ricaricamento');
  await page.goBack();
  await page.waitForSelector('.chat-row');
  await press(page, 'ArrowDown', 'Enter');
  await page.waitForSelector('.msg');
  await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA');
  await openKeyboard(page);
  check(await page.locator('.keyboard button:text-is("Й")').count() === 1, 'il layout non deve passare alle altre chat');
});

await scenario('dalla tastiera si arriva a Invia e Indietro la chiude', async (page, context) => {
  await openChat(page, context);
  await openKeyboard(page);
  await pressKey(page, 'Д');
  await pressKey(page, 'а');
  await press(page, 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown');
  check(await page.evaluate(() => Boolean(document.activeElement.closest('.composer'))), 'Giù non raggiunge la barra del messaggio');
  await page.goBack();
  await page.waitForSelector('.chat-row');
  await press(page, 'Enter');
  await page.waitForSelector('.msg');
  check(await page.isHidden('.keyboard'), 'tastiera rimasta aperta');
  check(await page.inputValue('textarea') === 'Да', 'bozza persa');
});

await scenario('reload dentro una chat riparte dalla chat, Indietro torna alla lista', async (page, context) => {
  await openList(page, context);
  await press(page, 'Enter');
  await page.waitForSelector('.msg');
  await page.reload();
  await page.waitForSelector('.msg');
  check(await page.isVisible('.chat'), 'chat non ripristinata');
  await page.goBack();
  await page.waitForSelector('.chat-row');
});

await scenario('sessione cancellata: torna al login senza errori', async (page, context) => {
  await context.addInitScript((hash) => {
    localStorage.setItem('tgocchiali.api_id', '12345');
    localStorage.setItem('tgocchiali.api_hash', hash);
  }, API_HASH);
  await page.goto(BASE);
  await page.waitForSelector('input[type=tel]');
  check(await page.locator('[role=alert]:visible').count() === 0, 'errore mostrato senza motivo');
});

await scenario('sessione revocata: login con avviso chiaro', async (page, context) => {
  await openList(page, context);
  await page.evaluate(() => {
    localStorage.removeItem('tgocchiali.session');
    window.fakeTg.emit({ type: 'auth-lost' });
  });
  await page.waitForSelector('text=La sessione non è più valida');
});

await scenario('rete assente, FLOOD_WAIT e riconnessione', async (page, context) => {
  await openList(page, context);
  await page.evaluate(() => window.fakeTg.emit({ type: 'state', online: false }));
  await page.waitForSelector('#net:has-text("Connessione persa")');
  await page.evaluate(() => {
    window.fakeTg.emit({ type: 'state', online: true });
    window.fakeTg.emit({ type: 'resync' });
  });
  await page.waitForSelector('#net', { state: 'hidden' });
  await page.waitForTimeout(1800);
  check((await calls(page, 'getDialogs')).length === 2, 'lista non riallineata una sola volta');
  await page.evaluate(() => window.fakeTg.emit({ type: 'flood', seconds: 1 }));
  await page.waitForSelector('#net:has-text("attendere 1 secondi")');
  await page.waitForSelector('#net', { state: 'hidden' });
});

await scenario('connessione impossibile all’avvio: Riprova raggiungibile', async (page, context) => {
  await context.addInitScript(() => localStorage.setItem('fake.offline', '1'));
  await signedIn(context);
  await page.goto(BASE);
  await page.waitForSelector('text=Connessione a Telegram non riuscita');
  check(await activeText(page) === 'Riprova', 'Riprova non ha il focus');
  check(await page.evaluate(() => localStorage.getItem('tgocchiali.session')) === 'sessione-finta', 'sessione persa');
});

await scenario('Esci chiede conferma e chiude la sessione', async (page, context) => {
  await openList(page, context);
  await page.locator('text=Esci').focus();
  await press(page, 'Enter');
  await page.waitForSelector('text=Conferma: esci da Telegram');
  await press(page, 'Enter');
  await page.waitForSelector('input[type=tel]');
  check(await page.evaluate(() => localStorage.getItem('tgocchiali.session')) === null, 'sessione ancora salvata');
});

await browser.close();
server.kill();
console.log(failures ? `\n${failures} scenari falliti` : '\nTutti gli scenari sono passati');
process.exit(failures ? 1 : 0);
