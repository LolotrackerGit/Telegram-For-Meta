import { h } from './dom.js';
import { initials } from './format.js';

const CACHE_NAME = 'tgocchiali-avatars-v1';
const PAUSE_BETWEEN_DOWNLOADS_MS = 150;

function cacheKey(photoId) {
  return `avatar/${photoId}.jpg`;
}

function openCache() {
  if (!('caches' in window)) return Promise.resolve(null);
  return caches.open(CACHE_NAME).catch(() => null);
}

export function clearAvatarCache() {
  if ('caches' in window) return caches.delete(CACHE_NAME).catch(() => false);
  return Promise.resolve(false);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Le foto si scaricano una alla volta e solo per le righe che entrano in vista.
export function createAvatars(download) {
  const urls = new Map();
  const attempted = new Set();
  const queue = [];
  const cache = openCache();
  let draining = false;

  function show(holder, url) {
    const old = holder.querySelector('img');
    if (old?.src === url) return;
    const image = h('img', { alt: '', decoding: 'async', src: url, onerror: () => image.remove() });
    old?.remove();
    holder.append(image);
  }

  async function load(holder, chat) {
    const key = chat.photoId;
    const store = await cache;
    const hit = await store?.match(cacheKey(key)).catch(() => null);
    if (hit) return URL.createObjectURL(await hit.blob());
    const blob = await download(chat.id);
    if (!blob) return null;
    await store?.put(cacheKey(key), new Response(blob)).catch(() => {});
    return URL.createObjectURL(blob);
  }

  async function drain() {
    if (draining) return;
    draining = true;
    while (queue.length) {
      const { holder, chat } = queue.shift();
      try {
        const url = await load(holder, chat);
        if (url) {
          urls.set(chat.photoId, url);
          if (holder.dataset.photo === chat.photoId) show(holder, url);
        }
      } catch (error) {
        if (error?.seconds) await sleep(error.seconds * 1000);
      }
      await sleep(PAUSE_BETWEEN_DOWNLOADS_MS);
    }
    draining = false;
  }

  const observer = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
      for (const { isIntersecting, target } of entries) {
        if (!isIntersecting) continue;
        observer.unobserve(target);
        const { chat } = target;
        if (!attempted.has(chat.photoId)) {
          attempted.add(chat.photoId);
          queue.push({ holder: target, chat });
          drain();
        }
      }
    }, { rootMargin: '200px 0px' })
    : null;

  return {
    // Iniziali subito, miniatura inclusa quando c'è, foto vera appena disponibile.
    attach(holder, chat) {
      if (holder.dataset.photo === (chat.photoId ?? '') && holder.textContent) return;
      holder.dataset.photo = chat.photoId ?? '';
      holder.chat = chat;
      holder.replaceChildren(initials(chat.title));
      if (!chat.photoId) return;
      if (urls.has(chat.photoId)) {
        show(holder, urls.get(chat.photoId));
        return;
      }
      if (chat.thumb) show(holder, URL.createObjectURL(new Blob([chat.thumb], { type: 'image/jpeg' })));
      observer?.observe(holder);
    },
  };
}
