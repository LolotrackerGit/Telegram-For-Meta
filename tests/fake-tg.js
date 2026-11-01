// Stessa interfaccia di glasses/src/tg/client.js, con dati finti in memoria.
// Entra solo nella build dei test: `node build.mjs --fake`.
const CHATS = 50;
const HISTORY = 95;
const VALID_CODE = '11111';
const VALID_PASSWORD = 'segreta';
const GROUP_MEMBERS = [
  ['u1', 'Giulia Rossi'],
  ['u2', 'Marco Bianchi'],
  ['u3', 'Ivan Petrov'],
];
const SAMPLES = [
  'Ciao, come va?',
  'Ci vediamo domani alle nove davanti alla stazione, così andiamo insieme',
  'Ok',
  'Привет! Как дела?',
  'Ho guardato il documento che mi hai mandato: mi sembra tutto a posto, tranne l’ultima pagina che secondo me va riscritta da capo',
  'Perfetto, grazie mille',
];
const OUT_LAST_READ = 3;
const OUT_LAST_UNREAD = 6;
const CHANNEL_INDEX = 7;

const now = Math.floor(Date.now() / 1000);
const calls = [];
const chats = [];
const histories = new Map();
let emit = () => {};
let persistSession = () => {};
let session = '';
let nextId = 10_000;
let releaseAvatars = () => {};

function chatTypeAt(index) {
  if (index === CHANNEL_INDEX) return 'channel';
  return index === 2 || index === 8 ? 'group' : 'private';
}

function titleAt(index) {
  if (index === 2) return 'Gruppo con un nome davvero molto lungo che non deve rompere la riga';
  if (index === CHANNEL_INDEX) return 'Canale 7';
  return `Contatto ${index}`;
}

function senderOf(chat, id) {
  if (chat.type === 'group') return GROUP_MEMBERS[Math.floor(id / 2) % GROUP_MEMBERS.length];
  return [chat.id, chat.title];
}

function outgoing(chatId, id, text, date) {
  return {
    id,
    chatId,
    out: true,
    senderId: 'self',
    senderName: 'Tu',
    senderShort: 'Tu',
    date,
    edited: false,
    text,
    media: null,
  };
}

function buildHistory(chat) {
  const messages = [];
  for (let id = 1; id <= HISTORY; id += 1) {
    const date = now - (HISTORY - id) * 200;
    const text = SAMPLES[id % SAMPLES.length];
    if (id % 4 === 0 && chat.type !== 'channel') {
      messages.push(outgoing(chat.id, id, text, date));
    } else {
      const [senderId, senderName] = senderOf(chat, id);
      messages.push({
        id,
        chatId: chat.id,
        out: false,
        senderId,
        senderName,
        senderShort: senderName.split(' ')[0],
        date,
        edited: false,
        text: id % 11 === 0 ? '' : text,
        media: id % 11 === 0 ? '📷 Foto' : null,
      });
    }
  }
  return messages;
}

for (let index = 0; index < CHATS; index += 1) {
  const chat = {
    id: String(1000 + index),
    title: titleAt(index),
    type: chatTypeAt(index),
    photoId: index % 5 === 4 ? null : `p${index}`,
    thumb: null,
    pinned: index === 0,
    unread: index === 1 ? 3 : 0,
    readOutboxMaxId: 90,
  };
  const history = buildHistory(chat);
  if (index === OUT_LAST_READ || index === OUT_LAST_UNREAD) {
    history.push(outgoing(chat.id, HISTORY + 1, 'Va bene, a dopo', now));
  }
  if (index === OUT_LAST_READ) chat.readOutboxMaxId = HISTORY + 1;
  histories.set(chat.id, history);
  chats.push(chat);
}

window.fakeTg = {
  calls,
  emit: (event) => emit(event),
  // Simula un messaggio in arrivo su una chat, come farebbe teleproto.
  incoming(chatId, text = 'Nuovo messaggio') {
    const chat = chats.find((item) => item.id === chatId);
    const [senderId, senderName] = senderOf(chat, 1);
    const message = {
      id: (nextId += 1),
      chatId,
      out: false,
      senderId,
      senderName,
      senderShort: senderName.split(' ')[0],
      date: Math.floor(Date.now() / 1000),
      edited: false,
      text,
      media: null,
    };
    histories.get(chatId).push(message);
    emit({ type: 'message', chatId, known: true, chat: null, message });
    return message;
  },
  readOutbox(chatId, maxId) {
    chats.find((item) => item.id === chatId).readOutboxMaxId = maxId;
    emit({ type: 'read-outbox', chatId, maxId });
  },
  releaseAvatars: () => releaseAvatars(),
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
  const message = outgoing(chatId, (nextId += 1), text, Math.floor(Date.now() / 1000));
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
  if (localStorage.getItem('fake.holdAvatars')) {
    await new Promise((resolve) => {
      releaseAvatars = resolve;
    });
  }
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const context = canvas.getContext('2d');
  context.fillStyle = `hsl(${(Number(chatId) * 47) % 360} 60% 60%)`;
  context.fillRect(0, 0, 8, 8);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg'));
}

export async function catchUp() {
  calls.push(['catchUp']);
}

export async function logout() {
  calls.push(['logout']);
  session = '';
}
