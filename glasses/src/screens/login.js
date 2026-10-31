import { h, mount } from '../dom.js';
import { normalizePhone } from '../format.js';

const ERRORS = {
  API_ID_INVALID: 'api_id o api_hash non validi.',
  API_ID_PUBLISHED_FLOOD: 'Questo api_id è bloccato da Telegram: creane uno tuo.',
  PHONE_NUMBER_INVALID: 'Numero non valido. Scrivilo col prefisso, ad esempio +39 333 1234567.',
  PHONE_NUMBER_BANNED: 'Questo numero è stato bloccato da Telegram.',
  PHONE_NUMBER_FLOOD: 'Troppi tentativi con questo numero: riprova più tardi.',
  PHONE_CODE_INVALID: 'Codice errato. Riprova.',
  PHONE_CODE_EXPIRED: 'Codice scaduto: chiedine uno nuovo.',
  PHONE_CODE_EMPTY: 'Scrivi il codice ricevuto.',
  PASSWORD_HASH_INVALID: 'Password errata. Riprova.',
};

function errorText(error) {
  if (error?.seconds) return `Telegram chiede di attendere ${error.seconds} secondi.`;
  if (error?.message?.startsWith('No account is registered')) {
    return 'Nessun account Telegram con questo numero.';
  }
  return ERRORS[error?.errorMessage] ?? 'Accesso non riuscito. Controlla la rete e riprova.';
}

function isAbort(error) {
  return error?.name === 'AbortError';
}

// Un passo del modulo: risolve con il valore confermato, che arriva dagli eventi
// input/change del compositore di sistema.
function ask(root, { title, hint, note, error, field, label, submit, normalize, extras = [] }) {
  return new Promise((resolve, reject) => {
    let value = '';
    const read = (event) => {
      value = event.target.value;
    };
    const input = h('input', {
      ...field,
      autocomplete: 'off',
      spellcheck: false,
      oninput: read,
      onchange: read,
    });

    function confirm() {
      const text = value.trim();
      if (!text) return;
      input.value = '';
      value = '';
      resolve(normalize ? normalize(text) : text);
    }

    const message = h('p', { class: 'error', role: 'alert', hidden: !error }, error ?? '');
    mount(root, h('main', { class: 'form' },
      h('h1', {}, title),
      hint ? h('p', { class: 'muted' }, hint) : null,
      h('label', {}, label, input),
      note ? h('p', { class: 'note' }, note) : null,
      message,
      h('div', { class: 'actions' },
        h('button', { type: 'button', onclick: confirm }, submit),
        ...extras.map(({ text, action }) => h('button', {
          type: 'button',
          onclick: () => action(resolve, reject),
        }, text)))));
    input.focus({ preventScroll: true });
  });
}

function showWaiting(root, text) {
  mount(root, h('main', { class: 'form' }, h('p', { role: 'status' }, text)));
}

// Risolve quando il login è completo. Numero, codice e 2FA sono il percorso
// principale; il QR serve soprattutto per le prove dal Mac.
export async function showLogin(root, tg, { notice, onChangeCredentials }) {
  let pendingError = notice ?? null;
  const takeError = () => {
    const error = pendingError;
    pendingError = null;
    return error;
  };

  for (;;) {
    const abort = new AbortController();
    try {
      await tg.login({
        signal: abort.signal,
        onError: async (error) => {
          if (isAbort(error)) return true;
          pendingError = errorText(error);
          return false;
        },
        askPhone: () => ask(root, {
          title: 'Accedi a Telegram',
          hint: 'Il codice arriverà nell’app Telegram sul telefono.',
          error: takeError(),
          label: 'Numero di telefono',
          field: { type: 'tel', placeholder: '+39 333 1234567' },
          submit: 'Invia codice',
          normalize: (text) => {
            showWaiting(root, 'Invio del codice…');
            return normalizePhone(text);
          },
          extras: [
            { text: 'Accedi con QR', action: (_, reject) => reject(tg.restartWithQr()) },
            { text: 'Cambia credenziali', action: () => onChangeCredentials() },
          ],
        }),
        askCode: (viaApp) => ask(root, {
          title: 'Codice di accesso',
          hint: viaApp ? 'Lo trovi nell’app Telegram sul telefono.' : 'Lo trovi nell’SMS ricevuto.',
          error: takeError(),
          label: 'Codice',
          field: { type: 'text' },
          submit: 'Accedi',
          normalize: (text) => {
            showWaiting(root, 'Verifica del codice…');
            return text.replace(/\D/g, '');
          },
          extras: [{ text: 'Cambia numero', action: (_, reject) => reject(tg.restartWithPhone()) }],
        }),
        askPassword: (hint) => ask(root, {
          title: 'Verifica in due passaggi',
          hint: hint ? `Suggerimento: ${hint}` : null,
          note: 'Attenzione: la password resta visibile mentre la scrivi.',
          error: takeError(),
          label: 'Password',
          field: { type: 'text', autocapitalize: 'off' },
          submit: 'Conferma',
          normalize: (text) => {
            showWaiting(root, 'Verifica della password…');
            return text;
          },
        }),
        showQr: async (url) => {
          const { default: QRCode } = await import('qrcode');
          const image = h('img', {
            alt: 'Codice QR di accesso',
            src: await QRCode.toDataURL(url, { margin: 0, scale: 8, errorCorrectionLevel: 'L' }),
          });
          const back = h('button', { type: 'button', onclick: () => abort.abort() }, 'Usa il numero');
          mount(root, h('main', { class: 'form' },
            h('p', {}, 'Telegram sul telefono → Impostazioni → Dispositivi → Collega dispositivo desktop.'),
            h('div', { class: 'qr' }, image),
            h('div', { class: 'actions' }, back)));
          back.focus({ preventScroll: true });
        },
      });
      return;
    } catch (error) {
      if (!isAbort(error)) pendingError = errorText(error);
    }
  }
}
