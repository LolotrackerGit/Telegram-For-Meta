// localStorage con prefisso: l'origine github.io è condivisa con gli altri
// progetti Pages dello stesso account. Ogni accesso può fallire o restituire
// dati spariti, quindi nessun errore arriva mai al chiamante.
const PREFIX = 'tgocchiali.';

function read(key) {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, value);
    return true;
  } catch {
    return false;
  }
}

function remove(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // Niente da fare: al prossimo avvio il dato verrà trattato come assente.
  }
}

export function isValidCredentials(apiId, apiHash) {
  return /^\d{3,12}$/.test(apiId) && /^[0-9a-f]{32}$/i.test(apiHash);
}

export function loadCredentials() {
  const apiId = read('api_id');
  const apiHash = read('api_hash');
  if (!apiId || !apiHash || !isValidCredentials(apiId, apiHash)) return null;
  return { apiId: Number(apiId), apiHash };
}

export function saveCredentials(apiId, apiHash) {
  return write('api_id', apiId) && write('api_hash', apiHash);
}

export function clearCredentials() {
  remove('api_id');
  remove('api_hash');
}

// Legge #api_id=...&api_hash=... una sola volta e toglie il frammento dall'URL.
export function consumeFragment(location = window.location, history = window.history) {
  if (!location.hash) return false;
  const params = new URLSearchParams(location.hash.slice(1));
  const apiId = params.get('api_id');
  const apiHash = params.get('api_hash');
  if (!apiId && !apiHash) return false;
  history.replaceState(history.state, '', location.pathname + location.search);
  if (!isValidCredentials(apiId ?? '', apiHash ?? '')) return false;
  return saveCredentials(apiId, apiHash);
}

export function loadSession() {
  return read('session') ?? '';
}

export function saveSession(session) {
  return write('session', session);
}

export function clearSession() {
  remove('session');
}

function loadLayouts() {
  try {
    return JSON.parse(read('layouts')) ?? {};
  } catch {
    return {};
  }
}

// Ultimo layout della tastiera usato in ogni chat.
export function loadChatLayout(chatId) {
  return loadLayouts()[chatId] ?? null;
}

export function saveChatLayout(chatId, layout) {
  write('layouts', JSON.stringify({ ...loadLayouts(), [chatId]: layout }));
}

// Avviso da mostrare dopo un ricaricamento della pagina.
export function setNotice(text) {
  try {
    sessionStorage.setItem(`${PREFIX}notice`, text);
  } catch {
    // L'avviso è facoltativo.
  }
}

export function takeNotice() {
  try {
    const text = sessionStorage.getItem(`${PREFIX}notice`);
    sessionStorage.removeItem(`${PREFIX}notice`);
    return text;
  } catch {
    return null;
  }
}
