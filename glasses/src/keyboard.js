import { h } from './dom.js';

export const DEFAULT_LAYOUT = 'ru';

// Ogni layout riempie 12 colonne per 3 righe: con le tastiere sfalsate
// Su e Giù procederebbero in diagonale.
const LAYOUTS = {
  ru: { name: 'RU', keys: 'йцукенгшщзхъфывапролджэ.ячсмитьбюё,?' },
  abc: { name: 'ABC', keys: 'qwertyuiop\'-asdfghjkl.,?zxcvbnm!:;()' },
  num: { name: '123', keys: '1234567890.,!?:;-()"\'@#/€%àèéìòù+=*_' },
};
const ORDER = Object.keys(LAYOUTS);

// Tastiera di pulsanti nativi: il testo entra nel campo senza aprire il
// compositore di sistema, che non offre il cirillico.
export function createKeyboard({ getText, onInsert, onDelete, onLayout, onClose }) {
  let layout = DEFAULT_LAYOUT;
  let shift = false;

  const rows = h('div', { class: 'keyboard-rows' });
  const shiftKey = h('button', { type: 'button', class: 'key', 'aria-pressed': 'false', onclick: toggleShift }, 'Aa');
  const layoutKey = h('button', { type: 'button', class: 'key', onclick: nextLayout });
  const element = h('div', { class: 'keyboard', hidden: true },
    rows,
    shiftKey,
    layoutKey,
    h('button', { type: 'button', class: 'key key-wide', onclick: () => type(' ') }, 'Spazio'),
    h('button', { type: 'button', class: 'key', 'aria-label': 'Cancella', onclick: erase }, '⌫'),
    h('button', { type: 'button', class: 'key', onclick: () => onClose() }, 'Chiudi'));

  // La prima lettera del messaggio è maiuscola da sola.
  function isUpper() {
    return shift || !getText();
  }

  function refreshKeys() {
    const upper = isUpper();
    for (const key of rows.querySelectorAll('button')) {
      const { char } = key.dataset;
      key.textContent = upper ? char.toLocaleUpperCase('ru-RU') : char;
    }
    shiftKey.setAttribute('aria-pressed', String(shift));
    shiftKey.classList.toggle('key-on', shift);
  }

  function type(char) {
    onInsert(char);
    shift = false;
    refreshKeys();
  }

  function pressLetter(key) {
    type(isUpper() ? key.dataset.char.toLocaleUpperCase('ru-RU') : key.dataset.char);
  }

  function erase() {
    onDelete();
    refreshKeys();
  }

  function toggleShift() {
    shift = !shift;
    refreshKeys();
  }

  function setLayout(next) {
    layout = next;
    rows.replaceChildren(...Array.from(LAYOUTS[next].keys, (char) => {
      const key = h('button', { type: 'button', class: 'key', onclick: () => pressLetter(key) });
      key.dataset.char = char;
      return key;
    }));
    layoutKey.textContent = LAYOUTS[ORDER[(ORDER.indexOf(next) + 1) % ORDER.length]].name;
    layoutKey.setAttribute('aria-label', `Layout ${LAYOUTS[next].name}, passa al successivo`);
    refreshKeys();
  }

  function nextLayout() {
    setLayout(ORDER[(ORDER.indexOf(layout) + 1) % ORDER.length]);
    onLayout(layout);
  }

  return {
    element,
    refresh: refreshKeys,
    get isOpen() {
      return !element.hidden;
    },
    open(saved) {
      shift = false;
      setLayout(saved in LAYOUTS ? saved : DEFAULT_LAYOUT);
      element.hidden = false;
      onLayout(layout);
      rows.querySelector('button').focus({ preventScroll: true });
    },
    close() {
      element.hidden = true;
    },
  };
}
