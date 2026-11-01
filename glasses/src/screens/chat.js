import { h, icon } from '../dom.js';
import { colorIndex, formatDay, formatTime, isSameDay } from '../format.js';
import { createKeyboard } from '../keyboard.js';
import { loadChatLayout, saveChatLayout } from '../storage.js';

const PAGE = 30;
const GROUP_GAP_SECONDS = 600;
const NEAR_BOTTOM_PX = 80;

const QUICK_REPLIES = ['Ok', 'Sì', 'No', 'Arrivo', 'Ti chiamo dopo', 'Grazie'];
const QUICK_REPLIES_RU = ['Ок', 'Да', 'Нет', 'Еду', 'Перезвоню', 'Спасибо'];
const QUICK_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🙏', '👋', '🔥'];

const ICON_SEND = 'M3 20.5 22 12 3 3.5v6.6L15 12 3 13.9z';
const ICON_KEYBOARD = 'M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm2 3v2h2V9H5zm4 0v2h2V9H9zm4 0v2h2V9h-2zm4 0v2h2V9h-2zM5 13v2h2v-2H5zm3.5 0v2h7v-2h-7zM17 13v2h2v-2h-2z';

const root = document.documentElement;

function isNearBottom() {
  return window.innerHeight + window.scrollY >= root.scrollHeight - NEAR_BOTTOM_PX;
}

function scrollToEnd() {
  window.scrollTo(0, root.scrollHeight);
}

// Toglie l'ultimo carattere visibile: un'emoji può occupare più punti di codice.
function dropLastCharacter(text) {
  const parts = 'Segmenter' in Intl
    ? Array.from(new Intl.Segmenter().segment(text), (part) => part.segment)
    : Array.from(text);
  return parts.slice(0, -1).join('');
}

function metaParts(message, read) {
  const time = h('span', { class: message.edited ? 'msg-time msg-edited' : 'msg-time' }, formatTime(message.date));
  if (!message.out) return [time];
  const ticks = h('span', { class: read ? 'msg-ticks read' : 'msg-ticks' }, read ? '✓✓' : '✓');
  ticks.setAttribute('aria-label', read ? 'Letto' : 'Inviato');
  return [time, ticks];
}

// L'ora vera sta nell'angolo della bolla. La copia invisibile a fine testo le
// riserva lo spazio, e lo spazio unificatore la tiene legata all'ultima parola.
function fillBody(entry, readUpTo) {
  const { message, body, meta } = entry;
  const read = message.out && message.id <= readUpTo;
  const parts = [];
  if (message.media) parts.push(h('span', { class: 'msg-media' }, message.media));
  if (message.media && message.text) parts.push(' ');
  if (message.text) parts.push(message.text);
  const ghost = h('span', { class: 'msg-meta-ghost', 'aria-hidden': 'true' }, ...metaParts(message, read));
  body.replaceChildren(...parts, '\u00a0', ghost);
  meta.replaceChildren(...metaParts(message, read));
  entry.read = read;
}

function createMessage(message, readUpTo) {
  const day = h('p', { class: 'day', hidden: true });
  const sender = h('span', { class: `msg-sender peer-${colorIndex(message.senderId)}`, hidden: true });
  const body = h('span', { class: 'msg-text' });
  const meta = h('span', { class: 'msg-meta' });
  const bubble = h('div', { class: 'bubble' }, sender, body, meta);
  const element = h('div', { class: message.out ? 'msg out' : 'msg' }, day, bubble);
  const entry = { message, element, day, sender, body, meta, read: false };
  fillBody(entry, readUpTo);
  return entry;
}

// Il mittente compare solo nei gruppi, sulla prima bolla di ogni serie.
function decorate(entry, previous, showNames) {
  const { message } = entry;
  const newDay = !previous || !isSameDay(previous.message.date, message.date);
  const newGroup = newDay
    || previous.message.senderId !== message.senderId
    || message.date - previous.message.date > GROUP_GAP_SECONDS;
  entry.day.hidden = !newDay;
  if (newDay) entry.day.textContent = formatDay(message.date);
  entry.sender.hidden = !(newGroup && showNames && !message.out);
  entry.sender.textContent = message.senderName;
  entry.element.classList.toggle('first', newGroup);
}

export function createChatView({ tg, onRead }) {
  const entries = [];
  const byId = new Map();
  const drafts = new Map();
  let chatId = null;
  let showNames = false;
  let readUpTo = 0;
  let session = 0;
  let hasMore = false;
  let loadingOlder = false;
  let sending = false;
  let draft = '';
  let unseen = 0;

  const title = h('h1');
  const older = h('p', { class: 'older' });
  const list = h('div');
  const newBelow = h('p', { class: 'new-below', role: 'status', hidden: true });
  const error = h('p', { class: 'composer-error', role: 'alert', hidden: true });
  const onDraft = (event) => {
    draft = event.target.value;
  };
  const field = h('textarea', {
    rows: 1,
    placeholder: 'Messaggio',
    'aria-label': 'Messaggio',
    oninput: onDraft,
    onchange: onDraft,
  });
  const sendButton = h('button', { type: 'button', class: 'send', 'aria-label': 'Invia', onclick: send }, icon(ICON_SEND));
  const moreButton = h('button', {
    type: 'button',
    class: 'more',
    'aria-label': 'Altre opzioni',
    'aria-expanded': 'false',
    onclick: toggleTools,
  }, '+');
  const keyboardButton = h('button', {
    type: 'button',
    class: 'more',
    'aria-label': 'Tastiera dell’app',
    'aria-expanded': 'false',
    onclick: toggleKeyboard,
  }, icon(ICON_KEYBOARD));
  const chip = (text) => h('button', { type: 'button', onclick: () => insertText(text) }, text);
  const quickReplies = h('div', { class: 'chips' });
  const tools = h('div', { class: 'tools', hidden: true },
    quickReplies,
    h('div', { class: 'chips' }, ...QUICK_EMOJI.map(chip)));
  const keyboard = createKeyboard({
    getText: () => draft,
    onInsert: (text) => setDraft(draft + text),
    onDelete: () => setDraft(dropLastCharacter(draft)),
    onLayout: (layout) => saveChatLayout(chatId, layout),
    onClose: closeKeyboard,
  });
  const composer = h('div', { class: 'composer' },
    h('div', { class: 'composer-field' }, moreButton, keyboardButton, field),
    sendButton);
  const element = h('section', { class: 'chat', hidden: true },
    h('header', { class: 'topbar' }, title),
    h('div', { class: 'messages' }, older, list),
    h('footer', { class: 'dock' }, newBelow, error, tools, keyboard.element, composer));

  function setDraft(text) {
    draft = text;
    field.value = text;
    field.scrollTop = field.scrollHeight;
  }

  // Senza altri tasti in una direzione il browser farebbe scorrere la pagina:
  // finché un pannello è aperto la chat resta ferma.
  function syncPageLock() {
    root.classList.toggle('panel-open', !tools.hidden || keyboard.isOpen);
  }

  function setToolsOpen(open) {
    tools.hidden = !open;
    moreButton.textContent = open ? '×' : '+';
    moreButton.setAttribute('aria-expanded', String(open));
    syncPageLock();
  }

  // Un pannello copre il fondo della chat: chi era in fondo deve vedere ancora
  // gli ultimi messaggi.
  function keepEnd(change) {
    const follow = isNearBottom();
    change();
    if (follow) scrollToEnd();
  }

  function toggleTools() {
    const open = tools.hidden;
    keepEnd(() => {
      setKeyboardOpen(false);
      if (open) {
        const replies = loadChatLayout(chatId) === 'ru' ? QUICK_REPLIES_RU : QUICK_REPLIES;
        quickReplies.replaceChildren(...replies.map(chip));
      }
      setToolsOpen(open);
      if (open) tools.querySelector('button').focus({ preventScroll: true });
    });
  }

  function setKeyboardOpen(open) {
    if (open) keyboard.open(loadChatLayout(chatId));
    else keyboard.close();
    keyboardButton.setAttribute('aria-expanded', String(open));
    syncPageLock();
  }

  function toggleKeyboard() {
    const open = !keyboard.isOpen;
    keepEnd(() => {
      setToolsOpen(false);
      setKeyboardOpen(open);
    });
  }

  function closeKeyboard() {
    setKeyboardOpen(false);
    (draft ? sendButton : field).focus({ preventScroll: true });
  }

  // Le frasi pronte finiscono nel campo: l'invio resta una scelta esplicita.
  function insertText(text) {
    setDraft(draft.trim() ? `${draft.trim()} ${text}` : text);
    setToolsOpen(false);
    sendButton.focus({ preventScroll: true });
  }

  const observer = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) loadOlder();
  }, { rootMargin: '240px 0px 0px' });

  function setOlderLabel() {
    older.textContent = hasMore ? 'Caricamento…' : 'Inizio della conversazione';
  }

  function watchOlder() {
    // Ripartire da capo fa scattare l'osservatore se la cima è ancora visibile.
    observer.unobserve(older);
    if (chatId !== null && hasMore) observer.observe(older);
  }

  function reset() {
    entries.length = 0;
    byId.clear();
    list.replaceChildren();
    hasMore = false;
    unseen = 0;
    newBelow.hidden = true;
    error.hidden = true;
  }

  function latestId() {
    return entries.at(-1)?.message.id ?? 0;
  }

  function markRead() {
    const id = latestId();
    if (!id || document.visibilityState !== 'visible') return;
    onRead(chatId);
    tg.markRead(chatId, id).catch(() => {});
  }

  function append(message) {
    if (byId.has(message.id)) return false;
    const entry = createMessage(message, readUpTo);
    decorate(entry, entries.at(-1), showNames);
    entries.push(entry);
    byId.set(message.id, entry);
    list.append(entry.element);
    return true;
  }

  function prepend(messages) {
    const fresh = messages
      .filter((message) => !byId.has(message.id))
      .map((message) => createMessage(message, readUpTo));
    fresh.forEach((entry, index) => {
      decorate(entry, fresh[index - 1], showNames);
      byId.set(entry.message.id, entry);
    });
    if (entries[0]) decorate(entries[0], fresh.at(-1), showNames);
    list.prepend(...fresh.map((entry) => entry.element));
    entries.unshift(...fresh);
  }

  async function loadOlder() {
    if (loadingOlder || !hasMore) return;
    loadingOlder = true;
    const current = session;
    try {
      const page = await tg.getHistory(chatId, { beforeId: entries[0]?.message.id ?? 0, limit: PAGE });
      if (current !== session) return;
      const height = root.scrollHeight;
      const top = window.scrollY;
      prepend(page.messages);
      hasMore = page.hasMore;
      setOlderLabel();
      window.scrollTo(0, top + root.scrollHeight - height);
    } catch {
      if (current === session) older.textContent = 'Impossibile caricare i messaggi precedenti.';
    } finally {
      loadingOlder = false;
      if (current === session) watchOlder();
    }
  }

  function showNewBelow() {
    newBelow.textContent = unseen === 1 ? '1 nuovo messaggio ↓' : `${unseen} nuovi messaggi ↓`;
    newBelow.hidden = unseen === 0;
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    sending = true;
    sendButton.classList.add('sending');
    error.hidden = true;
    const target = chatId;
    try {
      const message = await tg.sendMessage(target, text);
      if (target === chatId) {
        setDraft('');
        keyboard.refresh();
        append(message);
        scrollToEnd();
      }
    } catch (failure) {
      error.textContent = failure?.seconds
        ? `Telegram chiede di attendere ${failure.seconds} secondi. Il testo è rimasto nel campo.`
        : 'Invio non riuscito. Il testo è rimasto nel campo.';
      error.hidden = false;
    } finally {
      sending = false;
      sendButton.classList.remove('sending');
    }
  }

  async function open(chat) {
    session += 1;
    const current = session;
    chatId = chat.id;
    showNames = chat.type === 'group';
    readUpTo = chat.readOutboxMaxId;
    reset();
    title.textContent = chat.title;
    draft = drafts.get(chat.id) ?? '';
    field.value = draft;
    older.textContent = 'Caricamento…';
    element.hidden = false;
    field.focus({ preventScroll: true });
    try {
      const page = await tg.getHistory(chat.id, { limit: PAGE });
      if (current !== session) return;
      page.messages.forEach(append);
      hasMore = page.hasMore;
      setOlderLabel();
      scrollToEnd();
      markRead();
      watchOlder();
    } catch {
      if (current === session) older.textContent = 'Impossibile caricare i messaggi.';
    }
  }

  function close() {
    if (chatId === null) return;
    drafts.set(chatId, draft);
    setToolsOpen(false);
    setKeyboardOpen(false);
    session += 1;
    observer.unobserve(older);
    chatId = null;
    element.hidden = true;
    reset();
  }

  // Dopo una caduta di rete recupera solo ciò che manca in coda alla conversazione.
  async function resync() {
    if (chatId === null) return;
    const current = session;
    const follow = isNearBottom();
    try {
      const page = await tg.getHistory(chatId, { limit: PAGE });
      if (current !== session) return;
      const added = page.messages.filter((message) => message.id > latestId() && append(message));
      if (!added.length) return;
      if (follow) {
        scrollToEnd();
        markRead();
      } else {
        unseen += added.length;
        showNewBelow();
      }
    } catch {
      // Il prossimo evento di riconnessione riproverà.
    }
  }

  function receive(message) {
    const follow = isNearBottom();
    if (!append(message)) return;
    if (follow) scrollToEnd();
    else if (!message.out) {
      unseen += 1;
      showNewBelow();
    }
    if (!message.out && follow) markRead();
  }

  function applyEvent(event) {
    if (chatId === null) return;
    if (event.type === 'resync') {
      resync();
    } else if (event.type === 'message' && event.chatId === chatId) {
      receive(event.message);
    } else if (event.type === 'edit' && event.chatId === chatId) {
      const entry = byId.get(event.message.id);
      if (!entry) return;
      entry.message = event.message;
      fillBody(entry, readUpTo);
    } else if (event.type === 'read-outbox' && event.chatId === chatId) {
      readUpTo = Math.max(readUpTo, event.maxId);
      for (const entry of entries) {
        if (entry.message.out && !entry.read && entry.message.id <= readUpTo) fillBody(entry, readUpTo);
      }
    } else if (event.type === 'delete' && (event.chatId === null || event.chatId === chatId)) {
      for (const id of event.ids) {
        const entry = byId.get(id);
        if (!entry) continue;
        const index = entries.indexOf(entry);
        entries.splice(index, 1);
        byId.delete(id);
        entry.element.remove();
        if (entries[index]) decorate(entries[index], entries[index - 1], showNames);
      }
    }
  }

  window.addEventListener('scroll', () => {
    if (chatId !== null && unseen && isNearBottom()) {
      unseen = 0;
      showNewBelow();
      markRead();
    }
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (chatId !== null && isNearBottom()) markRead();
  });

  return { element, open, close, applyEvent, get chatId() { return chatId; } };
}
