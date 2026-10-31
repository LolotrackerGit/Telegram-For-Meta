import { h, mount } from '../dom.js';
import { isValidCredentials, saveCredentials } from '../storage.js';

// Compare quando mancano api_id e api_hash. I campi sono il ripiego per chi non
// riesce ad aggiungere la Web App con il frammento nell'URL.
export function showSetup(root, onSaved) {
  const apiId = h('input', { type: 'text', autocomplete: 'off', spellcheck: false });
  const apiHash = h('input', { type: 'text', autocomplete: 'off', spellcheck: false });
  const error = h('p', { class: 'error', role: 'alert', hidden: true });

  function save() {
    const id = apiId.value.trim();
    const hash = apiHash.value.trim();
    if (!isValidCredentials(id, hash) || !saveCredentials(id, hash)) {
      error.textContent = 'Valori non validi: api_id è un numero, api_hash ha 32 caratteri.';
      error.hidden = false;
      return;
    }
    onSaved();
  }

  mount(root, h('main', { class: 'form' },
    h('h1', {}, 'Configurazione'),
    h('ol', { class: 'steps' },
      h('li', {}, 'Crea un’app su my.telegram.org e copia api_id e api_hash.'),
      h('li', {}, 'Aggiungi a questo indirizzo #api_id=…&api_hash=… nell’app Meta AI.'),
      h('li', {}, 'Oppure inseriscili qui sotto.')),
    h('label', {}, 'api_id', apiId),
    h('label', {}, 'api_hash', apiHash),
    error,
    h('div', { class: 'actions' },
      h('button', { type: 'button', onclick: save }, 'Salva'))));
  apiId.focus({ preventScroll: true });
}
