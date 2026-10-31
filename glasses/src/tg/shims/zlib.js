// teleproto usa solo gzip sincrono; senza crc32 usa la propria versione JavaScript.
import { Buffer } from 'buffer';
import { gunzipSync as gunzip, gzipSync as gzip } from 'fflate';

export function unzipSync(data) {
  return Buffer.from(gunzip(new Uint8Array(data)));
}

export function gzipSync(data) {
  return Buffer.from(gzip(new Uint8Array(data)));
}

export default { unzipSync, gzipSync };
