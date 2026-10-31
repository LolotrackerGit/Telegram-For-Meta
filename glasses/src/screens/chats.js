import { h } from '../dom.js';
import { formatListDate, messagePreview } from '../format.js';

const REFRESH_DELAY_MS = 1500;

function createRow(onOpen, id) {
  const avatar = h('span', { class: 'avatar' });
  const name = h('span', { class: 'chat-name' });
  const time = h('span', { class: 'chat-time' });
  const preview = h('span', { class: 'chat-preview' });
  const badge = h('span', { class: 'chat-badge', hidden: true });
  const button = h('button', { type: 'button', class: 'chat-row', onclick: () => onOpen(id) },
    avatar,
    h('span', { class: 'chat-main' },
      h('span', { class: 'chat-line' }, name, time),
      h('span', { class: 'chat-line' }, preview, badge)));
  return { item: h('li', {}, button), button, avatar, name, time, preview, badge };
}

function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

function chatDate(chat) {
  return chat.last?.date ?? 0;
}

export function createChatList({ tg, avatars, onOpen, onLogout }) {
  const chats = new Map();
  const rows = new Map();
  let cursor = null;
  let refreshTimer = null;
  let openChatId = null;

  const list = h('ul', { class: 'chat-list' });
  const state = h('p', { class: 'list-state', role: 'status' }, 'Caricamento delle chat…');
  const more = h('button', { type: 'button', hidden: true, onclick: loadMore }, 'Altre chat');
  const exit = h('button', {
    type: 'button',
    onclick: confirmLogout,
    onblur: () => {
      exit.textContent = 'Esci';
    },
  }, 'Esci');
  const element = h('section', {},
    h('header', { class: 'topbar' }, h('h1', {}, 'Chat')),
    state,
    list,
    h('div', { class: 'list-end' }, more, exit));

  function confirmLogout() {
    if (exit.textContent === 'Esci') exit.textContent = 'Conferma: esci da Telegram';
    else onLogout();
  }

  function renderRow(chat) {
    let row = rows.get(chat.id);
    if (!row) {
      row = createRow(onOpen, chat.id);
      rows.set(chat.id, row);
    }
    setText(row.name, chat.title);
    setText(row.time, formatListDate(chatDate(chat)));
    setText(row.preview, messagePreview(chat.last));
    setText(row.badge, chat.unread > 99 ? '99+' : String(chat.unread));
    row.badge.hidden = chat.unread === 0;
    row.button.setAttribute('aria-label', `${chat.title}${chat.unread ? `, ${chat.unread} non letti` : ''}`);
    avatars.attach(row.avatar, chat);
    return row;
  }

  // Sposta solo le righe fuori posto. Spostare un nodo gli toglie il focus,
  // quindi moveBefore o una focus() immediata lo conservano.
  function moveRow(item, before) {
    const active = document.activeElement;
    const holdsFocus = item.contains(active);
    if (list.moveBefore && item.isConnected) list.moveBefore(item, before);
    else list.insertBefore(item, before);
    if (holdsFocus) {
      if (document.activeElement !== active) active.focus({ preventScroll: true });
      active.scrollIntoView({ block: 'nearest' });
    }
  }

  function placeRows() {
    const ordered = [...chats.values()].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.pinned) return a.pinOrder - b.pinOrder;
      return chatDate(b) - chatDate(a);
    });
    ordered.forEach((chat, index) => {
      const { item } = rows.get(chat.id);
      const current = list.children[index] ?? null;
      if (current !== item) moveRow(item, current);
    });
  }

  function merge(dialogs, startIndex = 0) {
    dialogs.forEach((dialog, index) => {
      const chat = { ...chats.get(dialog.id), ...dialog, pinOrder: startIndex + index };
      if (chat.id === openChatId) chat.unread = 0;
      chats.set(chat.id, chat);
      renderRow(chat);
    });
    placeRows();
  }

  async function loadPage(pageCursor) {
    const page = await tg.getDialogs(pageCursor);
    merge(page.dialogs, chats.size);
    if (!pageCursor) cursor = cursor ?? page.next;
    else cursor = page.next;
    more.hidden = !cursor;
    state.hidden = chats.size > 0;
    if (chats.size === 0) state.textContent = 'Nessuna chat.';
  }

  async function load() {
    try {
      await loadPage(null);
    } catch {
      state.textContent = 'Impossibile caricare le chat. Riprovo alla riconnessione.';
      throw new Error('load');
    }
  }

  async function loadMore() {
    more.textContent = 'Caricamento…';
    const firstNew = chats.size;
    try {
      await loadPage(cursor);
      list.children[firstNew]?.querySelector('button')?.focus({ preventScroll: true });
    } catch {
      // Il pulsante resta disponibile per un nuovo tentativo.
    }
    more.textContent = 'Altre chat';
  }

  // Un solo giro di richiesta anche se arrivano più eventi insieme.
  function refreshSoon() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => loadPage(null).catch(() => {}), REFRESH_DELAY_MS);
  }

  function applyEvent(event) {
    switch (event.type) {
      case 'message':
      case 'edit': {
        const known = chats.get(event.chatId);
        if (!known) {
          if (event.type === 'message') refreshSoon();
          return;
        }
        if (event.type === 'edit') {
          if (known.last?.id !== event.message.id) return;
          known.last = event.message;
          renderRow(known);
          return;
        }
        known.last = event.message;
        if (!event.message.out && event.chatId !== openChatId) known.unread += 1;
        renderRow(known);
        placeRows();
        break;
      }
      case 'read': {
        const known = chats.get(event.chatId);
        if (!known) return;
        known.unread = event.chatId === openChatId ? 0 : event.unread;
        renderRow(known);
        break;
      }
      case 'delete':
      case 'resync':
        refreshSoon();
        break;
      default:
    }
  }

  return {
    element,
    load,
    applyEvent,
    get: (id) => chats.get(id),
    setOpenChat(id) {
      openChatId = id;
      const known = chats.get(id);
      if (known?.unread) {
        known.unread = 0;
        renderRow(known);
      }
    },
    focusFirst() {
      list.querySelector('button')?.focus({ preventScroll: true });
    },
    focusChat(id) {
      (rows.get(id)?.button ?? list.querySelector('button'))?.focus({ preventScroll: true });
    },
  };
}
