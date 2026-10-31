import { h } from '../dom.js';
import { formatDay, formatTime, isSameDay } from '../format.js';

const PAGE = 30;
const GROUP_GAP_SECONDS = 600;
const NEAR_BOTTOM_PX = 80;

const root = document.documentElement;

function isNearBottom() {
  return window.innerHeight + window.scrollY >= root.scrollHeight - NEAR_BOTTOM_PX;
}

function scrollToEnd() {
  window.scrollTo(0, root.scrollHeight);
}

function fillBody(body, message) {
  const parts = [];
  if (message.media) parts.push(h('span', { class: 'msg-media' }, message.media));
  if (message.media && message.text) parts.push(' ');
  if (message.text) parts.push(message.text);
  const time = h('span', { class: 'msg-time' }, formatTime(message.date));
  if (message.edited) time.classList.add('msg-edited');
  body.replaceChildren(...parts, time);
}

function createMessage(message) {
  const day = h('p', { class: 'day', hidden: true });
  const sender = h('span', { class: 'msg-sender', hidden: true });
  const body = h('span', { class: 'msg-text' });
  const element = h('div', { class: message.out ? 'msg out' : 'msg' }, day, sender, body);
  fillBody(body, message);
  return { message, element, day, sender, body };
}

// Mostra mittente e giorno solo dove cambiano rispetto al messaggio precedente.
function decorate(entry, previous) {
  const { message } = entry;
  const newDay = !previous || !isSameDay(previous.message.date, message.date);
  const newGroup = newDay
    || previous.message.senderId !== message.senderId
    || message.date - previous.message.date > GROUP_GAP_SECONDS;
  entry.day.hidden = !newDay;
  if (newDay) entry.day.textContent = formatDay(message.date);
  entry.sender.hidden = !newGroup;
  entry.sender.textContent = message.senderName;
  entry.element.classList.toggle('first', newGroup);
}

export function createChatView({ tg, onRead }) {
  const entries = [];
  const byId = new Map();
  const drafts = new Map();
  let chatId = null;
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
  const sendButton = h('button', { type: 'button', onclick: send }, 'Invia');
  const element = h('section', { class: 'chat', hidden: true },
    h('header', { class: 'topbar' }, title),
    h('div', { class: 'messages' }, older, list),
    newBelow,
    error,
    h('div', { class: 'composer' }, field, sendButton));

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
    const entry = createMessage(message);
    decorate(entry, entries.at(-1));
    entries.push(entry);
    byId.set(message.id, entry);
    list.append(entry.element);
    return true;
  }

  function prepend(messages) {
    const fresh = messages.filter((message) => !byId.has(message.id)).map(createMessage);
    fresh.forEach((entry, index) => {
      decorate(entry, fresh[index - 1]);
      byId.set(entry.message.id, entry);
    });
    if (entries[0]) decorate(entries[0], fresh.at(-1));
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
    sendButton.textContent = 'Invio…';
    error.hidden = true;
    const target = chatId;
    try {
      const message = await tg.sendMessage(target, text);
      if (target === chatId) {
        field.value = '';
        draft = '';
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
      sendButton.textContent = 'Invia';
    }
  }

  async function open(chat) {
    session += 1;
    const current = session;
    chatId = chat.id;
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
      fillBody(entry.body, event.message);
    } else if (event.type === 'delete' && (event.chatId === null || event.chatId === chatId)) {
      for (const id of event.ids) {
        const entry = byId.get(id);
        if (!entry) continue;
        const index = entries.indexOf(entry);
        entries.splice(index, 1);
        byId.delete(id);
        entry.element.remove();
        if (entries[index]) decorate(entries[index], entries[index - 1]);
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
