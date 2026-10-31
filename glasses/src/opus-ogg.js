// I vocali di Telegram sono Opus in Ogg, ma Chrome registra Opus in WebM.
// Qui si travasano i pacchetti da un contenitore all'altro, senza ricodificare.
const ID_SEGMENT = 0x18538067;
const ID_CLUSTER = 0x1f43b675;
const ID_BLOCK_GROUP = 0xa0;
const ID_TRACKS = 0x1654ae6b;
const ID_TRACK_ENTRY = 0xae;
const ID_CODEC_PRIVATE = 0x63a2;
const ID_SIMPLE_BLOCK = 0xa3;
const ID_BLOCK = 0xa1;
const CONTAINERS = new Set([ID_SEGMENT, ID_CLUSTER, ID_BLOCK_GROUP, ID_TRACKS, ID_TRACK_ENTRY]);

const SAMPLE_RATE = 48_000;
const MAX_SEGMENTS_PER_PAGE = 255;
const PACKETS_PER_PAGE = 50;

function readVint(bytes, offset, keepMarker) {
  const first = bytes[offset];
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length += 1;
  if (length > 8) throw new Error('WebM non valido');
  let value = keepMarker ? first : first & (0xff >> length);
  let unknown = (first & (0xff >> length)) === (0xff >> length);
  for (let index = 1; index < length; index += 1) {
    const byte = bytes[offset + index];
    value = value * 256 + byte;
    if (byte !== 0xff) unknown = false;
  }
  return { value, length, unknown };
}

// Estrae i pacchetti Opus e l'intestazione OpusHead dagli elementi WebM.
function parseWebm(bytes) {
  const packets = [];
  let head = null;

  function walk(start, end) {
    let offset = start;
    while (offset < end) {
      const id = readVint(bytes, offset, true);
      offset += id.length;
      const size = readVint(bytes, offset, false);
      offset += size.length;
      // MediaRecorder scrive Segment e Cluster con dimensione sconosciuta.
      const dataEnd = size.unknown ? end : Math.min(end, offset + size.value);
      if (CONTAINERS.has(id.value)) {
        walk(offset, dataEnd);
      } else if (id.value === ID_CODEC_PRIVATE) {
        head = bytes.subarray(offset, dataEnd);
      } else if (id.value === ID_SIMPLE_BLOCK || id.value === ID_BLOCK) {
        const track = readVint(bytes, offset, false);
        packets.push(bytes.subarray(offset + track.length + 3, dataEnd));
      }
      offset = dataEnd;
    }
  }

  walk(0, bytes.length);
  return { packets, head };
}

// Campioni a 48 kHz di un pacchetto, ricavati dal byte TOC (RFC 6716, 3.1).
function packetSamples(packet) {
  const toc = packet[0];
  const config = toc >> 3;
  let frameSamples;
  if (config < 12) frameSamples = [480, 960, 1920, 2880][config & 3];
  else if (config < 16) frameSamples = [480, 960][config & 1];
  else frameSamples = [120, 240, 480, 960][config & 3];
  const code = toc & 3;
  let frames = 1;
  if (code === 1 || code === 2) frames = 2;
  else if (code === 3) frames = packet[1] & 0x3f;
  return frameSamples * frames;
}

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index << 24;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 0x80000000 ? (value << 1) ^ 0x04c11db7 : value << 1;
  }
  return value >>> 0;
});

function oggCrc(bytes) {
  let crc = 0;
  for (const byte of bytes) crc = ((crc << 8) ^ CRC_TABLE[(crc >>> 24) ^ byte]) >>> 0;
  return crc;
}

function oggPage(packets, { flags, granule, serial, sequence }) {
  const lacing = [];
  for (const packet of packets) {
    let left = packet.length;
    while (left >= 255) {
      lacing.push(255);
      left -= 255;
    }
    lacing.push(left);
  }
  const bodySize = packets.reduce((sum, packet) => sum + packet.length, 0);
  const page = new Uint8Array(27 + lacing.length + bodySize);
  const view = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53, 0, flags]);
  view.setBigUint64(6, BigInt(granule), true);
  view.setUint32(14, serial, true);
  view.setUint32(18, sequence, true);
  page[26] = lacing.length;
  page.set(lacing, 27);
  let offset = 27 + lacing.length;
  for (const packet of packets) {
    page.set(packet, offset);
    offset += packet.length;
  }
  view.setUint32(22, oggCrc(page), true);
  return page;
}

function defaultHead() {
  const head = new Uint8Array(19);
  head.set(new TextEncoder().encode('OpusHead'));
  head[8] = 1;
  head[9] = 1;
  new DataView(head.buffer).setUint32(12, SAMPLE_RATE, true);
  return head;
}

function opusTags() {
  const vendor = new TextEncoder().encode('TG Occhiali');
  const tags = new Uint8Array(8 + 4 + vendor.length + 4);
  tags.set(new TextEncoder().encode('OpusTags'));
  new DataView(tags.buffer).setUint32(8, vendor.length, true);
  tags.set(vendor, 12);
  return tags;
}

function segmentCount(packet) {
  return Math.floor(packet.length / 255) + 1;
}

export function webmOpusBytesToOgg(bytes) {
  const { packets, head } = parseWebm(bytes);
  if (!packets.length) throw new Error('Registrazione vuota');

  const serial = globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  const pages = [
    oggPage([head ?? defaultHead()], { flags: 2, granule: 0, serial, sequence: 0 }),
    oggPage([opusTags()], { flags: 0, granule: 0, serial, sequence: 1 }),
  ];

  let sequence = 2;
  let granule = 0;
  let batch = [];
  let segments = 0;
  packets.forEach((packet, index) => {
    batch.push(packet);
    segments += segmentCount(packet);
    granule += packetSamples(packet);
    const last = index === packets.length - 1;
    const next = packets[index + 1];
    const full = batch.length >= PACKETS_PER_PAGE
      || (next && segments + segmentCount(next) > MAX_SEGMENTS_PER_PAGE);
    if (last || full) {
      pages.push(oggPage(batch, { flags: last ? 4 : 0, granule, serial, sequence }));
      sequence += 1;
      batch = [];
      segments = 0;
    }
  });
  return pages;
}

export async function webmOpusToOgg(blob) {
  const pages = webmOpusBytesToOgg(new Uint8Array(await blob.arrayBuffer()));
  return new Blob(pages, { type: 'audio/ogg' });
}
