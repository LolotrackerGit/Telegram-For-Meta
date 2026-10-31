// Va importato prima di teleproto: le sue dipendenze usano Buffer come globale.
import { Buffer } from 'buffer';

globalThis.Buffer = Buffer;

// La versione npm di Buffer ha solo i nomi con "UInt"; Node ha anche quelli con "Uint".
for (const [alias, name] of [
  ['readBigUint64LE', 'readBigUInt64LE'],
  ['readBigUint64BE', 'readBigUInt64BE'],
  ['writeBigUint64LE', 'writeBigUInt64LE'],
  ['writeBigUint64BE', 'writeBigUInt64BE'],
]) {
  Buffer.prototype[alias] ??= Buffer.prototype[name];
}
