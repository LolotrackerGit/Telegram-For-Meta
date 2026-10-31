import { h } from './dom.js';
import { webmOpusToOgg } from './opus-ogg.js';

// Niente video lunghi: la rete degli occhiali passa dal telefono.
const MAX_VOICE_SECONDS = 300;
const MAX_VIDEO_SECONDS = 15;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const PHOTO_QUALITY = 0.85;

const VOICE_TYPES = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus'];
const VIDEO_TYPES = ['video/mp4', 'video/webm;codecs=vp8,opus'];

function pickType(types) {
  return types.find((type) => MediaRecorder.isTypeSupported(type));
}

function formatElapsed(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatSize(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

function deviceError(error, device) {
  if (error?.name === 'NotAllowedError') return `Accesso a ${device} negato.`;
  if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') {
    return `Questo dispositivo non offre ${device} alle Web App.`;
  }
  return `Impossibile usare ${device}.`;
}

function mediaApisMissing(needsRecorder) {
  return !navigator.mediaDevices?.getUserMedia || (needsRecorder && !('MediaRecorder' in window));
}

// Fotocamera, microfono e file non sono documentati per le Web App degli
// occhiali: ogni funzione si verifica al momento e spiega perché non è disponibile.
export function createCapture({ send, onClose }) {
  let stream = null;
  let recorder = null;
  let chunks = [];
  let startedAt = 0;
  let timer = null;
  let pending = null;
  let run = 0;
  let primaryAction = null;
  let busy = false;

  const preview = h('video', { muted: true, autoplay: true, playsInline: true, hidden: true });
  const still = h('img', { alt: 'Foto scattata', hidden: true });
  const status = h('p', { role: 'status' });
  const primary = h('button', { type: 'button', hidden: true, onclick: onPrimary });
  const cancelButton = h('button', { type: 'button', onclick: cancel }, 'Annulla');
  const picker = h('input', {
    type: 'file',
    accept: 'image/*,video/*',
    hidden: true,
    onchange: onPicked,
    oncancel: cancel,
  });
  const element = h('div', { class: 'capture', hidden: true },
    preview, still, status, h('div', { class: 'capture-actions' }, primary, cancelButton), picker);

  async function onPrimary() {
    if (busy || !primaryAction) return;
    busy = true;
    try {
      await primaryAction();
    } finally {
      busy = false;
    }
  }

  function setPrimary(text, action) {
    primary.textContent = text;
    primary.hidden = !action;
    primaryAction = action;
    (action ? primary : cancelButton).focus({ preventScroll: true });
  }

  function release() {
    clearInterval(timer);
    timer = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    preview.srcObject = null;
    preview.hidden = true;
  }

  function reset() {
    run += 1;
    if (recorder?.state === 'recording') recorder.stop();
    recorder = null;
    release();
    chunks = [];
    pending = null;
    picker.value = '';
    if (still.src) URL.revokeObjectURL(still.src);
    still.removeAttribute('src');
    still.hidden = true;
    primaryAction = null;
    primary.hidden = true;
    element.hidden = true;
  }

  function cancel() {
    if (element.hidden) return;
    reset();
    onClose();
  }

  function fail(text) {
    release();
    status.textContent = text;
    setPrimary('', null);
  }

  async function upload() {
    const current = run;
    setPrimary('Invio…', null);
    status.textContent = 'Invio 0%';
    try {
      await send(pending, (fraction) => {
        if (current === run) status.textContent = `Invio ${Math.round(fraction * 100)}%`;
      });
      if (current === run) cancel();
    } catch (error) {
      if (current !== run) return;
      status.textContent = error?.seconds
        ? `Telegram chiede di attendere ${error.seconds} secondi.`
        : 'Invio non riuscito.';
      setPrimary('Riprova', upload);
    }
  }

  function stopRecorder() {
    if (recorder?.state !== 'recording') return Promise.resolve();
    return new Promise((resolve) => {
      recorder.onstop = resolve;
      recorder.stop();
    });
  }

  function elapsedSeconds() {
    return Math.round((Date.now() - startedAt) / 1000);
  }

  async function finishRecording(kind, mimeType, duration) {
    const { videoWidth: width, videoHeight: height } = preview;
    await stopRecorder();
    release();
    const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
    if (kind === 'voice') {
      pending = {
        kind,
        name: 'vocale.ogg',
        duration,
        blob: mimeType.includes('webm') ? await webmOpusToOgg(blob) : blob,
      };
    } else {
      const extension = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
      pending = { kind, name: `video.${extension}`, duration, width, height, blob };
    }
    await upload();
  }

  async function startRecording(kind, device, constraints, types, limit, label) {
    const current = run;
    status.textContent = `Attivazione di ${device}…`;
    setPrimary('', null);
    const mimeType = mediaApisMissing(true) ? null : pickType(types);
    if (!mimeType) {
      fail(`Questo dispositivo non offre ${device} alle Web App.`);
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (current !== run) {
        release();
        return;
      }
      if (kind === 'video') {
        preview.srcObject = stream;
        preview.hidden = false;
      }
      chunks = [];
      recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = ({ data }) => chunks.push(data);
      recorder.start(1000);
    } catch (error) {
      if (current === run) fail(deviceError(error, device));
      return;
    }
    startedAt = Date.now();
    let duration = 0;
    const finish = () => finishRecording(kind, mimeType, duration || 1);
    status.textContent = `${label} 0:00`;
    setPrimary('Invia', finish);
    timer = setInterval(() => {
      duration = Math.min(elapsedSeconds(), limit);
      status.textContent = `${label} ${formatElapsed(duration)}`;
      if (duration >= limit) {
        clearInterval(timer);
        status.textContent = 'Tempo massimo raggiunto';
        recorder.stop();
      }
    }, 500);
  }

  async function startPhoto() {
    const current = run;
    const device = 'la fotocamera';
    status.textContent = `Attivazione del${device.slice(1)}…`;
    setPrimary('', null);
    if (mediaApisMissing(false)) {
      fail(`Questo dispositivo non offre ${device} alle Web App.`);
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 } } });
      if (current !== run) {
        release();
        return;
      }
      preview.srcObject = stream;
      preview.hidden = false;
      await preview.play();
    } catch (error) {
      if (current === run) fail(deviceError(error, device));
      return;
    }
    status.textContent = '';
    setPrimary('Scatta', takePhoto);
  }

  async function takePhoto() {
    const canvas = h('canvas', { width: preview.videoWidth, height: preview.videoHeight });
    canvas.getContext('2d').drawImage(preview, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY));
    release();
    if (!blob) {
      fail('Foto non riuscita.');
      return;
    }
    pending = { kind: 'photo', name: 'foto.jpg', blob };
    still.src = URL.createObjectURL(blob);
    still.hidden = false;
    status.textContent = '';
    setPrimary('Invia', upload);
  }

  function onPicked() {
    const [file] = picker.files;
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      fail(`File troppo grande: il massimo è ${formatSize(MAX_FILE_BYTES)}.`);
      return;
    }
    let kind = 'file';
    if (file.type.startsWith('image/')) kind = 'photo';
    else if (file.type.startsWith('video/')) kind = 'video';
    pending = { kind, name: file.name, blob: file, picked: true };
    status.textContent = `${file.name} (${formatSize(file.size)})`;
    setPrimary('Invia', upload);
  }

  function start(kind) {
    reset();
    element.hidden = false;
    status.textContent = '';
    if (kind === 'voice') {
      startRecording(kind, 'il microfono', { audio: { channelCount: 1 } }, VOICE_TYPES, MAX_VOICE_SECONDS, 'Registrazione');
    } else if (kind === 'video') {
      startRecording(kind, 'la fotocamera', { audio: true, video: { width: { ideal: 640 } } }, VIDEO_TYPES, MAX_VIDEO_SECONDS, 'Video');
    } else if (kind === 'photo') {
      startPhoto();
    } else {
      setPrimary('', null);
      status.textContent = 'Scegli un file dal selettore del dispositivo.';
      picker.click();
    }
  }

  // Microfono e fotocamera non restano mai accesi con l'app in secondo piano.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && stream) cancel();
  });

  return { element, start, cancel, get active() { return !element.hidden; } };
}
