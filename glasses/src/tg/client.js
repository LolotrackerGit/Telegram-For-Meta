// Unico modulo che conosce teleproto: le schermate vedono solo oggetti semplici.
import './shims/globals.js';
import { Api, Logger, TelegramClient, WebSocketTransport, utils } from 'teleproto';
import { DeletedMessage, EditedMessage, MessageRead, NewMessage } from 'teleproto/events';
import { StringSession } from 'teleproto/sessions';
import bigInt from 'big-integer';
import { mediaLabel } from '../format.js';

const DIALOG_PAGE = 40;
const AUTH_LOST = new Set([
  'AUTH_KEY_UNREGISTERED',
  'AUTH_KEY_INVALID',
  'SESSION_REVOKED',
  'SESSION_EXPIRED',
  'USER_DEACTIVATED',
  'USER_DEACTIVATED_BAN',
]);

let client;
let credentials;
let persistSession;
let selfId = null;
let emit = () => {};

// Cache delle entità: ogni risposta di Telegram include utenti e chat citati.
const entities = new Map();

function remember(items = []) {
  for (const entity of items) {
    if (entity?.className?.endsWith('Empty')) continue;
    if (entity?.id !== undefined) entities.set(utils.getPeerId(entity), entity);
  }
}

function displayName(entity) {
  if (!entity) return 'Sconosciuto';
  if (entity.className === 'User') {
    if (entity.self) return 'Messaggi salvati';
    if (entity.deleted) return 'Account eliminato';
    return [entity.firstName, entity.lastName].filter(Boolean).join(' ') || 'Senza nome';
  }
  return entity.title || 'Senza nome';
}

function senderLabel(entity) {
  return entity?.className === 'User' && entity.self ? 'Tu' : displayName(entity);
}

function translateError(error) {
  const code = error?.errorMessage;
  if (AUTH_LOST.has(code)) {
    emit({ type: 'auth-lost' });
  } else if (error?.seconds && error?.code === 420) {
    emit({ type: 'flood', seconds: error.seconds });
  }
  return error;
}

async function guarded(action) {
  try {
    return await action();
  } catch (error) {
    throw translateError(error);
  }
}

function invoke(request) {
  return guarded(() => client.invoke(request));
}

function toChatSummary(id, entity) {
  const photo = entity?.photo;
  const stripped = photo?.strippedThumb;
  return {
    id,
    title: displayName(entity),
    photoId: photo?.photoId?.toString() ?? null,
    thumb: stripped ? new Uint8Array(utils.strippedPhotoToJpg(stripped)) : null,
  };
}

function toMessage(raw, chatId) {
  const service = raw.className === 'MessageService';
  const fromPeer = raw.fromId ?? raw.peerId;
  const senderId = raw.out && selfId ? selfId : utils.getPeerId(fromPeer);
  return {
    id: raw.id,
    chatId,
    out: Boolean(raw.out),
    senderId,
    senderName: raw.out ? 'Tu' : senderLabel(entities.get(senderId)),
    date: raw.date,
    edited: Boolean(raw.editDate && !raw.editHide),
    text: service ? 'ℹ️ Evento della chat' : raw.message || '',
    media: service ? null : mediaLabel(raw.media),
  };
}

function toDialog(dialog, topMessages) {
  const id = utils.getPeerId(dialog.peer);
  const raw = topMessages.get(`${id}:${dialog.topMessage}`);
  return {
    ...toChatSummary(id, entities.get(id)),
    pinned: Boolean(dialog.pinned),
    unread: dialog.unreadCount || (dialog.unreadMark ? 1 : 0),
    last: raw ? toMessage(raw, id) : null,
  };
}

function wireEvents() {
  const onMessage = (type) => (event) => {
    const { message } = event;
    remember([message.sender, message.chat]);
    const chatId = utils.getPeerId(message.peerId);
    emit({
      type,
      chatId,
      known: entities.has(chatId),
      chat: toChatSummary(chatId, entities.get(chatId)),
      message: toMessage(message, chatId),
    });
  };
  client.addEventHandler(onMessage('message'), new NewMessage({}));
  client.addEventHandler(onMessage('edit'), new EditedMessage({}));

  client.addEventHandler((event) => {
    emit({
      type: 'delete',
      chatId: event.peer ? utils.getPeerId(event.peer) : null,
      ids: event.deletedIds,
    });
  }, new DeletedMessage({}));

  client.addEventHandler((event) => {
    if (event.outbox || event.contents) return;
    const update = event.originalUpdate;
    emit({
      type: 'read',
      chatId: utils.getPeerId(event.chatPeer ?? update.peer),
      unread: update.stillUnreadCount ?? 0,
    });
  }, new MessageRead({}));

  client.onReconnecting(() => emit({ type: 'state', online: false }));
  client.onReconnect(() => {
    // teleproto ha già recuperato gli aggiornamenti persi prima di questo evento.
    emit({ type: 'state', online: true });
    emit({ type: 'resync' });
  });
}

export async function connect({ apiId, apiHash, session, onSession, onEvent }) {
  credentials = { apiId, apiHash };
  persistSession = onSession;
  emit = onEvent;
  client = new TelegramClient(new StringSession(session), apiId, apiHash, {
    transport: new WebSocketTransport(),
    baseLogger: new Logger('none'),
    connectionRetries: 5,
    deviceModel: 'Meta Ray-Ban Display',
    systemVersion: 'Web',
    appVersion: '2.0',
    langCode: 'it',
    systemLangCode: 'it',
  });
  await client.connect();
  wireEvents();
}

// Una rete assente deve restare un errore: solo Telegram può dire che la
// sessione non vale più. Si salva qui per non conservare chiavi mai autorizzate.
export async function isAuthorized() {
  let me;
  try {
    me = await client.invoke(new Api.users.GetUsers({ id: [new Api.InputUserSelf()] }));
  } catch (error) {
    if (error?.code === 401 || AUTH_LOST.has(error?.errorMessage)) return false;
    throw error;
  }
  remember(me);
  selfId = utils.getPeerId(me[0]);
  persistSession(client.session.save());
  return true;
}

function base64Url(bytes) {
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Il flusso di teleproto attende le risposte tramite questi callback.
// Un errore RESTART_AUTH_WITH_QR da askPhone passa al QR.
export async function login({ askPhone, askCode, askPassword, showQr, onError, signal }) {
  await client.start({
    phoneNumber: askPhone,
    phoneCode: (viaApp) => askCode(viaApp),
    password: askPassword,
    qrCode: ({ token }) => showQr(`tg://login?token=${base64Url(token)}`),
    onError,
    abortSignal: signal,
  });
  if (!(await isAuthorized())) throw new Error('Accesso non completato');
}

export function restartWithQr() {
  return Object.assign(new Error('QR'), { errorMessage: 'RESTART_AUTH_WITH_QR' });
}

export function restartWithPhone() {
  return Object.assign(new Error('Numero'), { errorMessage: 'RESTART_AUTH' });
}

export async function getDialogs(cursor = null) {
  const result = await invoke(new Api.messages.GetDialogs({
    folderId: 0,
    excludePinned: cursor !== null,
    offsetDate: cursor?.date ?? 0,
    offsetId: cursor?.messageId ?? 0,
    offsetPeer: cursor ? entityToInput(cursor.chatId) : new Api.InputPeerEmpty(),
    limit: DIALOG_PAGE,
    hash: bigInt.zero,
  }));
  remember(result.users);
  remember(result.chats);
  const topMessages = new Map();
  for (const message of result.messages) {
    if (message.peerId) topMessages.set(`${utils.getPeerId(message.peerId)}:${message.id}`, message);
  }
  const dialogs = result.dialogs
    .filter((dialog) => dialog.className === 'Dialog')
    .map((dialog) => toDialog(dialog, topMessages));
  const tail = dialogs.at(-1);
  const hasMore = result.className === 'messages.DialogsSlice' && dialogs.length === DIALOG_PAGE;
  return {
    dialogs,
    next: hasMore && tail?.last
      ? { date: tail.last.date, messageId: tail.last.id, chatId: tail.id }
      : null,
  };
}

function entityToInput(chatId) {
  return utils.getInputPeer(entities.get(chatId));
}

export async function getHistory(chatId, { beforeId = 0, limit = 30 } = {}) {
  const result = await invoke(new Api.messages.GetHistory({
    peer: entityToInput(chatId),
    offsetId: beforeId,
    offsetDate: 0,
    addOffset: 0,
    limit,
    maxId: 0,
    minId: 0,
    hash: bigInt.zero,
  }));
  remember(result.users);
  remember(result.chats);
  const messages = result.messages
    .filter((message) => message.className !== 'MessageEmpty')
    .map((message) => toMessage(message, chatId))
    .reverse();
  return { messages, hasMore: messages.length === limit };
}

export async function sendMessage(chatId, text) {
  const sent = await guarded(() => client.sendMessage(entityToInput(chatId), { message: text }));
  return toMessage(sent, chatId);
}

export function markRead(chatId, maxId) {
  return guarded(() => client.markAsRead(entityToInput(chatId), undefined, { maxId }));
}

export async function downloadAvatar(chatId) {
  const entity = entities.get(chatId);
  if (!entity?.photo) return null;
  const bytes = await guarded(() => client.downloadProfilePhoto(entity, { isBig: false }));
  return bytes?.length ? new Blob([bytes], { type: 'image/jpeg' }) : null;
}

export async function catchUp() {
  if (client.connected) await guarded(() => client.catchUp());
}

export function logout() {
  return client.logOut();
}
