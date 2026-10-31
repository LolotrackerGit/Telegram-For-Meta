// Stessa interfaccia di glasses/src/tg/client.js, con dati finti in memoria.
// Entra solo nella build dei test: `node build.mjs --fake`.
const CHATS = 50;
const HISTORY = 95;
const VALID_CODE = '11111';
const VALID_PASSWORD = 'segreta';

const now = Math.floor(Date.now() / 1000);
const calls = [];
const chats = [];
const histories = new Map();
let emit = () => {};
let persistSession = () => {};
let session = '';
let nextId = 10_000;

function buildHistory(chatId) {
  const messages = [];
  for (let id = 1; id <= HISTORY; id += 1) {
    const out = id % 4 === 0;
    messages.push({
      id,
      chatId,
      out,
      senderId: out ? 'self' : `u${id % 3}`,
      senderName: out ? 'Tu' : `Persona ${id % 3}`,
      date: now - (HISTORY - id) * 200,
      edited: false,
      text: id % 11 === 0 ? '' : `Messaggio numero ${id} con un po’ di testo per occupare una riga`,
      media: id % 11 === 0 ? '📷 Foto' : null,
    });
  }
  return messages;
}

for (let index = 0; index < CHATS; index += 1) {
  const id = String(1000 + index);
  histories.set(id, buildHistory(id));
  chats.push({
    id,
    title: index === 2 ? 'Gruppo con un nome davvero molto lungo che non deve rompere la riga' : `Contatto ${index}`,
    photoId: index % 5 === 4 ? null : `p${index}`,
    thumb: null,
    pinned: index === 0,
    unread: index === 1 ? 3 : 0,
    last: histories.get(id).at(-1),
  });
}

window.fakeTg = {
  calls,
  emit: (event) => emit(event),
  // Simula un messaggio in arrivo su una chat, come farebbe teleproto.
  incoming(chatId, text = 'Nuovo messaggio') {
    const message = {
      id: (nextId += 1),
      chatId,
      out: false,
      senderId: 'u1',
      senderName: 'Persona 1',
      date: Math.floor(Date.now() / 1000),
      edited: false,
      text,
      media: null,
    };
    histories.get(chatId).push(message);
    emit({ type: 'message', chatId, known: true, chat: null, message });
    return message;
  },
};

export async function connect({ session: saved, onSession, onEvent }) {
  session = saved;
  persistSession = onSession;
  emit = onEvent;
  if (localStorage.getItem('fake.offline')) throw new Error('offline');
}

export async function isAuthorized() {
  if (session !== 'sessione-finta') return false;
  persistSession(session);
  return true;
}

export function restartWithQr() {
  return Object.assign(new Error('QR'), { errorMessage: 'RESTART_AUTH_WITH_QR' });
}

export function restartWithPhone() {
  return Object.assign(new Error('Numero'), { errorMessage: 'RESTART_AUTH' });
}

async function qrLogin({ showQr, signal }) {
  await showQr('tg://login?token=dG9rZW4tZGktcHJvdmE');
  await new Promise((resolve, reject) => {
    window.fakeTg.scanQr = resolve;
    signal.addEventListener('abort', () => {
      reject(Object.assign(new Error('Annullato'), { name: 'AbortError' }));
    });
  });
}

// Riproduce il ciclo di client.start: chiede, riprova in caso di errore.
export async function login({ askPhone, askCode, askPassword, showQr, onError, signal }) {
  for (;;) {
    let phone;
    try {
      phone = await askPhone();
    } catch (error) {
      if (error.errorMessage !== 'RESTART_AUTH_WITH_QR') throw error;
      await qrLogin({ showQr, signal });
      break;
    }
    calls.push(['sendCode', phone]);
    let code;
    try {
      code = await askCode(true);
    } catch (error) {
      if (error.errorMessage === 'RESTART_AUTH') continue;
      throw error;
    }
    if (code !== VALID_CODE) {
      await onError({ errorMessage: 'PHONE_CODE_EXPIRED' });
      continue;
    }
    for (;;) {
      const password = await askPassword('nome del gatto');
      if (password === VALID_PASSWORD) break;
      await onError({ errorMessage: 'PASSWORD_HASH_INVALID' });
    }
    break;
  }
  session = 'sessione-finta';
  persistSession(session);
}

export async function getDialogs(cursor = null) {
  calls.push(['getDialogs', cursor]);
  const start = cursor?.index ?? 0;
  const dialogs = chats.slice(start, start + 40).map((chat) => ({ ...chat, last: histories.get(chat.id).at(-1) }));
  const end = start + dialogs.length;
  return { dialogs, next: end < chats.length ? { index: end } : null };
}

export async function getHistory(chatId, { beforeId = 0, limit = 30 } = {}) {
  calls.push(['getHistory', chatId, beforeId]);
  const history = histories.get(chatId);
  const older = beforeId ? history.filter((message) => message.id < beforeId) : history;
  return { messages: older.slice(-limit), hasMore: older.length > limit };
}

export async function sendMessage(chatId, text) {
  calls.push(['sendMessage', chatId, text]);
  if (localStorage.getItem('fake.sendFails')) throw new Error('rete');
  const message = {
    id: (nextId += 1),
    chatId,
    out: true,
    senderId: 'self',
    senderName: 'Tu',
    date: Math.floor(Date.now() / 1000),
    edited: false,
    text,
    media: null,
  };
  histories.get(chatId).push(message);
  // Telegram rimanda anche l'evento del proprio messaggio: non deve duplicarsi.
  setTimeout(() => emit({ type: 'message', chatId, known: true, chat: null, message }), 0);
  return message;
}

export async function markRead(chatId, maxId) {
  calls.push(['markRead', chatId, maxId]);
}

export async function downloadAvatar(chatId) {
  calls.push(['downloadAvatar', chatId]);
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  canvas.getContext('2d').fillRect(0, 0, 8, 8);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg'));
}

export async function catchUp() {
  calls.push(['catchUp']);
}

export async function logout() {
  calls.push(['logout']);
  session = '';
}
