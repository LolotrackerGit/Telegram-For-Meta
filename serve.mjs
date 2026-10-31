// Server statico per le prove locali: `node serve.mjs [cartella]`.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'docs');
const port = Number(process.env.PORT ?? 4173);

const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

createServer(async (request, response) => {
  const { pathname } = new URL(request.url, 'http://localhost');
  const path = normalize(pathname.endsWith('/') ? `${pathname}index.html` : pathname);
  try {
    const body = await readFile(join(root, path));
    response.writeHead(200, {
      'Content-Type': types[extname(path)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end('Non trovato');
  }
}).listen(port, () => console.log(`${root} su http://localhost:${port}/`));
