const timeFormat = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' });
const weekdayFormat = new Intl.DateTimeFormat('it-IT', { weekday: 'short' });
const dayFormat = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit' });
const fullDayFormat = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

const DAY_MS = 86_400_000;

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function daysAgo(date, now) {
  return Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
}

export function formatTime(seconds) {
  return timeFormat.format(new Date(seconds * 1000));
}

// Ora oggi, poi "ieri", giorno della settimana e infine la data breve.
export function formatListDate(seconds, now = new Date()) {
  if (!seconds) return '';
  const date = new Date(seconds * 1000);
  const days = daysAgo(date, now);
  if (days <= 0) return formatTime(seconds);
  if (days === 1) return 'ieri';
  if (days < 7) return weekdayFormat.format(date).replace('.', '');
  return dayFormat.format(date);
}

export function formatDay(seconds, now = new Date()) {
  const date = new Date(seconds * 1000);
  const days = daysAgo(date, now);
  if (days <= 0) return 'Oggi';
  if (days === 1) return 'Ieri';
  return fullDayFormat.format(date);
}

export function isSameDay(a, b) {
  return startOfDay(new Date(a * 1000)) === startOfDay(new Date(b * 1000));
}

function attribute(document, className) {
  return document.attributes?.find((item) => item.className === className);
}

function documentLabel(document) {
  const sticker = attribute(document, 'DocumentAttributeSticker');
  if (sticker) return sticker.alt || '🏷️ Sticker';
  const audio = attribute(document, 'DocumentAttributeAudio');
  if (audio) return audio.voice ? '🎤 Vocale' : '🎵 Audio';
  const video = attribute(document, 'DocumentAttributeVideo');
  if (attribute(document, 'DocumentAttributeAnimated')) return '🎞️ GIF';
  if (video) return video.roundMessage ? '🎥 Videomessaggio' : '🎬 Video';
  const file = attribute(document, 'DocumentAttributeFilename');
  return file?.fileName ? `📎 ${file.fileName}` : '📎 File';
}

// Riceve l'oggetto media di Telegram e restituisce l'etichetta da mostrare,
// oppure null quando il media non aggiunge nulla al testo (anteprime di link).
export function mediaLabel(media) {
  switch (media?.className) {
    case undefined:
    case 'MessageMediaEmpty':
    case 'MessageMediaWebPage':
      return null;
    case 'MessageMediaPhoto':
      return '📷 Foto';
    case 'MessageMediaDocument':
      return media.document?.className === 'Document' ? documentLabel(media.document) : '📎 File';
    case 'MessageMediaGeo':
    case 'MessageMediaGeoLive':
    case 'MessageMediaVenue':
      return '📍 Posizione';
    case 'MessageMediaContact':
      return '👤 Contatto';
    case 'MessageMediaPoll':
      return '📊 Sondaggio';
    case 'MessageMediaDice':
      return media.emoticon || '🎲 Dado';
    case 'MessageMediaGame':
      return '🎮 Gioco';
    case 'MessageMediaInvoice':
      return '🧾 Fattura';
    case 'MessageMediaStory':
      return '📖 Storia';
    default:
      return '📎 Allegato';
  }
}

// Il testo può mancare: l'anteprima mostra allora l'etichetta del media.
export function messagePreview(message) {
  if (!message) return '';
  if (message.media && message.text) return `${message.media} ${message.text}`;
  return message.media || message.text || '';
}

export function initials(title) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => Array.from(word)[0]);
  return letters.join('').toLocaleUpperCase('it-IT') || '?';
}

// Accetta spazi e trattini; senza prefisso internazionale assume +39.
export function normalizePhone(value) {
  const compact = value.replace(/[^\d+]/g, '');
  if (compact.startsWith('+')) return compact;
  if (compact.startsWith('00')) return `+${compact.slice(2)}`;
  return `+39${compact}`;
}
