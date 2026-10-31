// Casualità per teleproto: hash e AES arrivano già dalla versione browser di cifrante.
import { Buffer } from 'buffer';

const MAX_RANDOM_CHUNK = 65_536;

function fill(view) {
  for (let start = 0; start < view.length; start += MAX_RANDOM_CHUNK) {
    globalThis.crypto.getRandomValues(view.subarray(start, start + MAX_RANDOM_CHUNK));
  }
}

export function randomBytes(size) {
  const bytes = Buffer.alloc(size);
  fill(bytes);
  return bytes;
}

export function randomFillSync(target, offset = 0, size = target.length - offset) {
  fill(new Uint8Array(target.buffer, target.byteOffset + offset, size));
  return target;
}

// Intero uniforme in [min, max), scartando i valori che introdurrebbero bias.
export function randomInt(minOrMax, maybeMax) {
  const min = maybeMax === undefined ? 0 : minOrMax;
  const range = (maybeMax === undefined ? minOrMax : maybeMax) - min;
  const limit = 2 ** 32 - 2 ** 32 % range;
  const word = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(word);
  } while (word[0] >= limit);
  return min + word[0] % range;
}

export default { randomBytes, randomFillSync, randomInt };
