import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatListDate,
  initials,
  mediaLabel,
  messagePreview,
  normalizePhone,
} from '../glasses/src/format.js';

const document = (...attributes) => ({
  className: 'MessageMediaDocument',
  document: { className: 'Document', attributes },
});

test('etichette dei media', () => {
  assert.equal(mediaLabel(undefined), null);
  assert.equal(mediaLabel({ className: 'MessageMediaWebPage' }), null);
  assert.equal(mediaLabel({ className: 'MessageMediaPhoto' }), '📷 Foto');
  assert.equal(mediaLabel(document({ className: 'DocumentAttributeAudio', voice: true })), '🎤 Vocale');
  assert.equal(mediaLabel(document({ className: 'DocumentAttributeAudio' })), '🎵 Audio');
  assert.equal(mediaLabel(document({ className: 'DocumentAttributeSticker', alt: '😀' })), '😀');
  assert.equal(mediaLabel(document({ className: 'DocumentAttributeSticker', alt: '' })), '🏷️ Sticker');
  assert.equal(mediaLabel(document({ className: 'DocumentAttributeVideo', roundMessage: true })), '🎥 Videomessaggio');
  assert.equal(
    mediaLabel(document({ className: 'DocumentAttributeVideo' }, { className: 'DocumentAttributeAnimated' })),
    '🎞️ GIF',
  );
  assert.equal(mediaLabel(document({ className: 'DocumentAttributeFilename', fileName: 'a.pdf' })), '📎 a.pdf');
  assert.equal(mediaLabel(document()), '📎 File');
  assert.equal(mediaLabel({ className: 'MessageMediaQualcosaDiNuovo' }), '📎 Allegato');
});

test('anteprima con testo, solo media e messaggio assente', () => {
  assert.equal(messagePreview(null), '');
  assert.equal(messagePreview({ text: 'ciao', media: null }), 'ciao');
  assert.equal(messagePreview({ text: '', media: '📷 Foto' }), '📷 Foto');
  assert.equal(messagePreview({ text: 'guarda', media: '📷 Foto' }), '📷 Foto guarda');
});

test('date della lista', () => {
  const now = new Date(2026, 9, 31, 12, 0);
  const seconds = (date) => date.getTime() / 1000;
  assert.equal(formatListDate(0, now), '');
  assert.equal(formatListDate(seconds(new Date(2026, 9, 31, 9, 5)), now), '09:05');
  assert.equal(formatListDate(seconds(new Date(2026, 9, 30, 23, 0)), now), 'ieri');
  assert.equal(formatListDate(seconds(new Date(2026, 8, 5, 8, 0)), now), '05/09');
});

test('iniziali', () => {
  assert.equal(initials('Mario Rossi Bianchi'), 'MR');
  assert.equal(initials('  anna '), 'A');
  assert.equal(initials(''), '?');
});

test('numero di telefono', () => {
  assert.equal(normalizePhone('+39 333 123-4567'), '+393331234567');
  assert.equal(normalizePhone('0039 333 1234567'), '+393331234567');
  assert.equal(normalizePhone('333 1234567'), '+393331234567');
});
