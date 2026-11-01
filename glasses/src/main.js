import { afterPaint, h, mount } from './dom.js';
import { clearAvatarCache, createAvatars } from './avatars.js';
import { openChat, resumeRoute, startNav } from './nav.js';
import { createChatView } from './screens/chat.js';
import { createChatList } from './screens/chats.js';
import { showLogin } from './screens/login.js';
import { showSetup } from './screens/setup.js';
import {
  clearCredentials,
  clearSession,
  consumeFragment,
  loadCredentials,
  loadSession,
  saveSession,
  takeNotice,
  setNotice,
} from './storage.js';

const CATCH_UP_INTERVAL_MS = 30_000;

const root = document.getElementById('app');
const net = document.getElementById('net');
let floodTimer = null;
let authLost = false;

function showStatus(text) {
  mount(root, h('main', { class: 'form' }, h('p', { role: 'status' }, text)));
}

function showFailure(text, retry) {
  const again = h('button', { type: 'button', onclick: retry }, 'Riprova');
  mount(root, h('main', { class: 'form' },
    h('p', { class: 'error', role: 'alert' }, text),
    h('div', { class: 'actions' }, again)));
  again.focus({ preventScroll: true });
}

function setNetMessage(text) {
  net.textContent = text;
  net.hidden = !text;
}

function showFlood(seconds) {
  clearTimeout(floodTimer);
  setNetMessage(`Telegram chiede di attendere ${seconds} secondi`);
  floodTimer = setTimeout(() => setNetMessage(''), seconds * 1000);
}

function restart(notice) {
  if (notice) setNotice(notice);
  window.location.reload();
}

function onSessionLost() {
  if (authLost) return;
  authLost = true;
  clearSession();
  restart('La sessione non è più valida: accedi di nuovo.');
}

function changeCredentials() {
  clearCredentials();
  clearSession();
  restart();
}

function showApp(tg) {
  let listScroll = 0;
  let lastChat = null;
  let lastCatchUp = Date.now();

  const avatars = createAvatars(tg.downloadAvatar);
  const list = createChatList({
    tg,
    avatars,
    onOpen: openChat,
    onLogout: async () => {
      await Promise.allSettled([tg.logout(), clearAvatarCache()]);
      clearSession();
      restart();
    },
    onOutboxRead: (chatId, maxId) => view.applyEvent({ type: 'read-outbox', chatId, maxId }),
  });
  const view = createChatView({ tg, onRead: (id) => list.setOpenChat(id) });

  function showList() {
    view.close();
    list.setOpenChat(null);
    list.element.hidden = false;
    window.scrollTo(0, listScroll);
    list.focusChat(lastChat);
  }

  function route(next) {
    const chat = next.screen === 'chat' ? list.get(next.chatId) : null;
    if (!chat) {
      showList();
      return;
    }
    if (!list.element.hidden) listScroll = window.scrollY;
    lastChat = chat.id;
    list.setOpenChat(chat.id);
    list.element.hidden = true;
    view.open(chat);
  }

  function onEvent(event) {
    if (event.type === 'auth-lost') onSessionLost();
    else if (event.type === 'flood') showFlood(event.seconds);
    else if (event.type === 'state') setNetMessage(event.online ? '' : 'Connessione persa, riprovo…');
    else {
      list.applyEvent(event);
      view.applyEvent(event);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastCatchUp < CATCH_UP_INTERVAL_MS) return;
    lastCatchUp = Date.now();
    tg.catchUp().then(() => onEvent({ type: 'resync' })).catch(() => {});
  });

  mount(root, list.element, view.element);
  startNav(route);
  return {
    onEvent,
    async start() {
      await list.load();
      list.focusFirst();
      resumeRoute();
    },
  };
}

async function loadClient() {
  try {
    return await import('./tg/client.js');
  } catch {
    showFailure('Impossibile scaricare il client Telegram. Controlla la rete.', boot);
    return null;
  }
}

async function boot() {
  consumeFragment();
  const credentials = loadCredentials();
  if (!credentials) {
    showSetup(root, boot);
    return;
  }

  showStatus('Connessione a Telegram…');
  await afterPaint();
  const tg = await loadClient();
  if (!tg) return;

  const session = loadSession();
  let app = null;
  const earlyEvents = [];
  try {
    await tg.connect({
      ...credentials,
      session,
      onSession: saveSession,
      onEvent: (event) => (app ? app.onEvent(event) : earlyEvents.push(event)),
    });
    let notice = takeNotice();
    if (!(await tg.isAuthorized())) {
      if (session) {
        clearSession();
        notice = 'La sessione non è più valida: accedi di nuovo.';
      }
      await showLogin(root, tg, { notice, onChangeCredentials: changeCredentials });
    }
    showStatus('Caricamento delle chat…');
    app = showApp(tg);
    earlyEvents.forEach(app.onEvent);
    await app.start();
  } catch {
    showFailure('Connessione a Telegram non riuscita. Controlla la rete.', () => window.location.reload());
  }
}

boot();
