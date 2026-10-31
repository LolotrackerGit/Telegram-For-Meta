// Costruisce il sito statico. `--fake` sostituisce Telegram con il finto dei test
// e scrive in .e2e-dist, così il codice di test non finisce mai in docs/.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const app = join(root, 'glasses');
const shims = join(app, 'src', 'tg', 'shims');
const fake = process.argv.includes('--fake');
const out = join(root, fake ? '.e2e-dist' : 'docs');

const shim = (file) => join(shims, file);
const unavailable = shim('unavailable.js');

const alias = {
  crypto: shim('crypto.js'),
  'node:crypto': shim('crypto.js'),
  zlib: shim('zlib.js'),
  'node:zlib': shim('zlib.js'),
  events: shim('events.js'),
  'node:events': shim('events.js'),
  'node:timers/promises': shim('timers.js'),
};
for (const name of ['fs', 'path', 'os', 'net', 'node:net', 'http', 'node:http', 'https', 'node:https',
  'socks', 'node-localstorage', 'ws']) {
  alias[name] = unavailable;
}

const useFakeClient = {
  name: 'fake-client',
  setup(context) {
    context.onResolve({ filter: /\/tg\/client\.js$/ }, () => ({ path: join(root, 'tests', 'fake-tg.js') }));
  },
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const result = await build({
  entryPoints: [join(app, 'src', 'main.js')],
  outdir: out,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome110',
  minify: true,
  chunkNames: 'chunks/[name]-[hash]',
  alias,
  define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"' },
  plugins: fake ? [useFakeClient] : [],
  metafile: true,
  logLevel: 'warning',
});

cpSync(join(app, 'index.html'), join(out, 'index.html'));
cpSync(join(app, 'app.css'), join(out, 'app.css'));
cpSync(join(app, 'public'), out, { recursive: true });

for (const [file, { bytes }] of Object.entries(result.metafile.outputs)) {
  console.log(`${(bytes / 1024).toFixed(1).padStart(8)} KB  ${file.replace(`${root}/`, '')}`);
}
